/**
 * Generates sample-data/leads_sample.csv: ~200 fictional small businesses shaped like a
 * SaaSquatch / scraper export, with realistic mess planted on purpose:
 *   - duplicates (same domain, same phone in another format, near-identical names in the same city)
 *   - bad emails (syntax errors, disposable domains, role inboxes like info@)
 *   - bad phones (too short, toll-free numbers)
 *   - inconsistent formatting (www., https://, "LLC" vs "L.L.C.", upper/lower case)
 *
 * All companies and people are fictional. Run: node sample-data/generate.js
 */
const fs = require('fs');
const path = require('path');

// Deterministic RNG so the file is reproducible.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (min, max) => Math.floor(min + rand() * (max - min + 1));

const prefixes = ['Summit', 'Copperline', 'Bluewater', 'Ironwood', 'Redstone', 'Prairie', 'Harbor', 'Granite', 'Lakeside',
  'Evergreen', 'Northstar', 'Silver Creek', 'Oak Hollow', 'Cardinal', 'Liberty', 'Keystone', 'Riverbend', 'Pinecrest',
  'Sunrise', 'Heritage', 'Frontier', 'Maple Leaf', 'Cobalt', 'Westfield', 'Stonegate', 'Clearview', 'Trailhead', 'Bay Point',
  'Highland', 'Arrowhead', 'Mesa', 'Golden Gate', 'Timberline', 'Crescent', 'Patriot', 'Union Square', 'Brightpath', 'Fox Run'];

const industries = [
  { name: 'HVAC', suffixes: ['Heating & Air', 'HVAC', 'Climate Control', 'Air Systems'] },
  { name: 'Plumbing', suffixes: ['Plumbing', 'Plumbing & Drain', 'Pipe Works'] },
  { name: 'Landscaping', suffixes: ['Landscaping', 'Lawn & Garden', 'Outdoor Services'] },
  { name: 'Electrical', suffixes: ['Electric', 'Electrical Contractors', 'Power Services'] },
  { name: 'IT Services', suffixes: ['IT Solutions', 'Technology Group', 'Managed IT', 'Networks'] },
  { name: 'Accounting', suffixes: ['Accounting', 'CPA Group', 'Tax & Advisory', 'Bookkeeping'] },
  { name: 'Pest Control', suffixes: ['Pest Control', 'Pest Solutions', 'Exterminators'] },
  { name: 'Commercial Cleaning', suffixes: ['Cleaning Services', 'Janitorial', 'Facility Services'] },
  { name: 'Roofing', suffixes: ['Roofing', 'Roofing & Exteriors'] },
  { name: 'Auto Repair', suffixes: ['Auto Repair', 'Automotive', 'Auto Care'] },
  { name: 'Restaurant', suffixes: ['Grill', 'Bistro', 'Kitchen'] },
  { name: 'Retail', suffixes: ['Boutique', 'Outfitters', 'Supply Co'] },
  { name: 'Software Startup', suffixes: ['Labs', 'Software', 'Apps'] },
];

const legal = ['LLC', 'Inc.', 'L.L.C.', 'Co.', 'Corp', '', '', ''];

const cities = [
  ['Austin', 'TX', '512'], ['Dallas', 'TX', '214'], ['Phoenix', 'AZ', '602'], ['Denver', 'CO', '303'], ['Charlotte', 'NC', '704'],
  ['Nashville', 'TN', '615'], ['Columbus', 'OH', '614'], ['Indianapolis', 'IN', '317'], ['Tampa', 'FL', '813'],
  ['Atlanta', 'GA', '404'], ['Kansas City', 'MO', '816'], ['Salt Lake City', 'UT', '801'], ['Raleigh', 'NC', '919'],
  ['Omaha', 'NE', '402'], ['Boise', 'ID', '208'], ['Richmond', 'VA', '804'],
];

const firstNames = ['James', 'Linda', 'Robert', 'Patricia', 'Michael', 'Barbara', 'David', 'Susan', 'Richard', 'Karen', 'Thomas',
  'Nancy', 'Mark', 'Donna', 'Gary', 'Carol', 'Steven', 'Sandra', 'Kevin', 'Deborah', 'Brian', 'Sharon', 'Ronald', 'Cynthia',
  'Daniel', 'Angela', 'Paul', 'Brenda', 'Dennis', 'Pamela', 'Jerry', 'Teresa', 'Raj', 'Maria', 'Luis', 'Mei', 'Ahmed', 'Olga'];
const lastNames = ['Miller', 'Anderson', 'Thompson', 'Garcia', 'Martinez', 'Robinson', 'Clark', 'Rodriguez', 'Lewis', 'Walker',
  'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Carter', 'Mitchell', 'Perez',
  'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Patel', 'Nguyen', 'Kowalski', 'Okafor'];
const titles = ['Owner', 'Owner', 'Founder & Owner', 'President', 'CEO', 'Managing Partner', 'Office Manager', 'General Manager'];

const freeProviders = ['gmail.com', 'yahoo.com', 'outlook.com', 'aol.com', 'icloud.com', 'hotmail.com'];

const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

function makePhone(area) {
  return { area, exch: between(201, 989), line: between(1000, 9999) };
}
function formatPhone(p, style) {
  const { area, exch, line } = p;
  switch (style) {
    case 0: return `(${area}) ${exch}-${line}`;
    case 1: return `${area}-${exch}-${line}`;
    case 2: return `+1 ${area} ${exch} ${line}`;
    case 3: return `${area}.${exch}.${line}`;
    default: return `1${area}${exch}${line}`;
  }
}

