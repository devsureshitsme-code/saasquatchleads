/**
 * Enrichment: crawl each company's website, optionally ask Claude to read it, and fill
 * gaps in the lead. Existing data is never overwritten. Every filled field records where
 * it came from (provenance), so the UI can say "owner found on website" vs "from Google".
 */
const pLimit = require('p-limit');
const crawler = require('./crawler');
const ai = require('./ai');
const { normalizePhone } = require('./normalize');

const CRAWL_CONCURRENCY = 8;
// Free AI tiers are rate limited: keep concurrency low and cap AI calls per job (the rest use rule-based extraction).
const AI_CONCURRENCY = () => Number(process.env.AI_CONCURRENCY) || 2;
const AI_MAX_PER_JOB = () => Number(process.env.AI_MAX_PER_JOB) || 40;

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

function applyEnrichment(lead, crawlRes, aiRes) {
  const out = { ...lead };
  const prov = { ...(lead.enrichment?.provenance || {}) };
  const set = (field, value, source) => {
    if ((out[field] === null || out[field] === undefined || out[field] === '') && value !== null && value !== undefined && value !== '') {
      out[field] = value;
      prov[field] = source;
    }
  };

  if (crawlRes && crawlRes.ok) {
    set('email', crawlRes.bestEmail, 'website');
    if (!out.phone && crawlRes.phones?.[0]) {
      const p = normalizePhone(crawlRes.phones[0]);
      out.phone = p.e164 || p.raw;
      out.phoneRaw = p.raw;
      out.phoneParsed = p;
      prov.phone = 'website';
    }
    set('linkedin', crawlRes.socials?.linkedin, 'website');
  }

  // Owner: Claude reads context better than a regex, so prefer it; regex is the fallback.
  if (aiRes && aiRes.owner_name) {
    set('ownerName', aiRes.owner_name, 'ai');
    if (prov.ownerName === 'ai') set('ownerTitle', aiRes.owner_title, 'ai');
  }
  if (crawlRes && crawlRes.ok && crawlRes.ownerName) {
    set('ownerName', crawlRes.ownerName, 'website');
    if (prov.ownerName === 'website') set('ownerTitle', crawlRes.ownerTitle, 'website');
  }

  // Founding year and headcount: stated phrases first (deterministic), then Claude.
  if (crawlRes && crawlRes.ok) {
    set('yearFounded', crawlRes.yearFounded, 'website');
    set('employees', crawlRes.employees, 'website');
  }
  if (aiRes) {
    set('yearFounded', aiRes.year_founded, 'ai');
    set('employees', aiRes.employee_estimate, 'ai');
  }

  // Revenue estimate from headcount when no revenue was supplied.
  if ((out.revenue === null || out.revenue === undefined) && out.employees) {
    out.revenue = ai.estimateRevenue(out.industry, out.employees);
    out.revenueEstimated = true;
    prov.revenue = 'estimate';
  }

  const signals = uniq([
    ...(lead.signals || []),
    ...((crawlRes && crawlRes.ok && crawlRes.signals) || []),
    ...((aiRes && aiRes.ownership_signals) || []),
    aiRes && aiRes.family_owned ? 'Family-owned' : null,
  ]);
  // Collapse near-duplicate signals from the two sources ("Family-owned" vs "family owned business").
  const seen = new Set();
  out.signals = signals.filter((s) => {
    const k = s.toLowerCase().replace(/[^a-z]/g, '').replace(/business|company/g, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  out.socials = { ...((crawlRes && crawlRes.socials) || {}), ...(lead.socials || {}) };
  if (aiRes && aiRes.summary) out.aiSummary = aiRes.summary;
  out.enrichment = {
    provenance: prov,
    pagesCrawled: (crawlRes && crawlRes.pages) || [],
    emailsFound: (crawlRes && crawlRes.emails) || [],
    phonesFound: (crawlRes && crawlRes.phones) || [],
    services: (aiRes && aiRes.services) || [],
    aiIndustry: (aiRes && aiRes.industry) || null,
    acquisitionNotes: (aiRes && aiRes.acquisition_notes) || null,
    crawlError: crawlRes && !crawlRes.ok ? crawlRes.error : null,
    aiError: lead.enrichment?.aiError || null,
  };
  return out;
}

/**
 * @param {Array} leads deduped leads
 * @param {{ crawl?: boolean, useAi?: boolean, onStage?: (stage, done, total) => void }} opts
 */
async function enrichAll(leads, { crawl = true, useAi = true, onStage = () => {} } = {}) {
  const stats = { crawled: 0, crawlFailed: 0, blockedByRobots: 0, aiEnriched: 0, aiFailed: 0, fieldsFilled: {} };
  const crawlResults = new Map();

  // Pass 1: crawl websites
  if (crawl) {
    const withSite = leads.filter((l) => l.domain);
    const limit = pLimit(CRAWL_CONCURRENCY);
    let done = 0;
    onStage('crawling', 0, withSite.length);
    await Promise.all(
      withSite.map((l) =>
        limit(async () => {
          const r = await crawler.crawl(l.domain).catch((err) => ({ ok: false, error: err.message }));
          crawlResults.set(l.domain, r);
          if (r.ok) stats.crawled++;
          else if (r.blockedByRobots) stats.blockedByRobots++;
          else stats.crawlFailed++;
          onStage('crawling', ++done, withSite.length);
        }),
      ),
    );
  }

  // Pass 2: Claude reads the crawled text
  const aiResults = new Map();
  const aiErrors = new Map();
  if (useAi && ai.available()) {
    const readable = leads
      .filter((l) => l.domain && crawlResults.get(l.domain)?.ok && (crawlResults.get(l.domain).text || '').length > 200)
      // When capped, spend AI calls on the most established businesses first.
      .sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0))
      .slice(0, AI_MAX_PER_JOB());
    stats.aiSkippedByCap = Math.max(0, leads.filter((l) => l.domain && crawlResults.get(l.domain)?.ok).length - readable.length);
    const limit = pLimit(AI_CONCURRENCY());
    let done = 0;
    onStage('analyzing', 0, readable.length);
    await Promise.all(
      readable.map((l) =>
        limit(async () => {
          try {
            aiResults.set(l.domain, await ai.enrichCompany(l, crawlResults.get(l.domain)));
            stats.aiEnriched++;
          } catch (err) {
            aiErrors.set(l.domain, err.message);
            stats.aiFailed++;
          }
          onStage('analyzing', ++done, readable.length);
        }),
      ),
    );
  }

  const enriched = leads.map((l) => {
    const base = aiErrors.has(l.domain) ? { ...l, enrichment: { aiError: aiErrors.get(l.domain) } } : l;
    const out = applyEnrichment(base, crawlResults.get(l.domain), aiResults.get(l.domain));
    for (const f of Object.keys(out.enrichment.provenance)) {
      if (!l.enrichment?.provenance?.[f]) stats.fieldsFilled[f] = (stats.fieldsFilled[f] || 0) + 1;
    }
    return out;
  });
  return { leads: enriched, stats };
}

module.exports = { enrichAll, applyEnrichment };
