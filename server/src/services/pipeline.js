/**
 * Background jobs. Two ways in, one pipeline:
 *
 *   CSV upload:      parse ─┐
 *   Company search:  discover (Google Places / OpenStreetMap) ─┤
 *                                                             ├─> dedupe → crawl websites → AI read → validate → score → save
 *
 * Each stage writes its name and progress to the uploads row so the UI can show a live
 * progress bar. (For very large jobs this is where a BullMQ worker would slot in; see README.)
 */
const repo = require('../db/repo');
const config = require('../config');
const { parseLeadsCsv } = require('./csv');
const { dedupe } = require('./dedup');
const { validateAll } = require('./validation');
const { scoreAll } = require('./scoring');
const { enrichAll } = require('./enrich');
const { discover } = require('./discovery');
const ai = require('./ai');

function progressWriter(uploadId) {
  let lastWrite = 0;
  return (stage, done, total) => {
    if (Date.now() - lastWrite > 250 || done === 0 || done === total) {
      lastWrite = Date.now();
      repo.updateUpload(uploadId, { stage, progressDone: done, progressTotal: total }).catch(() => {});
    }
  };
}

async function runPipeline(uploadId, rawLeads, { criteriaInput, crawl, useAi, extraStats = {}, started }) {
  const progress = progressWriter(uploadId);

  await repo.updateUpload(uploadId, { stage: 'deduping', rowCount: rawLeads.length });
  const deduped = dedupe(rawLeads);
  await repo.updateUpload(uploadId, { uniqueCount: deduped.stats.uniqueLeads, duplicateCount: deduped.stats.duplicatesMerged });

  let leads = deduped.records;
  let enrichStats = null;
  if (crawl || useAi) {
    const r = await enrichAll(leads, { crawl, useAi, onStage: progress });
    leads = r.leads;
    enrichStats = r.stats;
  }

  progress('validating', 0, leads.length);
  const validated = await validateAll(leads, { onProgress: (d, t) => progress('validating', d, t) });

  await repo.updateUpload(uploadId, { stage: 'scoring' });
  const { criteria, leads: scored } = scoreAll(validated.leads, criteriaInput);

  await repo.updateUpload(uploadId, { stage: 'saving' });
  await repo.insertLeads(uploadId, scored);

  await repo.updateUpload(uploadId, {
    status: 'ready',
    stage: 'done',
    criteria,
    processingMs: Date.now() - started,
    stats: { ...extraStats, dedup: deduped.stats, enrichment: enrichStats, validation: validated.stats },
  });
}

async function fail(uploadId, err, started) {
  console.error(`[pipeline] ${uploadId} failed:`, err.message);
  await repo.updateUpload(uploadId, { status: 'failed', error: err.message, processingMs: Date.now() - started }).catch(() => {});
}

async function processUpload(uploadId, csvText, criteriaInput, { crawl = false, useAi = false } = {}) {
  const started = Date.now();
  try {
    await repo.updateUpload(uploadId, { stage: 'parsing' });
    const parsed = parseLeadsCsv(csvText);
    if (parsed.leads.length === 0) throw Object.assign(new Error('No rows with a company name were found in the file.'), { status: 400 });
    if (parsed.leads.length > config.maxUploadRows) {
      throw Object.assign(new Error(`File has ${parsed.leads.length} rows; the limit is ${config.maxUploadRows}.`), { status: 400 });
    }
    await repo.updateUpload(uploadId, { columnMapping: { mapping: parsed.mapping, unmapped: parsed.unmapped } });
    await runPipeline(uploadId, parsed.leads, {
      criteriaInput,
      crawl,
      useAi,
      started,
      extraStats: { skippedRows: parsed.skipped, parseErrors: parsed.parseErrors },
    });
  } catch (err) {
    await fail(uploadId, err, started);
  }
}

/** q: { industry, product, location, limit, sources, crawl, ai } */
async function processSearch(uploadId, q, criteriaInput) {
  const started = Date.now();
  try {
    await repo.updateUpload(uploadId, { stage: 'discovering' });
    const { leads, bySource } = await discover(q);
    await runPipeline(uploadId, leads, {
      criteriaInput,
      crawl: q.crawl !== false,
      useAi: q.ai !== false && ai.available(),
      started,
      extraStats: { discovery: bySource },
    });
  } catch (err) {
    await fail(uploadId, err, started);
  }
}

/** Re-score an existing upload with new criteria (no network calls; instant). */
async function rescoreUpload(uploadId, criteriaInput) {
  const leads = await repo.allLeads(uploadId);
  const { criteria, leads: scored } = scoreAll(leads, criteriaInput);
  await repo.updateScores(scored);
  await repo.updateUpload(uploadId, { criteria });
  return { criteria, count: scored.length };
}

module.exports = { processUpload, processSearch, rescoreUpload };
