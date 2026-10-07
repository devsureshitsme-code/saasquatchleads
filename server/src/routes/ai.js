const express = require('express');
const { z } = require('zod');
const repo = require('../db/repo');
const ai = require('../services/ai');
const { availableProviders } = require('../services/discovery');

const router = express.Router();

/** What this server can do, so the UI can enable/disable features honestly. */
router.get('/capabilities', (_req, res) => {
  res.json({
    ai: ai.info(),
    sources: availableProviders(),
  });
});

router.post('/ai/parse-search', express.json(), async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(5).max(600) }).parse(req.body || {});
  res.json(await ai.parseSearch(text));
});

router.get('/leads/:id', async (req, res) => {
  const lead = await repo.getLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json({ lead });
});

const outreachSchema = z.object({
  senderName: z.string().trim().max(80).optional(),
  senderCompany: z.string().trim().max(120).optional(),
  goal: z.string().trim().max(300).optional(),
  tone: z.enum(['warm and direct', 'formal', 'brief and casual']).optional(),
});

router.post('/leads/:id/outreach', express.json(), async (req, res) => {
  const opts = outreachSchema.parse(req.body || {});
  const lead = await repo.getLead(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const draft = await ai.writeOutreach(lead, opts);
  const outreach = { ...draft, createdAt: new Date().toISOString(), model: ai.model() };
  await repo.saveOutreach(lead.id, outreach);
  res.json({ outreach });
});

module.exports = router;
