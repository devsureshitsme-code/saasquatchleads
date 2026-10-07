const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEmail, validatePhone } = require('../src/services/validation');
const { normalizePhone } = require('../src/services/normalize');
const { scoreLead, resolveCriteria, WEIGHTS } = require('../src/services/scoring');

// These checks short-circuit before any DNS lookup, so they run offline.
test('email: missing / malformed / typo / disposable', async () => {
  assert.equal((await validateEmail(null)).status, 'missing');
  assert.equal((await validateEmail('john.smith@@gmail.com')).status, 'invalid');
  assert.equal((await validateEmail('mike at gmail.com')).status, 'invalid');
  const typo = await validateEmail('kelly@gmial.com');
  assert.equal(typo.status, 'invalid');
  assert.equal(typo.suggestion, 'kelly@gmail.com');
  assert.equal((await validateEmail('owner@mailinator.com')).status, 'invalid');
});

test('phone: valid / toll-free risky / invalid / missing', () => {
  assert.equal(validatePhone(normalizePhone('(512) 555-2671')).status, 'valid');
  assert.equal(validatePhone(normalizePhone('(800) 555-0142')).status, 'risky');
  assert.equal(validatePhone(normalizePhone('12345')).status, 'invalid');
  assert.equal(validatePhone(null).status, 'missing');
});

const ideal = {
  revenue: 3_000_000,
  employees: 20,
  yearFounded: 1995,
  industry: 'HVAC',
  ownerName: 'Jane Doe',
  ownerTitle: 'Owner',
  emailStatus: 'valid',
  phoneStatus: 'valid',
  websiteStatus: 'alive',
};

test('ideal home-services business scores 100 / tier A', () => {
  const r = scoreLead(ideal, resolveCriteria({ preset: 'home_services' }), new Date('2026-01-01'));
  assert.equal(r.score, 100);
  assert.equal(r.tier, 'A');
  assert.equal(r.reasons.length, Object.keys(WEIGHTS).length);
});

test('weights sum to 100', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('excluded industry, young company and unreachable owner score low with reasons', () => {
  const lead = { ...ideal, industry: 'Software Startup', yearFounded: 2023, revenue: 200_000, employees: 4, emailStatus: 'invalid', phoneStatus: 'missing', websiteStatus: 'dead' };
  const r = scoreLead(lead, resolveCriteria({ preset: 'home_services' }), new Date('2026-01-01'));
  assert.ok(r.score < 50, `score ${r.score}`);
  assert.equal(r.tier, 'C');
  assert.match(r.reasons.find((x) => x.key === 'industry').label, /outside acquisition thesis/);
});

test('near-band values earn half points; custom criteria override presets', () => {
  const crit = resolveCriteria({ preset: 'home_services', revenueMin: 5_000_000 });
  assert.equal(crit.revenueMin, 5_000_000);
  const r = scoreLead({ ...ideal, revenue: 3_000_000 }, crit);
  assert.equal(r.reasons.find((x) => x.key === 'revenue').points, Math.round(WEIGHTS.revenue / 2));
});

test('unknown preset falls back to home_services', () => {
  assert.equal(resolveCriteria({ preset: 'nope' }).preset, 'home_services');
});