function makeCompany() {
  const ind = pick(industries);
  const name = `${pick(prefixes)} ${pick(ind.suffixes)}`;
  const [city, state, area] = pick(cities);
  const first = pick(firstNames);
  const last = pick(lastNames);
  const domain = `${slug(name)}.com`;
  const isStartup = ind.name === 'Software Startup';
  const founded = isStartup ? between(2019, 2024) : rand() < 0.75 ? between(1975, 2012) : between(2013, 2023);
  const employees = isStartup ? between(2, 12) : rand() < 0.8 ? between(6, 60) : between(70, 400);
  const revenue = isStartup
    ? between(50, 900) * 1000
    : Math.round((employees * between(90, 180) * 1000) / 10000) * 10000;

  const r = rand();
  let email;
  if (r < 0.55) email = `${slug(first)}${pick(['', '.', '_'])}${slug(last)}${rand() < 0.3 ? between(1, 99) : ''}@${pick(freeProviders)}`;
  else if (r < 0.85) email = `${slug(first)}@${domain}`;
  else if (r < 0.93) email = `info@${domain}`;
  else email = '';

  return {
    name,
    legal: pick(legal),
    industry: ind.name,
    city,
    state,
    phone: makePhone(area),
    domain,
    email,
    owner: `${first} ${last}`,
    title: pick(titles),
    founded,
    employees,
    revenue,
    linkedin: rand() < 0.6 ? `https://www.linkedin.com/company/${slug(name)}` : '',
  };
}

function toRow(c, overrides = {}) {
  const websiteStyle = between(0, 3);
  const website = [`https://www.${c.domain}`, `http://${c.domain}`, `www.${c.domain}/contact`, c.domain.toUpperCase()][websiteStyle];
  return {
    'Company Name': `${c.name}${c.legal ? (c.legal.startsWith(',') ? c.legal : ` ${c.legal}`) : ''}`,
    Website: rand() < 0.92 ? website : '',
    Phone: formatPhone(c.phone, between(0, 4)),
    Email: c.email,
    'Owner Name': rand() < 0.85 ? c.owner : '',
    'Owner Title': c.title,
    City: c.city,
    State: c.state,
    Industry: c.industry,
    'Estimated Revenue': rand() < 0.9 ? c.revenue : '',
    Employees: rand() < 0.9 ? c.employees : '',
    'Year Founded': rand() < 0.88 ? c.founded : '',
    LinkedIn: c.linkedin,
    ...overrides,
  };
}

// Each fictional business gets a unique name (=> unique domain) and a unique owner email.
const seenNames = new Set();
const seenEmails = new Set();
const companies = [];
while (companies.length < 165) {
  const c = makeCompany();
  if (seenNames.has(c.name) || (c.email && seenEmails.has(c.email))) continue;
  seenNames.add(c.name);
  if (c.email) seenEmails.add(c.email);
  companies.push(c);
}

const rows = companies.map((c) => toRow(c));

// --- Plant duplicates (about 40 extra rows) ---------------------------------
for (let i = 0; i < 40; i++) {
  const c = companies[between(0, companies.length - 1)];
  const kind = i % 4;
  if (kind === 0) {
    // Same company from another source: same domain, different name casing / suffix, phone formatted differently
    rows.push(toRow(c, { 'Company Name': `${c.name.toUpperCase()} ${pick(['LLC', 'INC', ''])}`.trim(), 'Owner Name': '', Email: '' }));
  } else if (kind === 1) {
    // Same phone, no website, slightly different name ("The ...", "&" vs "and")
    rows.push(toRow(c, { 'Company Name': `The ${c.name.replace('&', 'and')}`, Website: '', LinkedIn: '' }));
  } else if (kind === 2) {
    // Fuzzy name typo, same city, no phone/website: only name+city can match it
    const typo = c.name.length > 6 ? c.name.slice(0, 3) + c.name.slice(4) : c.name;
    rows.push(toRow(c, { 'Company Name': `${typo} ${c.legal}`.trim(), Website: '', Phone: '', Email: c.email }));
  } else {
    // Exact duplicate row (scraped twice)
    rows.push(toRow(c));
  }
}

// --- Plant bad contact data -------------------------------------------------
const badEmails = ['john.smith@@gmail.com', 'owner@mailinator.com', 'contact@guerrillamail.com', 'mike at gmail.com',
  'sales@', 'test@10minutemail.com', 'admin@tempmail.net', 'kelly.ross@gmial.con'];
const badPhones = ['555-0199', '(800) 555-0142', '1-888-555-0110', '12345', '(877) 555-0187', 'N/A'];
for (let i = 0; i < badEmails.length; i++) rows[between(0, 164)].Email = badEmails[i];
for (let i = 0; i < badPhones.length; i++) rows[between(0, 164)].Phone = badPhones[i];

// Shuffle so duplicates are not adjacent
for (let i = rows.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [rows[i], rows[j]] = [rows[j], rows[i]];
}

const headers = Object.keys(rows[0]);
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n') + '\n';

const out = path.join(__dirname, 'leads_sample.csv');
fs.writeFileSync(out, csv);
console.log(`Wrote ${rows.length} rows (${companies.length} real companies + ${rows.length - companies.length} planted duplicates) to ${out}`);
