/**
 * Company discovery: run one or more providers for an industry + location and
 * return raw leads. Results are cached for 24h per provider+query (saves API cost
 * and makes demos repeatable). Cross-source duplicates are merged later by dedup.
 */
const { remember } = require('../../lib/cache');
const googlePlaces = require('./googlePlaces');
const openStreetMap = require('./openStreetMap');
const { normalizePhone } = require('../normalize');

const PROVIDERS = {
  google_places: {
    label: 'Google Places',
    available: () => !!process.env.GOOGLE_PLACES_API_KEY,
    run: googlePlaces.search,
  },
  osm: {
    label: 'OpenStreetMap',
    available: () => process.env.DISABLE_OSM !== 'true',
    run: openStreetMap.search,
  },
};

function availableProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, available: p.available() }));
}

/**
 * @param {{industry:string, product?:string, location:string, limit?:number, sources?:string[]}} q
 * @returns {Promise<{ leads: Array, bySource: Record<string,{count:number,error?:string,cached?:boolean}> }>}
 */
async function discover(q) {
  const wanted = (q.sources && q.sources.length ? q.sources : Object.keys(PROVIDERS)).filter((s) => PROVIDERS[s] && PROVIDERS[s].available());
  if (!wanted.length) throw Object.assign(new Error('No search source is available. Add GOOGLE_PLACES_API_KEY or enable OpenStreetMap.'), { status: 400 });

  const bySource = {};
  const results = await Promise.all(
    wanted.map(async (id) => {
      const key = `discover:${id}:${[q.industry, q.product, q.location, q.limit].map((s) => String(s || '').toLowerCase().trim()).join('|')}`;
      try {
        const { value, cached } = await remember(key, 86400, () => PROVIDERS[id].run(q));
        bySource[id] = { count: value.leads.length, cached };
        // cache stores plain JSON; re-hydrate parsed phone objects
        return value.leads.map((l) => ({ ...l, phoneParsed: l.phoneRaw ? normalizePhone(l.phoneRaw) : null }));
      } catch (err) {
        bySource[id] = { count: 0, error: err.message };
        return [];
      }
    }),
  );

  const leads = results.flat().map((l, i) => ({ ...l, row: i + 1 }));
  if (!leads.length) {
    const errors = Object.values(bySource).map((s) => s.error).filter(Boolean);
    throw Object.assign(new Error(errors[0] || `No ${q.industry} businesses found in ${q.location}. Try a broader industry or a nearby city.`), { status: 400 });
  }
  return { leads, bySource };
}

module.exports = { discover, availableProviders, PROVIDERS };
