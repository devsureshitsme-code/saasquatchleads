/**
 * Data access for uploads and leads. Plain parameterized SQL over node-postgres;
 * rows are mapped to camelCase objects for the API.
 */
const { query, withTransaction } = require('./index');
const { newId } = require('../lib/id');

const LEAD_COLUMNS = {
  id: 'id',
  uploadId: 'upload_id',
  companyName: 'company_name',
  normName: 'norm_name',
  domain: 'domain',
  website: 'website',
  phone: 'phone',
  email: 'email',
  city: 'city',
  state: 'state',
  industry: 'industry',
  revenue: 'revenue',
  employees: 'employees',
  yearFounded: 'year_founded',
  ownerName: 'owner_name',
  ownerTitle: 'owner_title',
  linkedin: 'linkedin',
  source: 'source',
  sources: 'sources',
  sourceIds: 'source_ids',
  address: 'address',
  rating: 'rating',
  reviewCount: 'review_count',
  revenueEstimated: 'revenue_estimated',
  socials: 'socials',
  signals: 'signals',
  aiSummary: 'ai_summary',
  enrichment: 'enrichment',
  outreach: 'outreach',
  mergedCount: 'merged_count',
  mergedFrom: 'merged_from',
  emailStatus: 'email_status',
  emailReason: 'email_reason',
  emailSuggestion: 'email_suggestion',
  phoneStatus: 'phone_status',
  phoneReason: 'phone_reason',
  phoneType: 'phone_type',
  websiteStatus: 'website_status',
  websiteDetail: 'website_detail',
  score: 'score',
  tier: 'tier',
  scoreReasons: 'score_reasons',
  createdAt: 'created_at',
};
const JSON_FIELDS = new Set(['mergedFrom', 'scoreReasons', 'sources', 'sourceIds', 'socials', 'signals', 'enrichment', 'outreach']);
const JSON_DEFAULTS = { socials: {}, enrichment: {}, outreach: null };
const INSERT_FIELDS = Object.keys(LEAD_COLUMNS).filter(
  (k) => !['createdAt', 'outreach'].includes(k),
);

const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const mapRow = (row) => {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
};

// ---------------------------------------------------------------- uploads

