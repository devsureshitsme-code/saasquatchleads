/**
 * One place that turns loosely-typed input (a CSV row, a Google Places result, an OSM node)
 * into the normalized "raw lead" shape the dedup/validation/scoring pipeline expects.
 */
const n = require('./normalize');

function makeRawLead(fields, { row, source }) {
  const companyName = n.cleanText(fields.companyName);
  if (!companyName) return null;
  const websiteRaw = fields.website;
  const phone = n.normalizePhone(fields.phone);
  return {
    row,
    source,
    sourceId: fields.sourceId || null,
    companyName,
    normName: n.normalizeName(companyName),
    website: n.normalizeWebsite(websiteRaw),
    domain: n.normalizeDomain(websiteRaw),
    phoneRaw: phone ? phone.raw : null,
    phone: phone ? phone.e164 || phone.raw : null,
    phoneParsed: phone,
    email: n.normalizeEmail(fields.email),
    ownerName: n.cleanText(fields.ownerName),
    ownerTitle: n.cleanText(fields.ownerTitle),
    address: n.cleanText(fields.address),
    city: n.cleanText(fields.city),
    state: n.cleanText(fields.state),
    industry: n.cleanText(fields.industry),
    revenue: typeof fields.revenue === 'number' ? fields.revenue : n.parseMoney(fields.revenue),
    revenueEstimated: false,
    employees: typeof fields.employees === 'number' ? fields.employees : n.parseIntLoose(fields.employees),
    yearFounded: typeof fields.yearFounded === 'number' ? fields.yearFounded : n.parseYear(fields.yearFounded),
    linkedin: n.cleanText(fields.linkedin),
    rating: fields.rating != null && fields.rating !== '' ? Number(fields.rating) : null,
    reviewCount: fields.reviewCount != null && fields.reviewCount !== '' ? Number(fields.reviewCount) : null,
  };
}

module.exports = { makeRawLead };
