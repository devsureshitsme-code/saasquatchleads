/**
 * Company Finder, website crawler and Claude integration, each exercised against
 * local mock servers that mimic the real APIs (no keys or internet needed).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

process.env.REDIS_URL = '';
const googlePlaces = require('../src/services/discovery/googlePlaces');
const osm = require('../src/services/discovery/openStreetMap');
const crawler = require('../src/services/crawler');
const { applyEnrichment } = require('../src/services/enrich');
const ai = require('../src/services/ai');
const { scoreLead, resolveCriteria } = require('../src/services/scoring');
const { dedupe } = require('../src/services/dedup');

const listen = (app) =>
  new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });

// ------------------------------------------------------------------ Google Places

test('Google Places: paginates, maps fields, skips permanently closed', async (t) => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.post('/v1/places:searchText', (req, res) => {
    calls.push({ body: req.body, key: req.get('x-goog-api-key'), mask: req.get('x-goog-fieldmask') });
    const page = req.body.pageToken === 'p2' ? 2 : 1;
    const place = (i, extra = {}) => ({
      id: `id${page}-${i}`,
      displayName: { text: `Summit HVAC ${page}-${i}` },
      formattedAddress: '100 Main St, Austin, TX 78701, USA',
      addressComponents: [
        { longText: 'Austin', shortText: 'Austin', types: ['locality', 'political'] },
        { longText: 'Texas', shortText: 'TX', types: ['administrative_area_level_1', 'political'] },
      ],
      internationalPhoneNumber: '+1 512-555-26' + String(10 + i + page * 20),
      websiteUri: `https://summit${page}${i}.com/`,
      rating: 4.7,
      userRatingCount: 120,
      businessStatus: 'OPERATIONAL',
      ...extra,
    });
    res.json(page === 1 ? { places: [place(1), place(2, { businessStatus: 'CLOSED_PERMANENTLY' })], nextPageToken: 'p2' } : { places: [place(1)] });
  });
  const { server, base } = await listen(app);
  t.after(() => server.close());
  process.env.GOOGLE_PLACES_BASE_URL = base;

  const r = await googlePlaces.search({ industry: 'HVAC', location: 'Austin, TX', limit: 60 }, { apiKey: 'k' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.textQuery, 'HVAC in Austin, TX');
  assert.equal(calls[0].key, 'k');
  assert.match(calls[0].mask, /places\.websiteUri/);
  assert.equal(r.skippedClosed, 1);
  assert.equal(r.leads.length, 2);
  const l = r.leads[0];
  assert.equal(l.source, 'google_places');
  assert.equal(l.city, 'Austin');
  assert.equal(l.state, 'TX');
  assert.equal(l.domain, 'summit11.com');
  assert.equal(l.rating, 4.7);
  assert.equal(l.reviewCount, 120);
  assert.match(l.phone, /^\+1512555/);
});

test('Google Places: missing key is a clear 400', async () => {
  await assert.rejects(() => googlePlaces.search({ industry: 'HVAC', location: 'Austin' }, { apiKey: '' }), /not configured/);
});

// ------------------------------------------------------------------ OpenStreetMap

test('OSM: industry maps to tags and the Overpass query is bounded', () => {
  assert.deepEqual(osm.tagsFor('HVAC contractors'), ['craft=hvac']);
  assert.ok(osm.tagsFor('Plumbing').includes('craft=plumber'));
  const q = osm.buildOverpassQuery('Plumbing', { south: 30, west: -98, north: 31, east: -97 }, 40);
  assert.match(q, /nwr\["craft"="plumber"\]\["name"\]\(30,-98,31,-97\)/);
  assert.match(q, /\["name"~"Plumbing",i\]/);
  assert.match(q, /out center tags 80;/);
});

test('OSM: geocode + overpass search maps tags to leads', async (t) => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.get('/search', (req, res) => {
    assert.match(req.get('user-agent'), /SaaSquatchLeads/);
    res.json([{ boundingbox: ['30.1', '30.5', '-97.9', '-97.5'], display_name: 'Austin, Texas, United States' }]);
  });
  app.post('/api/interpreter', (req, res) => {
    assert.match(req.body.data, /craft"="plumber/);
    res.json({
      elements: [
        { type: 'node', id: 1, tags: { name: 'Bluewater Plumbing', craft: 'plumber', website: 'bluewaterplumbing.com', phone: '+1 512 555 0101', 'addr:city': 'Austin', 'addr:state': 'TX', start_date: '1994' } },
        { type: 'node', id: 2, tags: { name: 'No Contact Plumbing', craft: 'plumber' } },
      ],
    });
  });
  const { server, base } = await listen(app);
  t.after(() => server.close());
  process.env.NOMINATIM_BASE_URL = base;
  process.env.OVERPASS_BASE_URL = base;

  const r = await osm.search({ industry: 'Plumbing', location: 'Austin, TX', limit: 10 });
  assert.equal(r.leads.length, 2);
  assert.equal(r.leads[0].companyName, 'Bluewater Plumbing'); // contactable businesses first
  assert.equal(r.leads[0].source, 'osm');
  assert.equal(r.leads[0].yearFounded, 1994);
  assert.equal(r.leads[0].domain, 'bluewaterplumbing.com');
});

test('the same business from Google and OSM merges into one lead with both sources', async () => {
  const g = googlePlaces.toLead({ id: 'g1', displayName: { text: 'Bluewater Plumbing LLC' }, websiteUri: 'https://www.bluewaterplumbing.com', internationalPhoneNumber: '+1 512-555-0101', addressComponents: [] }, 0, 'Plumbing');
  const o = osm.toLead({ type: 'node', id: 9, tags: { name: 'Bluewater Plumbing', website: 'bluewaterplumbing.com', 'addr:city': 'Austin' } }, 1, 'Plumbing');
  const { records } = dedupe([g, o]);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].sources.sort(), ['google_places', 'osm']);
  assert.equal(records[0].city, 'Austin');
});

// ------------------------------------------------------------------ Crawler

const SITE_HOME = `<html><head><title>Summit Heating &amp; Air</title></head><body>
<a href="/about-us">About us</a> <a href="/contact">Contact</a> <a href="/private/team">Team</a> <a href="/services">Services</a>
<p>Family-owned and serving Austin since 1986.</p><a href="mailto:info@summit.test">Email us</a></body></html>`;
const SITE_ABOUT = `<html><body><h1>Our story</h1><p>Founded by Rick Alvarez in 1986, we are now a second-generation business with a team of 28 technicians.</p>
<p>Reach Rick directly: rick@summit.test or (512) 555-0187.</p><a href="https://www.bbb.org/us/tx/austin/profile/hvac/summit">BBB A+</a></body></html>`;

test('crawler: reads homepage + about/contact, honours robots.txt, extracts facts', async (t) => {
  const hits = [];
  const app = express();
  app.use((req, _res, next) => {
    hits.push(req.path);
    next();
  });
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /private\n'));
  app.get('/', (_req, res) => res.type('html').send(SITE_HOME));
  app.get('/about-us', (_req, res) => res.type('html').send(SITE_ABOUT));
  app.get('/contact', (_req, res) => res.type('html').send('<html><body>Call (512) 555-0100</body></html>'));
  app.get('/private/team', (_req, res) => res.type('html').send('<html><body>SECRET</body></html>'));
  const { server, base } = await listen(app);
  t.after(() => server.close());

  const r = await crawler.crawlUncached(base.replace('http://', ''));
  assert.equal(r.ok, true);
  assert.ok(!hits.includes('/private/team'), 'robots.txt Disallow respected');
  assert.ok(hits.includes('/about-us') && hits.includes('/contact'));
  assert.equal(r.yearFounded, 1986);
  assert.equal(r.ownerName, 'Rick Alvarez');
  assert.equal(r.employees, 28);
  assert.equal(r.bestEmail, 'rick@summit.test'); // personal beats info@
  assert.ok(r.signals.includes('Family-owned'));
  assert.ok(r.signals.includes('Multi-generation family business'));
  assert.match(r.socials.bbb, /bbb\.org/);
  assert.ok(r.text.length > 50);
});

test('crawler: unreachable site reports an error instead of throwing', async () => {
  const r = await crawler.crawlUncached('127.0.0.1:1');
  assert.equal(r.ok, false);
});

// ------------------------------------------------------------------ Enrichment merge

test('enrichment fills gaps only, records provenance, estimates revenue from headcount', () => {
  const lead = { companyName: 'Summit', domain: 'summit.test', industry: 'HVAC', email: null, phone: null, ownerName: null, revenue: null, employees: null, yearFounded: 1990, signals: [] };
  const crawlRes = { ok: true, bestEmail: 'rick@summit.test', phones: ['+15125550187'], socials: { bbb: 'x' }, ownerName: 'Rick Alvarez', ownerTitle: 'Owner', yearFounded: 1986, employees: 28, signals: ['Family-owned'], pages: ['/'], emails: ['rick@summit.test'] };
  const aiRes = { owner_name: 'Ricardo Alvarez', owner_title: 'President', year_founded: 1985, employee_estimate: 30, family_owned: true, ownership_signals: ['Second-generation owner'], summary: 'HVAC company.', services: ['AC repair'], industry: 'HVAC', acquisition_notes: 'Stable.' };
  const out = applyEnrichment(lead, crawlRes, aiRes);
  assert.equal(out.yearFounded, 1990, 'existing value kept');
  assert.equal(out.email, 'rick@summit.test');
  assert.equal(out.enrichment.provenance.email, 'website');
  assert.equal(out.ownerName, 'Ricardo Alvarez', 'AI owner preferred over regex');
  assert.equal(out.enrichment.provenance.ownerName, 'ai');
  assert.equal(out.employees, 28, 'stated headcount preferred over AI estimate');
  assert.equal(out.revenue, 28 * 200_000);
  assert.equal(out.revenueEstimated, true);
  assert.equal(out.phone, '+15125550187');
  assert.equal(out.aiSummary, 'HVAC company.');
  assert.deepEqual(out.signals, ['Family-owned', 'Second-generation owner']);
});

test('scoring: estimated revenue is labelled; ownership + reputation bonuses apply (capped at 100)', () => {
  const crit = resolveCriteria({ preset: 'home_services' });
  const lead = { revenue: 3_000_000, revenueEstimated: true, employees: 20, yearFounded: 2000, industry: 'HVAC', ownerName: null, emailStatus: 'invalid', phoneStatus: 'valid', websiteStatus: 'alive', signals: ['Family-owned'], rating: 4.8, reviewCount: 210 };
  const r = scoreLead(lead, crit, new Date('2026-01-01'));
  assert.match(r.reasons.find((x) => x.key === 'revenue').label, /^Est\. revenue/);
  assert.equal(r.reasons.find((x) => x.key === 'signals').points, 5);
  assert.equal(r.reasons.find((x) => x.key === 'reputation').points, 5);
  assert.equal(r.score, 25 + 15 + 15 + 15 + 0 + 0 + 5 + 5 + 5 + 5);
});

// ------------------------------------------------------------------ Claude

test('Claude: requests use structured outputs and parse JSON; missing key is a clear error', async (t) => {
  const seen = [];
  const app = express();
  app.use(express.json());
  app.post('/v1/messages', (req, res) => {
    seen.push({ body: req.body, headers: req.headers });
    const schema = req.body.output_config.format.schema;
    const reply = schema.required.includes('call_opener')
      ? { subject: 'Your HVAC business', email: 'Hi Rick, ...', call_opener: 'Hi Rick...' }
      : { industry: 'HVAC contractor', product: null, location: 'Austin, TX', preset: 'home_services', revenue_min_millions: 2, revenue_max_millions: 8, employees_min: null, employees_max: null, min_years: 15, exclude: [], explanation: 'HVAC in Austin, $2-8M, 15+ years.' };
    res.json({ content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 10, output_tokens: 20 } });
  });
  const { server, base } = await listen(app);
  t.after(() => server.close());
  process.env.ANTHROPIC_BASE_URL = base;

  // a developer's own server/.env must not leak into this test
  for (const k of ['AI_PROVIDER', 'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL']) delete process.env[k];
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(ai.available(), false);
  await assert.rejects(() => ai.parseSearch('hvac in austin'), /AI is not configured/);

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const parsed = await ai.parseSearch('established HVAC companies in Austin doing 2-8M, 15+ years old');
  assert.equal(parsed.location, 'Austin, TX');
  assert.equal(parsed.min_years, 15);
  const req = seen[0];
  assert.equal(req.headers['x-api-key'], 'test-key');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.output_config.format.schema.additionalProperties, false);

  const draft = await ai.writeOutreach({ companyName: 'Summit', ownerName: 'Rick Alvarez', scoreReasons: [] }, { senderName: 'Vishal' });
  assert.equal(draft.subject, 'Your HVAC business');
  delete process.env.ANTHROPIC_API_KEY;
});

test('every AI schema object disallows extra properties (structured-outputs requirement)', () => {
  const check = (s) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(check);
    }
  };
  check(ai.ENRICH_SCHEMA);
});

// ------------------------------------------------------------------ OpenAI-compatible providers (Groq, Gemini, OpenRouter...)

test('OpenAI-compatible: json_schema rejected -> falls back to json_object, parses fenced JSON, normalizes to schema', async (t) => {
  const client = require('../src/services/aiClient');
  const seen = [];
  const app = express();
  app.use(express.json());
  app.post('/v1/chat/completions', (req, res) => {
    seen.push({ auth: req.get('authorization'), body: req.body });
    if (req.body.response_format?.type === 'json_schema') {
      return res.status(400).json({ error: { message: 'response_format json_schema is not supported for this model' } });
    }
    // model wraps JSON in a fence and omits some keys / uses strings for numbers
    const content = '```json\n{"owner_name":"Rick Alvarez","year_founded":"1986","services":"AC repair","family_owned":"yes","summary":"HVAC in Austin."}\n```';
    res.json({ choices: [{ message: { content } }], usage: { total_tokens: 42 } });
  });
  app.post('/v2/chat/completions', (_req, res) => res.status(404).json({ error: { message: 'model not found' } }));
  const { server, base } = await listen(app);
  t.after(() => {
    server.close();
    for (const k of ['AI_PROVIDER', 'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_RPM']) delete process.env[k];
  });
  delete process.env.ANTHROPIC_API_KEY;
  Object.assign(process.env, { AI_PROVIDER: 'groq', AI_API_KEY: 'gsk_test', AI_BASE_URL: `${base}/v1`, AI_RPM: '6000' });
  client._resetModes();

  assert.deepEqual(
    { available: client.info().available, provider: client.info().provider, model: client.info().model },
    { available: true, provider: 'groq', model: 'openai/gpt-oss-20b' },
  );
  const out = await ai.enrichCompany({ companyName: 'Summit', domain: 'summit-oai.test' }, { text: 'Founded 1986 by Rick Alvarez' });
  assert.equal(seen[0].auth, 'Bearer gsk_test');
  assert.equal(seen[0].body.response_format.type, 'json_schema');
  assert.equal(seen[1].body.response_format.type, 'json_object');
  assert.match(seen[1].body.messages[0].content, /JSON Schema/);
  assert.equal(out.owner_name, 'Rick Alvarez');
  assert.equal(out.year_founded, 1986);
  assert.deepEqual(out.services, ['AC repair']);
  assert.equal(out.family_owned, true);
  assert.equal(out.employee_estimate, null);
  assert.deepEqual(out.ownership_signals, []);

  // the working mode is remembered: next call goes straight to json_object
  seen.length = 0;
  await ai.parseSearch('hvac companies in austin');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].body.response_format.type, 'json_object');

  // unknown model -> clear message
  process.env.AI_BASE_URL = `${base}/v2`;
  await assert.rejects(() => ai.parseSearch('hvac in austin'), /know the model/);
});

test('OpenAI-compatible: json_validate_failed (Groq) -> retries in a looser mode with token headroom', async (t) => {
  const client = require('../src/services/aiClient');
  const seen = [];
  const app = express();
  app.use(express.json());
  app.post('/v1/chat/completions', (req, res) => {
    seen.push(req.body);
    if (req.body.response_format?.type === 'json_schema') {
      return res.status(400).json({
        error: { message: "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.", type: 'invalid_request_error', code: 'json_validate_failed', failed_generation: '{"subject":"Your HVAC bus' },
      });
    }
    res.json({ choices: [{ message: { content: JSON.stringify({ subject: 'Your HVAC business', email: 'Hi Rick, ...', call_opener: 'Hi Rick...' }) } }] });
  });
  const { server, base } = await listen(app);
  t.after(() => {
    server.close();
    for (const k of ['AI_PROVIDER', 'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_RPM']) delete process.env[k];
  });
  delete process.env.ANTHROPIC_API_KEY;
  Object.assign(process.env, { AI_PROVIDER: 'groq', AI_API_KEY: 'gsk_test', AI_BASE_URL: `${base}/v1`, AI_RPM: '6000' });
  client._resetModes();

  const draft = await ai.writeOutreach({ companyName: 'Summit', ownerName: 'Rick Alvarez', scoreReasons: [] }, { senderName: 'Vishal' });
  assert.equal(draft.call_opener, 'Hi Rick...');
  assert.equal(seen[0].response_format.type, 'json_schema');
  assert.equal(seen[1].response_format.type, 'json_object');
  assert.ok(seen[0].max_tokens >= 2000);

  // a one-off validation failure must not downgrade the mode for later calls
  seen.length = 0;
  client._resetModes();
  await ai.writeOutreach({ companyName: 'Summit', ownerName: 'Rick Alvarez', scoreReasons: [] }, { senderName: 'Vishal' });
  assert.equal(seen[0].response_format.type, 'json_schema');
});

test('extractJson / normalizeToSchema handle messy model output', () => {
  const { extractJson, normalizeToSchema } = require('../src/services/aiClient');
  assert.deepEqual(extractJson('Sure! Here you go: {"a":1} hope that helps'), { a: 1 });
  const schema = { type: 'object', properties: { n: { type: ['integer', 'null'] }, p: { type: 'string', enum: ['x', 'y'] }, l: { type: 'array', items: { type: 'string' } } } };
  assert.deepEqual(normalizeToSchema({ n: '12 people', p: 'z', extra: 1 }, schema), { n: 12, p: 'x', l: [] });
});
