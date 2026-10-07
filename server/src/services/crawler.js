/**
 * Polite website crawler: reads a company's own public site (homepage + up to 3
 * contact/about/team pages) and extracts what a searcher needs that listings lack:
 * owner name, founding year, team size, emails, direct phones, social/BBB links,
 * and ownership signals (family-owned, second generation, owner-operated...).
 *
 * Rules: honours robots.txt, identifies itself, 6s timeouts, 1.5 MB page cap,
 * HTML only, results cached per domain for 7 days.
 */
const cheerio = require('cheerio');
const { findPhoneNumbersInText } = require('libphonenumber-js');
const { remember } = require('../lib/cache');
const rules = require('./emailRules');

const UA = 'SaaSquatchLeadsBot/1.0 (+lead research; respects robots.txt)';
const TIMEOUT_MS = 6000;
const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_EXTRA_PAGES = 3;
const TEXT_FOR_AI = 7000;

const SUBPAGE_RE = /(contact|about|team|our-story|story|company|who-we-are|history|leadership|staff|meet)/i;

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.5' } });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('html')) return { ok: false, status: res.status, url: res.url };
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        ctrl.abort();
        break;
      }
      chunks.push(value);
    }
    return { ok: true, status: res.status, url: res.url || url, html: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8') };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal robots.txt support: Disallow/Allow prefixes for "*" and our bot. */
function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m;
    const k = key.toLowerCase();
    if (k === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if (current && (k === 'disallow' || k === 'allow')) {
      current.rules.push({ allow: k === 'allow', path: value });
    }
  }
  const ours = groups.filter((g) => g.agents.some((a) => a.includes('saasquatchleads')));
  const applicable = ours.length ? ours : groups.filter((g) => g.agents.includes('*'));
  const list = applicable.flatMap((g) => g.rules).filter((r) => r.path);
  return (path) => {
    let best = null;
    for (const r of list) {
      if (path.startsWith(r.path) && (!best || r.path.length > best.path.length)) best = r;
    }
    return !best || best.allow;
  };
}

async function robotsFor(origin) {
  // robots.txt is text/plain (fetchPage only accepts HTML), so fetch it directly.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(`${origin}/robots.txt`, { signal: ctrl.signal, headers: { 'user-agent': UA } });
    clearTimeout(t);
    if (!r.ok) return () => true;
    return parseRobots((await r.text()).slice(0, 100_000));
  } catch {
    return () => true;
  }
}

// ----------------------------------------------------------------- extraction (pure, testable)

const YEAR_NOW = () => new Date().getFullYear();
const JUNK_EMAIL = /(\.(png|jpe?g|gif|svg|webp)$)|(@(example|domain|email|sentry|wixpress|sentry-next)\.)|(^(name|your|you|user|email)@)/i;
const OWNER_TITLE_RE = '(Owner|Co-Owner|Founder|Co-Founder|President|CEO|Principal|Proprietor)';
const NAME_RE = "([A-Z][a-z]+(?:\\s[A-Z]\\.)?(?:\\s(?:[A-Z][a-z]+|[A-Z][a-z]*['’-][A-Z]?[a-z]+)){1,2})";
const SIGNALS = [
  [/family[- ]owned|family[- ]operated|family business/i, 'Family-owned'],
  [/(second|third|fourth|2nd|3rd|4th)[- ]generation/i, 'Multi-generation family business'],
  [/owner[- ]operated|locally owned and operated|owner on (every|each) job/i, 'Owner-operated'],
  [/veteran[- ]owned/i, 'Veteran-owned'],
  [/woman[- ]owned|women[- ]owned/i, 'Woman-owned'],
  [/(owner|founder) (is )?(retiring|plans to retire)|succession|transition(ing)? ownership/i, 'Mentions retirement or succession'],
  [/now hiring|join our team|careers/i, 'Hiring'],
];

// Capitalized words that precede names in copy ("Meet Rick Alvarez, Owner") but aren't names.
const LEAD_WORDS = new Set(['meet', 'contact', 'call', 'about', 'our', 'the', 'by', 'with', 'hi', 'hello', 'welcome', 'from', 'email', 'ask', 'local', 'your', 'dear', 'mr', 'mrs', 'ms', 'dr']);
// If any of these appear inside the candidate, it's marketing copy, not a person.
const NOT_NAME_WORDS = new Set(['us', 'today', 'now', 'team', 'services', 'service', 'company', 'operated', 'owned', 'heating', 'plumbing', 'air', 'electric', 'roofing', 'llc', 'inc', 'free', 'estimate', 'quote', 'home', 'page', 'contact', 'and', 'our']);

