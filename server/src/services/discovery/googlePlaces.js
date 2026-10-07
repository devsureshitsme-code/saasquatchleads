/**
 * Google Places API (New) — Text Search.
 * Official, licensed business data: name, address, phone, website, rating, review count.
 * Up to 20 results per page and 60 per query (3 pages via nextPageToken).
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */
const { makeRawLead } = require('../leadShape');

const BASE = () => process.env.GOOGLE_PLACES_BASE_URL || 'https://places.googleapis.com';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.primaryTypeDisplayName',
  'places.businessStatus',
  'nextPageToken',
].join(',');

const component = (place, type, key = 'longText') => {
  const c = (place.addressComponents || []).find((x) => (x.types || []).includes(type));
  return c ? c[key] : null;
};

function toLead(place, index, industry) {
  return makeRawLead(
    {
      sourceId: place.id,
      companyName: place.displayName?.text,
      website: place.websiteUri,
      phone: place.internationalPhoneNumber || place.nationalPhoneNumber,
      address: place.formattedAddress,
      city: component(place, 'locality') || component(place, 'postal_town') || component(place, 'sublocality'),
      state: component(place, 'administrative_area_level_1', 'shortText'),
      industry: industry || place.primaryTypeDisplayName?.text,
      rating: place.rating,
      reviewCount: place.userRatingCount,
    },
    { row: index + 1, source: 'google_places' },
  );
}

/**
 * @returns {Promise<{ leads: Array, skippedClosed: number, requests: number }>}
 */
async function search({ industry, product, location, limit = 60 }, { apiKey = process.env.GOOGLE_PLACES_API_KEY } = {}) {
  if (!apiKey) throw Object.assign(new Error('Google Places is not configured (GOOGLE_PLACES_API_KEY).'), { status: 400 });
  const textQuery = [product, industry].filter(Boolean).join(' ') + (location ? ` in ${location}` : '');
  const places = [];
  let pageToken;
  let requests = 0;

  do {
    const res = await fetch(`${BASE()}/v1/places:searchText`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey, 'x-goog-fieldmask': FIELD_MASK },
      body: JSON.stringify({ textQuery, pageSize: Math.min(20, limit - places.length), ...(pageToken ? { pageToken } : {}) }),
    });
    requests++;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.error?.message || `Google Places request failed (${res.status})`;
      throw Object.assign(new Error(`Google Places: ${msg}`), { status: res.status === 403 || res.status === 400 ? 400 : 502 });
    }
    places.push(...(body.places || []));
    pageToken = body.nextPageToken;
  } while (pageToken && places.length < limit && requests < 3);

  const open = places.filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY');
  return {
    leads: open.map((p, i) => toLead(p, i, industry)).filter(Boolean),
    skippedClosed: places.length - open.length,
    requests,
  };
}

module.exports = { search, toLead, FIELD_MASK };
