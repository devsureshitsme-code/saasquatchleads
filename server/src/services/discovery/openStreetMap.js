/**
 * OpenStreetMap — free, keyless fallback.
 *   1. Nominatim geocodes the location to a bounding box (cached 30 days; 1 req/s policy).
 *   2. Overpass returns businesses inside the box whose tags match the industry.
 * Coverage of phones/websites is thinner than Google, which is why the website crawler matters.
 * Data © OpenStreetMap contributors, ODbL.
 */
const { makeRawLead } = require('../leadShape');
const { remember } = require('../../lib/cache');

const NOMINATIM = () => process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
const OVERPASS = () => process.env.OVERPASS_BASE_URL || 'https://overpass-api.de';
const UA = 'SaaSquatchLeads/1.0 (lead research tool; see README)';

// Industry keyword -> OSM tag filters. Matched by substring against the lowercased industry.
const INDUSTRY_TAGS = [
  [['hvac', 'heating', 'air conditioning'], ['craft=hvac']],
  [['plumb'], ['craft=plumber']],
  [['electric'], ['craft=electrician']],
  [['roof'], ['craft=roofer']],
  [['landscap', 'lawn', 'garden'], ['craft=gardener', 'shop=garden_centre']],
  [['pest'], ['craft=pest_control', 'shop=pest_control']],
  [['clean', 'janitorial'], ['shop=dry_cleaning', 'office=cleaning', 'craft=cleaning']],
  [['account', 'bookkeep', 'cpa', 'tax'], ['office=accountant', 'office=tax_advisor']],
  [['it service', 'managed it', 'software', 'technology', 'it support'], ['office=it', 'office=company', 'craft=computer']],
  [['law', 'legal', 'attorney'], ['office=lawyer']],
  [['insurance'], ['office=insurance']],
  [['real estate', 'realtor'], ['office=estate_agent']],
  [['financial', 'finance', 'wealth'], ['office=financial', 'office=financial_advisor']],
  [['dental', 'dentist'], ['amenity=dentist', 'healthcare=dentist']],
  [['health', 'medical', 'clinic', 'doctor'], ['amenity=clinic', 'amenity=doctors', 'healthcare=clinic', 'healthcare=doctor']],
  [['veterin', 'animal'], ['amenity=veterinary']],
  [['auto', 'car repair', 'mechanic'], ['shop=car_repair']],
  [['restaurant', 'food'], ['amenity=restaurant']],
  [['manufactur', 'fabricat', 'machine shop'], ['man_made=works', 'craft=metal_construction']],
  [['construct', 'contractor', 'builder'], ['craft=builder', 'office=construction_company'], { generic: true }],
  [['retail', 'store', 'shop'], ['shop']],
];

function tagsFor(industry) {
  const ind = String(industry || '').toLowerCase();
  const matches = INDUSTRY_TAGS.filter(([keys]) => keys.some((k) => ind.includes(k)));
  // "HVAC contractors" should search HVAC, not every builder: generic groups only apply alone.
  const specific = matches.filter(([, , opts]) => !opts?.generic);
  const found = (specific.length ? specific : matches).flatMap(([, tags]) => tags);
  return [...new Set(found)];
}

const esc = (s) => String(s).replace(/[\\"]/g, '\\$&');

function buildOverpassQuery(industry, bbox, limit) {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const tags = tagsFor(industry);
  const selectors = tags.map((t) => {
    const [k, v] = t.split('=');
    return v ? `nwr["${k}"="${v}"]["name"](${box});` : `nwr["${k}"]["name"](${box});`;
  });
  // Always also match the keyword in the business name (catches untagged or oddly tagged businesses).
  const keyword = String(industry || '').trim().split(/\s+/)[0];
  if (keyword && keyword.length >= 3) selectors.push(`nwr["name"~"${esc(keyword)}",i](${box});`);
  return `[out:json][timeout:25];(${selectors.join('')});out center tags ${Math.max(limit * 2, 50)};`;
}

async function geocode(location) {
  const { value } = await remember(`geo:${location.toLowerCase()}`, 30 * 86400, async () => {
    const url = `${NOMINATIM()}/search?${new URLSearchParams({ q: location, format: 'jsonv2', limit: '1' })}`;
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!res.ok) throw Object.assign(new Error(`Location lookup failed (${res.status})`), { status: 502 });
    const [hit] = await res.json();
    if (!hit) return null;
    const [south, north, west, east] = hit.boundingbox.map(Number);
    return { south, north, west, east, label: hit.display_name };
  });
  return value;
}

const tag = (t, ...keys) => keys.map((k) => t[k]).find(Boolean) || null;

function toLead(el, index, industry) {
  const t = el.tags || {};
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const startYear = (t.start_date || '').match(/^(\d{4})/);
  return makeRawLead(
    {
      sourceId: `${el.type}/${el.id}`,
      companyName: t.name,
      website: tag(t, 'website', 'contact:website', 'url'),
      phone: tag(t, 'phone', 'contact:phone'),
      email: tag(t, 'email', 'contact:email'),
      address: [street, t['addr:city'], t['addr:state'], t['addr:postcode']].filter(Boolean).join(', ') || null,
      city: t['addr:city'],
      state: t['addr:state'],
      industry,
      yearFounded: startYear ? Number(startYear[1]) : null,
    },
    { row: index + 1, source: 'osm' },
  );
}

async function search({ industry, location, limit = 60 }) {
  const bbox = await geocode(location);
  if (!bbox) throw Object.assign(new Error(`Couldn't find the location “${location}”. Try “City, ST”.`), { status: 400 });

  const query = buildOverpassQuery(industry, bbox, limit);
  const res = await fetch(`${OVERPASS()}/api/interpreter`, {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw Object.assign(new Error(`OpenStreetMap search failed (${res.status}). Try again in a minute.`), { status: 502 });
  const body = await res.json();
  const leads = (body.elements || []).map((el, i) => toLead(el, i, industry)).filter(Boolean);
  // Prefer businesses that have a way to contact them, then cap.
  leads.sort((a, b) => Number(!!b.website) + Number(!!b.phone) - (Number(!!a.website) + Number(!!a.phone)));
  return { leads: leads.slice(0, limit), area: bbox.label, requests: 2 };
}

module.exports = { search, tagsFor, buildOverpassQuery, toLead, geocode };
