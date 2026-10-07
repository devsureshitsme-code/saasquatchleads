const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('../src/services/normalize');

test('normalizeName strips legal suffixes, punctuation and filler', () => {
  assert.equal(n.normalizeName('The Acme HVAC, L.L.C.'), 'acme hvac');
  assert.equal(n.normalizeName('ACME HVAC LLC'), 'acme hvac');
  assert.equal(n.normalizeName('Smith & Sons Plumbing Co.'), 'smith sons plumbing');
  assert.equal(n.normalizeName(''), '');
});

test('normalizeDomain handles protocols, www, paths, case and emails', () => {
  assert.equal(n.normalizeDomain('HTTPS://www.AcmeHVAC.com/about?x=1'), 'acmehvac.com');
  assert.equal(n.normalizeDomain('www.acme.co.uk/contact'), 'acme.co.uk');
  assert.equal(n.normalizeDomain('owner@acme.com'), 'acme.com');
  assert.equal(n.normalizeDomain('not a domain'), null);
  assert.equal(n.normalizeDomain('N/A'), null);
});

test('normalizePhone produces E.164 and detects toll-free / invalid', () => {
  const a = n.normalizePhone('(512) 555-2671');
  const b = n.normalizePhone('+1 512 555 2671');
  assert.equal(a.e164, '+15125552671');
  assert.equal(a.e164, b.e164);
  assert.equal(n.normalizePhone('(800) 555-0142').type, 'TOLL_FREE');
  assert.equal(n.normalizePhone('12345').valid, false);
  assert.equal(n.normalizePhone(''), null);
});

test('parseMoney / parseIntLoose / parseYear are forgiving', () => {
  assert.equal(n.parseMoney('$1.2M'), 1200000);
  assert.equal(n.parseMoney('1,500,000'), 1500000);
  assert.equal(n.parseMoney('750k'), 750000);
  assert.equal(n.parseMoney(''), null);
  assert.equal(n.parseIntLoose('11-50'), 31);
  assert.equal(n.parseIntLoose('25'), 25);
  assert.equal(n.parseYear('Est. 1998'), 1998);
  assert.equal(n.parseYear('3000'), null);
});
