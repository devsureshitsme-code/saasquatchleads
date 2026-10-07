-- SaaSquatchLeads schema. Idempotent: safe to run on every deploy.

CREATE TABLE IF NOT EXISTS uploads (
  id               TEXT PRIMARY KEY,
  file_name        TEXT        NOT NULL,
  row_count        INTEGER     NOT NULL DEFAULT 0,  -- rows in the uploaded CSV
  unique_count     INTEGER     NOT NULL DEFAULT 0,  -- leads after dedup
  duplicate_count  INTEGER     NOT NULL DEFAULT 0,  -- rows merged away
  status           TEXT        NOT NULL DEFAULT 'processing',  -- processing | ready | failed
  stage            TEXT        NOT NULL DEFAULT 'parsing',     -- parsing | deduping | validating | scoring | saving | done
  progress_done    INTEGER     NOT NULL DEFAULT 0,
  progress_total   INTEGER     NOT NULL DEFAULT 0,
  error            TEXT,
  criteria         JSONB       NOT NULL DEFAULT '{}',          -- scoring criteria in effect
  column_mapping   JSONB       NOT NULL DEFAULT '{}',          -- detected CSV header mapping
  stats            JSONB       NOT NULL DEFAULT '{}',          -- dedup / validation / cache stats
  processing_ms    INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  upload_id       TEXT        NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,

  company_name    TEXT        NOT NULL,
  norm_name       TEXT        NOT NULL,
  domain          TEXT,
  website         TEXT,
  phone           TEXT,                       -- E.164 when parseable
  email           TEXT,
  city            TEXT,
  state           TEXT,
  industry        TEXT,
  revenue         DOUBLE PRECISION,
  employees       INTEGER,
  year_founded    INTEGER,
  owner_name      TEXT,
  owner_title     TEXT,
  linkedin        TEXT,

  -- Dedup
  merged_count    INTEGER     NOT NULL DEFAULT 1,
  merged_from     JSONB       NOT NULL DEFAULT '[]',   -- [{row, companyName, email, phone, matchedOn}]

  -- Validation
  email_status    TEXT,                       -- valid | risky | invalid | missing
  email_reason    TEXT,
  email_suggestion TEXT,
  phone_status    TEXT,                       -- valid | risky | invalid | missing
  phone_reason    TEXT,
  phone_type      TEXT,
  website_status  TEXT,                       -- alive | dead | unknown | missing
  website_detail  TEXT,

  -- Scoring
  score           INTEGER     NOT NULL DEFAULT 0,
  tier            TEXT        NOT NULL DEFAULT 'C',    -- A | B | C
  score_reasons   JSONB       NOT NULL DEFAULT '[]',   -- [{label, points, max}]

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_upload_score_idx ON leads (upload_id, score DESC);
CREATE INDEX IF NOT EXISTS leads_domain_idx       ON leads (domain);

-- v2: company search, website crawling and AI enrichment
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS source TEXT  NOT NULL DEFAULT 'csv';   -- csv | search
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS query  JSONB NOT NULL DEFAULT '{}';    -- {industry, product, location, sources, crawl, ai}

ALTER TABLE leads ADD COLUMN IF NOT EXISTS source            TEXT;                          -- csv | google_places | osm
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sources           JSONB   NOT NULL DEFAULT '[]';  -- every source that found it
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_ids        JSONB   NOT NULL DEFAULT '[]';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address           TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rating            REAL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS review_count      INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS revenue_estimated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS socials           JSONB   NOT NULL DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS signals           JSONB   NOT NULL DEFAULT '[]';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_summary        TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enrichment        JSONB   NOT NULL DEFAULT '{}';  -- provenance, pages crawled, emails found...
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach          JSONB;                          -- last AI-drafted email
