/**
 * Contact validation pipeline. For every lead we check, in order and stopping at the
 * first hard failure:
 *
 *   Email:   present -> syntax -> provider typo -> disposable -> MX records -> role inbox -> personal/free provider
 *   Phone:   present -> parseable & valid (libphonenumber) -> line type (toll-free = risky)
 *   Website: DNS resolves -> HTTP HEAD/GET responds
 *
 * Network lookups (MX, DNS, HTTP) are cached per domain (Redis, 24h) and de-duplicated
 * while in flight, so 200 leads on gmail.com cost one MX lookup, not 200.
 *
 * Deliberately NOT done: SMTP mailbox probing (RCPT TO). Cloud hosts block port 25, results
 * are unreliable (catch-all servers, greylisting), and hammering mail servers looks like abuse.
 */
const dns = require('dns').promises;
const pLimit = require('p-limit');
const config = require('../config');
const { remember } = require('../lib/cache');
const rules = require('./emailRules');

const DAY = 24 * 60 * 60;
const DNS_TIMEOUT_MS = 4000;
const HTTP_TIMEOUT_MS = 5000;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`${label} timed out`), { code: 'ETIMEOUT' })), ms)),
  ]);

// In-flight de-duplication: concurrent callers for the same key share one promise.
const inflight = new Map();
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const stats = { lookups: 0, cacheHits: 0 };
function resetStats() {
  stats.lookups = 0;
  stats.cacheHits = 0;
}

async function cachedLookup(key, compute) {
  return once(key, async () => {
    const { value, cached } = await remember(key, DAY, compute);
    if (cached) stats.cacheHits++;
    else stats.lookups++;
    return value;
  });
}

/** -> { hasMx: boolean|null, error?: string }  (null = could not determine) */
function lookupMx(domain) {
  return cachedLookup(`mx:${domain}`, async () => {
    try {
      const records = await withTimeout(dns.resolveMx(domain), DNS_TIMEOUT_MS, 'MX lookup');
      return { hasMx: records.some((r) => r.exchange && r.exchange !== '.') };
    } catch (err) {
      if (['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN'].includes(err.code)) return { hasMx: false, error: err.code };
      return { hasMx: null, error: err.code || err.message };
    }
  });
}

/** -> { status: 'alive'|'dead'|'unknown', detail } */
function checkWebsite(domain) {
  return cachedLookup(`web:${domain}`, async () => {
    try {
      await withTimeout(dns.lookup(domain), DNS_TIMEOUT_MS, 'DNS lookup');
    } catch (err) {
      if (err.code === 'ENOTFOUND') return { status: 'dead', detail: "Domain doesn't resolve" };
      return { status: 'unknown', detail: `DNS: ${err.code || err.message}` };
    }
    const tryFetch = async (method, scheme = 'https') => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
      try {
        const res = await fetch(`${scheme}://${domain}`, {
          method,
          redirect: 'follow',
          signal: ctrl.signal,
          headers: { 'user-agent': 'SaaSquatchLeads/1.0 (+lead-validation; contact: see README)' },
        });
        return res.status;
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      let status = await tryFetch('HEAD').catch(() => tryFetch('HEAD', 'http')); // some small-business sites have no TLS
      if (status === 405 || status === 403) status = await tryFetch('GET'); // some servers reject HEAD
      if (status < 500) return { status: 'alive', detail: `HTTP ${status}` };
      return { status: 'dead', detail: `HTTP ${status}` };
    } catch (err) {
      return { status: 'dead', detail: err.name === 'AbortError' ? 'No response (timeout)' : 'Connection failed' };
    }
  });
}

/** -> { status: valid|risky|invalid|missing, reason, suggestion? } */
async function validateEmail(email) {
  if (!email) return { status: 'missing', reason: 'No email on record' };
  if (!rules.isValidSyntax(email)) return { status: 'invalid', reason: 'Malformed address' };

  const domain = rules.domainOf(email);
  if (rules.DOMAIN_TYPOS[domain]) {
    const fix = rules.DOMAIN_TYPOS[domain];
    return { status: 'invalid', reason: `Typo in domain — did you mean @${fix}?`, suggestion: email.replace(/@.*/, `@${fix}`) };
  }
  if (rules.isDisposable(domain)) return { status: 'invalid', reason: 'Disposable / temporary inbox' };

  const mx = await lookupMx(domain);
  if (mx.hasMx === false) return { status: 'invalid', reason: 'Domain has no mail server (no MX records)' };
  if (mx.hasMx === null) return { status: 'risky', reason: "Couldn't verify mail server (DNS timeout)" };

  if (rules.isRoleEmail(email)) return { status: 'risky', reason: `Shared inbox (${rules.localPart(email)}@) — may not reach the owner` };
  if (rules.isFreeProvider(domain)) return { status: 'valid', reason: `Personal inbox (${domain}) — common for owner-operators` };
  return { status: 'valid', reason: 'Business domain with active mail server' };
}

/** -> { status, reason, type } */
function validatePhone(phoneParsed) {
  if (!phoneParsed) return { status: 'missing', reason: 'No phone on record', type: null };
  if (!phoneParsed.valid) return { status: 'invalid', reason: 'Not a valid phone number', type: null };
  const type = phoneParsed.type;
  if (type === 'TOLL_FREE' || type === 'SHARED_COST' || type === 'PREMIUM_RATE') {
    return { status: 'risky', reason: 'Toll-free line — usually a call center, not the owner', type };
  }
  const label = { MOBILE: 'Mobile', FIXED_LINE: 'Landline', FIXED_LINE_OR_MOBILE: 'Direct line', VOIP: 'VoIP' }[type] || 'Valid number';
  return { status: 'valid', reason: label, type };
}

/** Validate one merged lead; returns fields to persist. */
async function validateLead(lead) {
  const crawledPages = lead.enrichment?.pagesCrawled?.length || 0;
  const [email, website] = await Promise.all([
    validateEmail(lead.email),
    // If the crawler already read the site, it's online: no second request needed.
    crawledPages
      ? Promise.resolve({ status: 'alive', detail: `Crawled ${crawledPages} page${crawledPages === 1 ? '' : 's'}` })
      : lead.domain && config.checkWebsites
        ? checkWebsite(lead.domain)
        : Promise.resolve(null),
  ]);
  const phone = validatePhone(lead.phoneParsed);
  return {
    emailStatus: email.status,
    emailReason: email.reason,
    emailSuggestion: email.suggestion || null,
    phoneStatus: phone.status,
    phoneReason: phone.reason,
    phoneType: phone.type,
    websiteStatus: !lead.domain ? 'missing' : website ? website.status : 'unknown',
    websiteDetail: website ? website.detail : null,
  };
}

/** Validate many leads with bounded concurrency. Returns leads with validation fields merged in. */
async function validateAll(leads, { concurrency = config.validationConcurrency, onProgress } = {}) {
  resetStats();
  const limit = pLimit(concurrency);
  let done = 0;
  const started = Date.now();
  const results = await Promise.all(
    leads.map((lead) =>
      limit(async () => {
        const result = { ...lead, ...(await validateLead(lead)) };
        done++;
        if (onProgress) onProgress(done, leads.length);
        return result;
      }),
    ),
  );
  return { leads: results, stats: { ...stats, durationMs: Date.now() - started } };
}

module.exports = { validateEmail, validatePhone, validateLead, validateAll, lookupMx, checkWebsite };
