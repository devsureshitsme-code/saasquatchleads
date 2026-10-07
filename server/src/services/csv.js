/**
 * CSV ingestion: parses an uploaded file and maps arbitrary column headers
 * (SaaSquatch export, Apollo, a hand-made sheet...) onto our canonical fields.
 */
const Papa = require('papaparse');
const n = require('./normalize');

// canonical field -> header aliases (compared after lowercasing and stripping non-alphanumerics)
const FIELD_ALIASES = {
  companyName: ['companyname', 'company', 'businessname', 'business', 'name', 'organization', 'accountname'],
  website: ['website', 'url', 'web', 'domain', 'companywebsite', 'site', 'homepage'],
  phone: ['phone', 'phonenumber', 'telephone', 'tel', 'companyphone', 'mainphone', 'mobile'],
  email: ['email', 'emailaddress', 'owneremail', 'contactemail', 'workemail'],
  ownerName: ['ownername', 'owner', 'contactname', 'contact', 'fullname', 'decisionmaker', 'person'],
  ownerTitle: ['ownertitle', 'title', 'jobtitle', 'contacttitle', 'position', 'role'],
  city: ['city', 'town', 'locality'],
  state: ['state', 'region', 'province', 'st'],
  industry: ['industry', 'category', 'sector', 'vertical', 'businesstype'],
  revenue: ['estimatedrevenue', 'revenue', 'annualrevenue', 'sales', 'revenueestimate'],
  employees: ['employees', 'employeecount', 'numberofemployees', 'headcount', 'size', 'companysize', 'staff'],
  yearFounded: ['yearfounded', 'founded', 'foundedyear', 'yearestablished', 'established', 'since'],
  linkedin: ['linkedin', 'linkedinurl', 'companylinkedin', 'linkedinprofile'],
};

const key = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Returns { mapping: {field: header}, unmapped: [header] } */
function detectColumns(headers) {
  const mapping = {};
  const used = new Set();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    // exact alias match first, in alias priority order
    for (const alias of aliases) {
      const header = headers.find((h) => !used.has(h) && key(h) === alias);
      if (header) {
        mapping[field] = header;
        used.add(header);
        break;
      }
    }
  }
  return { mapping, unmapped: headers.filter((h) => !used.has(h)) };
}

/** Parse CSV text into canonical, normalized raw leads (one per row, pre-dedup). */
function parseLeadsCsv(text) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  const headers = parsed.meta.fields || [];
  const { mapping, unmapped } = detectColumns(headers);

  if (!mapping.companyName) {
    const err = new Error('Could not find a company name column. Expected a header like "Company Name" or "Business".');
    err.status = 400;
    throw err;
  }

  const get = (row, field) => (mapping[field] ? row[mapping[field]] : undefined);
  const leads = [];
  const skipped = [];

  parsed.data.forEach((row, i) => {
    const companyName = n.cleanText(get(row, 'companyName'));
    const rowNumber = i + 2; // header is row 1
    if (!companyName) {
      skipped.push({ row: rowNumber, reason: 'missing company name' });
      return;
    }
    const websiteRaw = get(row, 'website');
    const phone = n.normalizePhone(get(row, 'phone'));
    leads.push({
      row: rowNumber,
      companyName,
      normName: n.normalizeName(companyName),
      website: n.normalizeWebsite(websiteRaw),
      domain: n.normalizeDomain(websiteRaw),
      phoneRaw: phone ? phone.raw : null,
      phone: phone ? phone.e164 || phone.raw : null,
      phoneParsed: phone,
      email: n.normalizeEmail(get(row, 'email')),
      ownerName: n.cleanText(get(row, 'ownerName')),
      ownerTitle: n.cleanText(get(row, 'ownerTitle')),
      city: n.cleanText(get(row, 'city')),
      state: n.cleanText(get(row, 'state')),
      industry: n.cleanText(get(row, 'industry')),
      revenue: n.parseMoney(get(row, 'revenue')),
      employees: n.parseIntLoose(get(row, 'employees')),
      yearFounded: n.parseYear(get(row, 'yearFounded')),
      linkedin: n.cleanText(get(row, 'linkedin')),
    });
  });

  return {
    leads,
    skipped,
    mapping,
    unmapped,
    parseErrors: parsed.errors.slice(0, 20).map((e) => ({ row: (e.row ?? 0) + 2, message: e.message })),
  };
}

/** Serialize processed leads back to CSV for export. */
function leadsToCsv(leads) {
  const rows = leads.map((l) => ({
    Score: l.score,
    Tier: l.tier,
    'Company Name': l.companyName,
    Website: l.website || '',
    Domain: l.domain || '',
    Phone: l.phone || '',
    'Phone Status': l.phoneStatus || '',
    Email: l.email || '',
    'Email Status': l.emailStatus || '',
    'Email Note': l.emailReason || '',
    'Owner Name': l.ownerName || '',
    'Owner Title': l.ownerTitle || '',
    City: l.city || '',
    State: l.state || '',
    Industry: l.industry || '',
    'Estimated Revenue': l.revenue ?? '',
    'Revenue Is Estimate': l.revenueEstimated ? 'yes' : '',
    Employees: l.employees ?? '',
    'Year Founded': l.yearFounded ?? '',
    'Website Status': l.websiteStatus || '',
    'Records Merged': l.mergedCount,
    'Found In': (l.sources || []).join('; '),
    Rating: l.rating ?? '',
    Reviews: l.reviewCount ?? '',
    Address: l.address || '',
    'Ownership Signals': (l.signals || []).join('; '),
    'AI Summary': l.aiSummary || '',
    'Score Reasons': (l.scoreReasons || []).filter((r) => r.points > 0).map((r) => `${r.label} (+${r.points})`).join('; '),
    LinkedIn: l.linkedin || '',
  }));
  return Papa.unparse(rows);
}

module.exports = { parseLeadsCsv, detectColumns, leadsToCsv, FIELD_ALIASES };
