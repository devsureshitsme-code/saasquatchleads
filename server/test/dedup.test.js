const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseLeadsCsv, detectColumns } = require('../src/services/csv');
const { dedupe, nameSimilarity } = require('../src/services/dedup');

const csv = (rows) => ['Company Name,Website,Phone,Email,City', ...rows].join('\n');

test('detectColumns maps common header variants', () => {
  const { mapping } = detectColumns(['Business Name', 'URL', 'Telephone', 'E-mail Address', 'Town', 'Annual Revenue', 'Headcount']);
  assert.equal(mapping.companyName, 'Business Name');
  assert.equal(mapping.website, 'URL');
  assert.equal(mapping.phone, 'Telephone');
  assert.equal(mapping.email, 'E-mail Address');
  assert.equal(mapping.city, 'Town');
  assert.equal(mapping.revenue, 'Annual Revenue');
  assert.equal(mapping.employees, 'Headcount');
});

test('merges on same domain even with different names and formats', () => {
  const { leads } = parseLeadsCsv(csv(['Acme HVAC LLC,https://www.acmehvac.com,,,Austin', 'ACME HEATING,acmehvac.com/contact,,,Dallas']));
  const { records, stats } = dedupe(leads);
  assert.equal(records.length, 1);
  assert.equal(stats.linksBy.domain, 1);
  assert.equal(records[0].companyName, 'Acme HVAC LLC'); // not the ALL-CAPS variant
});

test('merges on same phone in different formats', () => {
  const { leads } = parseLeadsCsv(csv(['Acme,,(512) 555-2671,,Austin', 'Acme Heating,,+1 512 555 2671,,Austin']));
  assert.equal(dedupe(leads).records.length, 1);
});

test('does NOT merge on a shared toll-free number', () => {
  const { leads } = parseLeadsCsv(csv(['Franchise A,,(800) 555-0142,,Austin', 'Franchise B,,1-800-555-0142,,Denver']));
  assert.equal(dedupe(leads).records.length, 2);
});

test('fuzzy name match requires same city and no conflicting domain', () => {
  const sameCity = parseLeadsCsv(csv(['Copperline Plumbing,,,,Austin', 'Coperline Plumbing LLC,,,,Austin'])).leads;
  assert.equal(dedupe(sameCity).records.length, 1);

  const otherCity = parseLeadsCsv(csv(['Copperline Plumbing,,,,Austin', 'Coperline Plumbing LLC,,,,Denver'])).leads;
  assert.equal(dedupe(otherCity).records.length, 2);

  const conflict = parseLeadsCsv(csv(['Copperline Plumbing,a.com,,,Austin', 'Coperline Plumbing,b.com,,,Austin'])).leads;
  assert.equal(dedupe(conflict).records.length, 2);
});

test('links are transitive (A~B by domain, B~C by phone)', () => {
  const { leads } = parseLeadsCsv(
    csv(['Acme,acme.com,,,Austin', 'Acme Co,acme.com,(512) 555-2671,,Austin', 'Totally Different Name,,512.555.2671,,Austin']),
  );
  const { records } = dedupe(leads);
  assert.equal(records.length, 1);
  assert.equal(records[0].mergedCount, 3);
  assert.equal(records[0].mergedFrom.length, 3);
});

test('golden record prefers personal email over role inbox and fills gaps', () => {
  const { leads } = parseLeadsCsv(csv(['Acme,acme.com,,info@acme.com,Austin', 'Acme,acme.com,(512) 555-2671,jane@acme.com,']));
  const [r] = dedupe(leads).records;
  assert.equal(r.email, 'jane@acme.com');
  assert.equal(r.phone, '+15125552671');
  assert.equal(r.city, 'Austin');
});

test('nameSimilarity is symmetric and bounded', () => {
  assert.equal(nameSimilarity('abc', 'abc'), 1);
  assert.equal(nameSimilarity('', 'abc'), 0);
  assert.equal(nameSimilarity('acme hvac', 'acme hvc'), nameSimilarity('acme hvc', 'acme hvac'));
});

test('sample dataset: exactly the 40 planted duplicates are merged', () => {
  const file = path.resolve(__dirname, '../../sample-data/leads_sample.csv');
  const { leads } = parseLeadsCsv(fs.readFileSync(file, 'utf8'));
  const { stats } = dedupe(leads);
  assert.equal(stats.inputRows, 205);
  assert.equal(stats.uniqueLeads, 165);
});
