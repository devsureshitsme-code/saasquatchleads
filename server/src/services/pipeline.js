/**
 * Background jobs. Two ways in, one pipeline:
 *
 *   CSV upload:      parse ─┐
 *   Company search:  discover (Google Places / OpenStreetMap) ─┤
 *                                                             ├─> dedupe → crawl websites → validate → score → save
 *                                                             └─> then, in the background: AI reads each site → re-score
 *
 * The list is marked ready as soon as it is saved. The AI calls are rate limited (free
 * tiers allow ~25 a minute), so they run afterwards and update each lead as they finish.
 * Each stage writes its name and progress to the uploads row so the UI can show a live
 * progress bar. (For very large jobs this is where a BullMQ worker would slot in; see README.)
 */
const repo = require('../db/repo');
const config = require('../config');
const { parseLeadsCsv } = require('./csv');
const { dedupe } = require('./dedup');
const { validateAll } = require('./validation');
const pLimit = require('p-limit');
const { scoreAll } = require('./scoring');
const { enrichAll, applyEnrichment, aiCandidates, AI_CONCURRENCY } = require('./enrich');
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
  let crawlResults = new Map();
  if (crawl) {
    const r = await enrichAll(leads, { crawl, onStage: progress });
    leads = r.leads;
    enrichStats = r.stats;
    crawlResults = r.crawlResults;
  }

  progress('validating', 0, leads.length);
  const validated = await validateAll(leads, { onProgress: (d, t) => progress('validating', d, t) });

  await repo.updateUpload(uploadId, { stage: 'scoring' });
  const { criteria, leads: scored } = scoreAll(validated.leads, criteriaInput);

  await repo.updateUpload(uploadId, { stage: 'saving' });
  await repo.insertLeads(uploadId, scored);

  const stats = { ...extraStats, dedup: deduped.stats, enrichment: enrichStats, validation: validated.stats };
  await repo.updateUpload(uploadId, { status: 'ready', stage: 'done', criteria, processingMs: Date.now() - started, stats });

  if (useAi && crawl && ai.available()) {
    runAiPass(uploadId, crawlResults, stats).catch((err) => console.error(`[pipeline] ${uploadId} AI pass failed:`, err.message));
  }
}

/**
 * Background AI pass over an upload that is already ready. Each lead is updated and
 * re-scored as soon as its site has been read; the UI polls while stage is 'analyzing'.
 */
async function runAiPass(uploadId, crawlResults, stats) {
  const { picked, skippedByCap } = aiCandidates(await repo.allLeads(uploadId), crawlResults);
  if (!picked.length) return;
  const limit = pLimit(AI_CONCURRENCY());
  let done = 0;
  let enriched = 0;
  let failed = 0;
  await repo.updateUpload(uploadId, { stage: 'analyzing', progressDone: 0, progressTotal: picked.length });
  try {
    await Promise.all(
      picked.map((lead) =>
        limit(async () => {
          const crawlRes = crawlResults.get(lead.domain);
          try {
            const aiRes = await ai.enrichCompany(lead, crawlRes);
            // The AI reads context better than the owner regex, so its name wins over a website guess.
            const guessed = lead.enrichment?.provenance?.ownerName === 'website' && aiRes.owner_name;
            const base = guessed ? { ...lead, ownerName: null, ownerTitle: null } : lead;
            // Read the thesis fresh: the user may have edited it while this pass was running.
            const { criteria } = await repo.getUpload(uploadId);
            const [scored] = scoreAll([applyEnrichment(base, crawlRes, aiRes)], criteria).leads;
            await repo.updateLeadEnrichment(scored);
            enriched++;
          } catch (err) {
            failed++;
            await repo.updateLeadEnrichment({ ...lead, enrichment: { ...lead.enrichment, aiError: err.message } }).catch(() => {});
          }
          // Awaited (unlike stage progress) so a late write can never land after stage is set to 'done'.
          await repo.updateUpload(uploadId, { progressDone: ++done }).catch(() => {});
        }),
      ),
    );
  } finally {
    await repo.updateUpload(uploadId, {
      stage: 'done',
      stats: { ...stats, enrichment: { ...stats.enrichment, aiEnriched: enriched, aiFailed: failed, aiSkippedByCap: skippedByCap } },
    });
  }
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