async function createUpload({ fileName, criteria, source = 'csv', searchQuery = {} }) {
  const id = newId();
  const { rows } = await query(
    `INSERT INTO uploads (id, file_name, criteria, source, query) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, fileName, JSON.stringify(criteria || {}), source, JSON.stringify(searchQuery)],
  );
  return mapRow(rows[0]);
}

const UPLOAD_UPDATABLE = {
  rowCount: 'row_count',
  uniqueCount: 'unique_count',
  duplicateCount: 'duplicate_count',
  status: 'status',
  stage: 'stage',
  progressDone: 'progress_done',
  progressTotal: 'progress_total',
  error: 'error',
  criteria: 'criteria',
  columnMapping: 'column_mapping',
  stats: 'stats',
  processingMs: 'processing_ms',
};
const UPLOAD_JSON = new Set(['criteria', 'columnMapping', 'stats']);

async function updateUpload(id, patch, client = { query }) {
  const sets = [];
  const values = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!UPLOAD_UPDATABLE[k]) continue;
    values.push(UPLOAD_JSON.has(k) ? JSON.stringify(v) : v);
    sets.push(`${UPLOAD_UPDATABLE[k]} = $${values.length}`);
  }
  if (!sets.length) return;
  values.push(id);
  await client.query(`UPDATE uploads SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
}

async function getUpload(id) {
  const { rows } = await query(`SELECT * FROM uploads WHERE id = $1`, [id]);
  return mapRow(rows[0]);
}

async function listUploads(limit = 20) {
  const { rows } = await query(
    `SELECT id, file_name, row_count, unique_count, duplicate_count, status, stage, source, query, created_at
       FROM uploads ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(mapRow);
}

async function deleteUpload(id) {
  const { rowCount } = await query(`DELETE FROM uploads WHERE id = $1`, [id]);
  return rowCount > 0;
}

/** Aggregates for dashboard cards and filter dropdowns. */
async function getUploadSummary(uploadId) {
  const { rows } = await query(
    `SELECT
        count(*)::int                                              AS total,
        coalesce(round(avg(score))::int, 0)                        AS avg_score,
        count(*) FILTER (WHERE tier = 'A')::int                    AS tier_a,
        count(*) FILTER (WHERE tier = 'B')::int                    AS tier_b,
        count(*) FILTER (WHERE tier = 'C')::int                    AS tier_c,
        count(*) FILTER (WHERE email_status = 'valid')::int        AS email_valid,
        count(*) FILTER (WHERE email_status = 'risky')::int        AS email_risky,
        count(*) FILTER (WHERE email_status = 'invalid')::int      AS email_invalid,
        count(*) FILTER (WHERE email_status = 'missing')::int      AS email_missing,
        count(*) FILTER (WHERE phone_status = 'valid')::int        AS phone_valid,
        count(*) FILTER (WHERE phone_status = 'risky')::int        AS phone_risky,
        count(*) FILTER (WHERE phone_status = 'invalid')::int      AS phone_invalid,
        count(*) FILTER (WHERE phone_status = 'missing')::int      AS phone_missing,
        count(*) FILTER (WHERE website_status = 'alive')::int      AS website_alive,
        count(*) FILTER (WHERE website_status = 'dead')::int       AS website_dead,
        count(*) FILTER (WHERE email_status = 'valid' OR phone_status = 'valid')::int AS reachable,
        count(*) FILTER (WHERE merged_count > 1)::int              AS merged_records,
        count(*) FILTER (WHERE ai_summary IS NOT NULL)::int        AS ai_enriched,
        count(*) FILTER (WHERE owner_name IS NOT NULL)::int        AS owner_known,
        count(*) FILTER (WHERE sources ? 'google_places')::int     AS src_google,
        count(*) FILTER (WHERE sources ? 'osm')::int               AS src_osm,
        count(*) FILTER (WHERE sources ? 'csv')::int               AS src_csv,
        count(*) FILTER (WHERE jsonb_array_length(coalesce(enrichment->'pagesCrawled','[]'::jsonb)) > 0)::int AS websites_crawled,
        count(*) FILTER (WHERE enrichment->'provenance' ? 'ownerName')::int AS owners_found,
        count(*) FILTER (WHERE enrichment->'provenance' ? 'email')::int     AS emails_found,
        count(*) FILTER (WHERE jsonb_array_length(signals) > 0)::int AS with_signals
       FROM leads WHERE upload_id = $1`,
    [uploadId],
  );
  const { rows: industries } = await query(
    `SELECT industry, count(*)::int AS count FROM leads
      WHERE upload_id = $1 AND industry IS NOT NULL GROUP BY industry ORDER BY count DESC`,
    [uploadId],
  );
  const { rows: histogram } = await query(
    `SELECT least(width_bucket(score, 0, 100, 10), 10) AS bucket, count(*)::int AS count
       FROM leads WHERE upload_id = $1 GROUP BY bucket ORDER BY bucket`,
    [uploadId],
  );
  const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 9 + (i === 9 ? 1 : 0), count: 0 }));
  for (const h of histogram) buckets[Math.max(0, h.bucket - 1)].count = h.count;
  return { ...mapRow(rows[0]), industries, scoreHistogram: buckets };
}

// ---------------------------------------------------------------- leads

/** Bulk insert in chunks (multi-row VALUES) inside one transaction. */
async function insertLeads(uploadId, leads) {
  const CHUNK = 200;
  const cols = INSERT_FIELDS.map((f) => LEAD_COLUMNS[f]);
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM leads WHERE upload_id = $1`, [uploadId]);
    for (let i = 0; i < leads.length; i += CHUNK) {
      const chunk = leads.slice(i, i + CHUNK);
      const values = [];
      const tuples = chunk.map((lead) => {
        const row = { ...lead, id: newId(), uploadId };
        const placeholders = INSERT_FIELDS.map((f) => {
          const v = row[f];
          values.push(JSON_FIELDS.has(f) ? JSON.stringify(v ?? (f in JSON_DEFAULTS ? JSON_DEFAULTS[f] : [])) : v ?? null);
          return `$${values.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      await client.query(`INSERT INTO leads (${cols.join(', ')}) VALUES ${tuples.join(', ')}`, values);
    }
  });
}

const SORTABLE = {
  score: 'score',
  companyName: 'lower(company_name)',
  revenue: 'revenue',
  employees: 'employees',
  yearFounded: 'year_founded',
  city: 'lower(city)',
  industry: 'lower(industry)',
  mergedCount: 'merged_count',
};

/** Builds a WHERE clause from UI filters. Shared by list and export. */
function buildFilter(uploadId, f = {}) {
  const where = ['upload_id = $1'];
  const values = [uploadId];
  const add = (sql, v) => {
    values.push(v);
    where.push(sql.replace('?', `$${values.length}`));
  };
  if (f.tiers && f.tiers.length) add('tier = ANY(?)', f.tiers);
  if (f.minScore !== undefined && f.minScore !== null && f.minScore !== '') add('score >= ?', Number(f.minScore));
  if (f.emailStatuses && f.emailStatuses.length) add('email_status = ANY(?)', f.emailStatuses);
  if (f.phoneStatuses && f.phoneStatuses.length) add('phone_status = ANY(?)', f.phoneStatuses);
  if (f.reachableOnly) where.push(`(email_status = 'valid' OR phone_status = 'valid')`);
  if (f.mergedOnly) where.push('merged_count > 1');
  if (f.industries && f.industries.length) add('industry = ANY(?)', f.industries);
  if (f.ids && f.ids.length) add('id = ANY(?)', f.ids);
  if (f.sources && f.sources.length) {
    values.push(f.sources);
    where.push(`sources ?| $${values.length}::text[]`); // jsonb 'contains any of'
  }
  if (f.hasSignals) where.push('jsonb_array_length(signals) > 0');
  if (f.ownerKnown) where.push('owner_name IS NOT NULL');
  if (f.q) {
    values.push(`%${String(f.q).toLowerCase()}%`);
    const p = `$${values.length}`;
    where.push(`(lower(company_name) LIKE ${p} OR lower(coalesce(owner_name,'')) LIKE ${p} OR lower(coalesce(email,'')) LIKE ${p} OR lower(coalesce(city,'')) LIKE ${p} OR coalesce(domain,'') LIKE ${p})`);
  }
  return { where: where.join(' AND '), values };
}

async function listLeads(uploadId, f = {}) {
  const { where, values } = buildFilter(uploadId, f);
  const sortCol = SORTABLE[f.sort] || 'score';
  const order = f.order === 'asc' ? 'ASC' : 'DESC';
  const pageSize = Math.min(Math.max(Number(f.pageSize) || 50, 1), 500);
  const page = Math.max(Number(f.page) || 1, 1);

  const { rows: countRows } = await query(`SELECT count(*)::int AS n FROM leads WHERE ${where}`, values);
  const { rows } = await query(
    `SELECT * FROM leads WHERE ${where}
      ORDER BY ${sortCol} ${order} NULLS LAST, score DESC, company_name ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    values,
  );
  return { leads: rows.map(mapRow), total: countRows[0].n, page, pageSize };
}

async function allLeads(uploadId, f = {}) {
  const { where, values } = buildFilter(uploadId, f);
  const { rows } = await query(`SELECT * FROM leads WHERE ${where} ORDER BY score DESC, company_name ASC`, values);
  return rows.map(mapRow);
}

/** Batch-update scores after a rescore, via UNNEST (one round trip). */
async function updateScores(scored) {
  if (!scored.length) return;
  await query(
    `UPDATE leads AS l
        SET score = u.score, tier = u.tier, score_reasons = u.reasons::jsonb
       FROM unnest($1::text[], $2::int[], $3::text[], $4::text[]) AS u(id, score, tier, reasons)
      WHERE l.id = u.id`,
    [scored.map((l) => l.id), scored.map((l) => l.score), scored.map((l) => l.tier), scored.map((l) => JSON.stringify(l.scoreReasons))],
  );
}

async function getLead(id) {
  const { rows } = await query(`SELECT * FROM leads WHERE id = $1`, [id]);
  return mapRow(rows[0]);
}

async function saveOutreach(id, outreach) {
  await query(`UPDATE leads SET outreach = $2 WHERE id = $1`, [id, JSON.stringify(outreach)]);
}

module.exports = {
  createUpload,
  updateUpload,
  getUpload,
  listUploads,
  deleteUpload,
  getUploadSummary,
  insertLeads,
  listLeads,
  allLeads,
  updateScores,
  getLead,
  saveOutreach,
  mapRow,
};