function cleanPersonName(name) {
  if (!name) return null;
  const words = name.trim().split(/\s+/);
  while (words.length && LEAD_WORDS.has(words[0].toLowerCase().replace(/\.$/, ''))) words.shift();
  if (words.some((w) => NOT_NAME_WORDS.has(w.toLowerCase()))) return null;
  return words.length >= 2 ? words.join(' ') : null;
}

function extractFromHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, a) => links.push(String($(a).attr('href') || '').trim()));
  const mailtos = links.filter((h) => /^mailto:/i.test(h)).map((h) => decodeURIComponent(h.replace(/^mailto:/i, '').split('?')[0]).toLowerCase());
  const tels = links.filter((h) => /^tel:/i.test(h)).map((h) => h.replace(/^tel:/i, ''));
  $('script, style, noscript, svg, iframe').remove();
  // Keep words from adjacent blocks apart ("Our story</h1><p>Founded" must not become "storyFounded").
  $('p, div, li, td, th, h1, h2, h3, h4, h5, h6, br, section, article, header, footer, nav, span, a, address, dd, dt').append(' ');
  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  const emailsInText = (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase());
  const emails = [...new Set([...mailtos, ...emailsInText])].filter((e) => rules.isValidSyntax(e) && !JUNK_EMAIL.test(e));

  const phones = [
    ...new Set(
      [...tels.map((t) => findPhoneNumbersInText(t, 'US')), findPhoneNumbersInText(text.slice(0, 50_000), 'US')]
        .flat()
        .filter((p) => p.number && p.number.isValid())
        .map((p) => p.number.number),
    ),
  ].slice(0, 5);

  const socials = {};
  for (const h of links) {
    if (/linkedin\.com\/company\//i.test(h)) socials.linkedin ??= h;
    else if (/facebook\.com\//i.test(h)) socials.facebook ??= h;
    else if (/instagram\.com\//i.test(h)) socials.instagram ??= h;
    else if (/(twitter|x)\.com\//i.test(h)) socials.x ??= h;
    else if (/bbb\.org\//i.test(h)) socials.bbb ??= h;
    else if (/yelp\.com\/biz\//i.test(h)) socials.yelp ??= h;
  }

  // Founding year: "since 1987", "established in 1987", "est. 1987", "founded in 1987"
  let yearFounded = null;
  const y = text.match(/\b(?:since|established(?: in)?|est\.?|founded(?: in)?|serving [^.]{0,60}? since|in business since)\s*(18[5-9]\d|19\d{2}|20[0-2]\d)\b/i);
  const y2 = !y && text.match(/\b(?:founded|established|started|opened)\b[^.]{0,50}?\bin\s(18[5-9]\d|19\d{2}|20[0-2]\d)\b/i);
  if (y) yearFounded = Number(y[1]);
  else if (y2) yearFounded = Number(y2[1]);
  else {
    const yrs = text.match(/\b(over |more than )?(\d{1,3})\+? years (?:of experience|in business|of service|serving)/i);
    if (yrs && Number(yrs[2]) >= 3 && Number(yrs[2]) <= 120) yearFounded = YEAR_NOW() - Number(yrs[2]);
  }
  if (yearFounded && (yearFounded < 1850 || yearFounded > YEAR_NOW())) yearFounded = null;

  // Owner: "John Smith, Owner" or "Owner: John Smith" or "founded by John Smith"
  let ownerName = null;
  let ownerTitle = null;
  const a = text.match(new RegExp(`${NAME_RE},?\\s(?:–|-|—|\\|)?\\s?${OWNER_TITLE_RE}\\b`));
  const b = text.match(new RegExp(`\\b${OWNER_TITLE_RE}(?:\\s(?:&|and)\\s\\w+)?\\s?[:\\-–—|]\\s?${NAME_RE}`));
  const c = text.match(new RegExp(`\\b(?:[Ff]ounded|[Ss]tarted|[Oo]wned) by\\s${NAME_RE}`));
  if (a) [ownerName, ownerTitle] = [a[1], a[2]];
  else if (b) [ownerTitle, ownerName] = [b[1], b[2]];
  else if (c) [ownerName, ownerTitle] = [c[1], 'Founder'];
  ownerName = cleanPersonName(ownerName);
  if (!ownerName) ownerTitle = null;

  // Team size: "team of 25", "over 40 employees", "30+ technicians"
  let employees = null;
  const e = text.match(/\b(?:team of|staff of|over|more than|nearly|approximately)?\s*(\d{1,4})\+?\s+(?:full[- ]time\s+)?(?:employees|technicians|team members|professionals|staff members|crew members|licensed (?:plumbers|electricians|technicians))\b/i);
  if (e && Number(e[1]) >= 2 && Number(e[1]) <= 5000) employees = Number(e[1]);

  const signals = SIGNALS.filter(([re]) => re.test(text)).map(([, label]) => label);
  const subpages = links
    .filter((h) => h && !/^(mailto|tel|javascript|#)/i.test(h))
    .map((h) => {
      try {
        return new URL(h, pageUrl).toString();
      } catch {
        return null;
      }
    })
    .filter((u) => u && SUBPAGE_RE.test(new URL(u).pathname));

  return { title, metaDescription, text, emails, phones, socials, yearFounded, ownerName, ownerTitle, employees, signals, subpages };
}

/** Pick the best contact email: personal on the company domain > personal elsewhere > role inbox. */
function bestEmail(emails, domain) {
  const onDomain = (e) => domain && rules.domainOf(e).endsWith(domain);
  const score = (e) => (onDomain(e) ? 2 : 0) + (rules.isRoleEmail(e) ? 0 : 3);
  return [...emails].sort((x, y) => score(y) - score(x))[0] || null;
}

// ----------------------------------------------------------------- crawl

async function crawlUncached(domain) {
  let origin = `https://${domain}`;
  let home = await fetchPage(origin);
  if (!home.ok) {
    origin = `http://${domain}`;
    home = await fetchPage(origin);
  }
  if (!home.ok) return { ok: false, domain, error: home.error || `HTTP ${home.status || 'error'}`, pages: [] };
  origin = new URL(home.url).origin;

  const allowed = await robotsFor(origin);
  const pages = [];
  const merged = { emails: new Set(), phones: new Set(), socials: {}, signals: new Set(), texts: [] };
  let facts = {};

  const absorb = (url, ex) => {
    pages.push(url);
    ex.emails.forEach((x) => merged.emails.add(x));
    ex.phones.forEach((x) => merged.phones.add(x));
    Object.assign(merged.socials, { ...ex.socials, ...merged.socials });
    ex.signals.forEach((x) => merged.signals.add(x));
    merged.texts.push(`# ${url}\n${ex.title}\n${ex.metaDescription}\n${ex.text}`);
    for (const k of ['yearFounded', 'ownerName', 'ownerTitle', 'employees']) if (facts[k] == null && ex[k] != null) facts[k] = ex[k];
  };

  if (!allowed(new URL(home.url).pathname || '/')) return { ok: false, domain, error: 'Blocked by robots.txt', blockedByRobots: true, pages: [] };
  const homeEx = extractFromHtml(home.html, home.url);
  absorb(home.url, homeEx);

  const sameSite = [...new Set(homeEx.subpages)].filter((u) => new URL(u).origin === origin && allowed(new URL(u).pathname)).slice(0, MAX_EXTRA_PAGES);
  const subs = await Promise.all(sameSite.map((u) => fetchPage(u)));
  subs.forEach((p, i) => p.ok && absorb(p.url || sameSite[i], extractFromHtml(p.html, p.url || sameSite[i])));

  const emails = [...merged.emails];
  return {
    ok: true,
    domain,
    pages,
    emails,
    bestEmail: bestEmail(emails, domain),
    phones: [...merged.phones],
    socials: merged.socials,
    signals: [...merged.signals],
    ...facts,
    text: merged.texts.join('\n\n').slice(0, TEXT_FOR_AI),
  };
}

function crawl(domain) {
  return remember(`crawl:${domain}`, 7 * 86400, () => crawlUncached(domain)).then((r) => r.value);
}

module.exports = { crawl, crawlUncached, extractFromHtml, parseRobots, bestEmail };
