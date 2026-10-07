const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const repo = require('../db/repo');
const { processUpload, processSearch, rescoreUpload } = require('../services/pipeline');
const { leadsToCsv } = require('../services/csv');
const { PRESETS, resolveCriteria } = require('../services/scoring');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(csv|txt)$/i.test(file.originalname) || /csv|text\/plain|excel/.test(file.mimetype);
    cb(ok ? null : Object.assign(new Error('Please upload a .csv file'), { status: 400 }), ok);
  },
});

const SAMPLE_PATH = path.resolve(__dirname, '../../../sample-data/leads_sample.csv');

const criteriaSchema = z
  .object({
    preset: z.enum(Object.keys(PRESETS)).optional(),
    revenueMin: z.coerce.number().nonnegative().optional(),
    revenueMax: z.coerce.number().positive().optional(),
    employeesMin: z.coerce.number().int().nonnegative().optional(),
    employeesMax: z.coerce.number().int().positive().optional(),
    minYears: z.coerce.number().int().nonnegative().optional(),
    targetIndustries: z.array(z.string()).optional(),
    excludedIndustries: z.array(z.string()).optional(),
  })
  .strip();

const list = (v) => (v === undefined || v === '' ? undefined : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const flag = (v) => v === 'true' || v === '1';

function filtersFromQuery(q) {
  return {
    tiers: list(q.tiers),
    minScore: q.minScore,
    emailStatuses: list(q.emailStatuses),
    phoneStatuses: list(q.phoneStatuses),
    industries: list(q.industries),
    ids: list(q.ids),
    reachableOnly: flag(q.reachableOnly),
    mergedOnly: flag(q.mergedOnly),
    sources: list(q.sources),
    hasSignals: flag(q.hasSignals),
    ownerKnown: flag(q.ownerKnown),
    q: q.q,
    sort: q.sort,
    order: q.order,
    page: q.page,
    pageSize: q.pageSize,
  };
}

async function startJob(res, fileName, csvText, criteriaInput, enrich = {}) {
  const criteria = resolveCriteria(criteriaInput);
  const created = await repo.createUpload({ fileName, criteria, searchQuery: enrich });
  // Fire-and-forget: the client polls GET /uploads/:id for progress.
  setImmediate(() => processUpload(created.id, csvText, criteriaInput, enrich));
  res.status(202).json({ upload: created });
}

const enrichFromBody = (b) => ({ crawl: flag(String(b.crawl ?? '')), useAi: flag(String(b.ai ?? '')) });

router.get('/presets', (_req, res) => {
  res.json({ presets: Object.entries(PRESETS).map(([id, p]) => ({ id, ...p })) });
});

router.get('/sample.csv', (_req, res) => {
  if (!fs.existsSync(SAMPLE_PATH)) return res.status(404).json({ error: 'Sample file not found. Run `npm run sample`.' });
  res.download(SAMPLE_PATH, 'saasquatchleads_sample_leads.csv');
});

router.post('/uploads', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a CSV file in the "file" field.' });
  const criteria = criteriaSchema.parse(req.body.criteria ? JSON.parse(req.body.criteria) : { preset: req.body.preset });
  await startJob(res, req.file.originalname, req.file.buffer.toString('utf8'), criteria, enrichFromBody(req.body));
});

router.post('/uploads/sample', express.json(), async (req, res) => {
  if (!fs.existsSync(SAMPLE_PATH)) return res.status(404).json({ error: 'Sample file not found. Run `npm run sample`.' });
  const criteria = criteriaSchema.parse(req.body || {});
  await startJob(res, 'saasquatchleads_sample_leads.csv', fs.readFileSync(SAMPLE_PATH, 'utf8'), criteria, enrichFromBody(req.body || {}));
});

const searchSchema = z.object({
  industry: z.string().trim().min(2, 'Enter an industry'),
  product: z.string().trim().optional().default(''),
  location: z.string().trim().min(2, 'Enter a location'),
  limit: z.coerce.number().int().min(5).max(120).default(60),
  sources: z.array(z.enum(['google_places', 'osm'])).optional(),
  crawl: z.boolean().default(true),
  ai: z.boolean().default(true),
  criteria: criteriaSchema.optional(),
});

/** Company Finder: industry + location -> businesses from Google Places / OpenStreetMap. */
router.post('/search', express.json(), async (req, res) => {
  const q = searchSchema.parse(req.body || {});
  const criteriaInput = q.criteria || {};
  const criteria = resolveCriteria(criteriaInput);
  const label = [q.product, q.industry].filter(Boolean).join(' ') + ` in ${q.location}`;
  const { criteria: _omit, ...query } = q;
  const created = await repo.createUpload({ fileName: label, criteria, source: 'search', searchQuery: query });
  setImmediate(() => processSearch(created.id, query, criteriaInput));
  res.status(202).json({ upload: created });
});

router.get('/uploads', async (_req, res) => {
  res.json({ uploads: await repo.listUploads() });
});

router.get('/uploads/:id', async (req, res) => {
  const up = await repo.getUpload(req.params.id);
  if (!up) return res.status(404).json({ error: 'Upload not found' });
  const summary = up.status === 'ready' ? await repo.getUploadSummary(up.id) : null;
  res.json({ upload: up, summary });
});

router.delete('/uploads/:id', async (req, res) => {
  const ok = await repo.deleteUpload(req.params.id);
  res.status(ok ? 204 : 404).end();
});

router.get('/uploads/:id/leads', async (req, res) => {
  res.json(await repo.listLeads(req.params.id, filtersFromQuery(req.query)));
});

router.post('/uploads/:id/rescore', express.json(), async (req, res) => {
  const up = await repo.getUpload(req.params.id);
  if (!up) return res.status(404).json({ error: 'Upload not found' });
  if (up.status !== 'ready') return res.status(409).json({ error: 'Upload is still processing' });
  const result = await rescoreUpload(up.id, criteriaSchema.parse(req.body || {}));
  res.json(result);
});

router.get('/uploads/:id/export.csv', async (req, res) => {
  const up = await repo.getUpload(req.params.id);
  if (!up) return res.status(404).json({ error: 'Upload not found' });
  const leads = await repo.allLeads(up.id, filtersFromQuery(req.query));
  const base = up.fileName.replace(/\.[^.]+$/, '');
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${base}_saasquatchleads.csv"`);
  res.send(leadsToCsv(leads));
});

module.exports = router;
