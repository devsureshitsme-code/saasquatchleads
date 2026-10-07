/**
 * Normalization: turns messy scraped values into comparable, canonical forms.
 * Everything downstream (dedup, validation, scoring) relies on these.
 */
const { parsePhoneNumberFromString } = require('libphonenumber-js');

// Words that don't identify a business: legal suffixes and filler.
const NAME_STOPWORDS = new Set([
  'llc', 'l', 'inc', 'incorporated', 'co', 'corp', 'corporation', 'company', 'ltd', 'limited',
  'pllc', 'pc', 'lp', 'llp', 'the', 'and', 'of', 'group', 'services', 'service',
]);

/** "The Acme HVAC, L.L.C." -> "acme hvac" */
function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1') // L.L.C. -> llc
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NAME_STOPWORDS.has(w))
    .join(' ')
    .trim();
}

/** "HTTPS://www.AcmeHVAC.com/about?x=1" -> "acmehvac.com" */
function normalizeDomain(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (!s || s === 'n/a' || s === 'none') return null;
  if (s.includes('@')) s = s.split('@').pop(); // allow deriving from an email
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\d?\./, '');
  s = s.split(/[/?#:]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}

/** Website URL suitable for linking / checking, or null. */
function normalizeWebsite(input) {
  const domain = normalizeDomain(input);
  return domain ? `https://${domain}` : null;
}

/**
 * Phone -> { e164, national, valid, type } using libphonenumber (US default).
 * Returns null for blanks.
 */
function normalizePhone(input, defaultCountry = 'US') {
  if (input === undefined || input === null) return null;
  const raw = String(input).trim();
  if (!raw || /^n\/?a$/i.test(raw)) return null;
  const parsed = parsePhoneNumberFromString(raw, defaultCountry);
  if (!parsed) return { raw, e164: null, national: raw, valid: false, type: null };
  return {
    raw,
    e164: parsed.number,
    national: parsed.formatNational(),
    valid: parsed.isValid(),
    type: parsed.getType() || null,
  };
}

function normalizeEmail(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  return s || null;
}

/** "$1.2M", "1,200,000", "1200k" -> 1200000 */
function parseMoney(input) {
  if (input === undefined || input === null || input === '') return null;
  const s = String(input).trim().toLowerCase().replace(/[$,\s]/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)([kmb])?/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

/** "11-50" -> 30, "25" -> 25 */
function parseIntLoose(input) {
  if (input === undefined || input === null || input === '') return null;
  const nums = String(input).replace(/,/g, '').match(/\d+/g);
  if (!nums) return null;
  if (nums.length >= 2) return Math.round((Number(nums[0]) + Number(nums[1])) / 2);
  return Number(nums[0]);
}

function parseYear(input) {
  const n = parseIntLoose(input);
  const now = new Date().getFullYear();
  return n && n >= 1800 && n <= now ? n : null;
}

function cleanText(input) {
  if (input === undefined || input === null) return null;
  const s = String(input).trim().replace(/\s+/g, ' ');
  return s && !/^n\/?a$/i.test(s) ? s : null;
}

module.exports = {
  normalizeName,
  normalizeDomain,
  normalizeWebsite,
  normalizePhone,
  normalizeEmail,
  parseMoney,
  parseIntLoose,
  parseYear,
  cleanText,
};
