-- invoice-check-agent schema.
-- Portable SQL on purpose: TEXT for decimals (exact), ISO TEXT for dates, ULID TEXT for ids.
-- No SQLite-only features in application queries, so SQL Server / PostgreSQL is a new repo impl, not a rewrite.

CREATE TABLE IF NOT EXISTS agreements (
  id                 TEXT PRIMARY KEY,
  agreement_key      TEXT UNIQUE,
  profile_id         TEXT NOT NULL,
  document_type      TEXT NOT NULL,
  source_path        TEXT NOT NULL,
  source_sha256      TEXT NOT NULL,
  currency           TEXT NOT NULL,
  valid_from         TEXT,
  valid_to           TEXT,
  total_cap          TEXT,
  status             TEXT NOT NULL,
  needs_human_review INTEGER NOT NULL,
  confidence         REAL NOT NULL,
  document_json      TEXT NOT NULL,          -- full canonical Agreement, for exact round-trips
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_agreements_profile ON agreements (profile_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agreements_source ON agreements (profile_id, source_sha256);

CREATE TABLE IF NOT EXISTS agreement_parties (
  agreement_id TEXT NOT NULL REFERENCES agreements (id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  name         TEXT NOT NULL,
  cui          TEXT NOT NULL,
  PRIMARY KEY (agreement_id, role, cui)
);
CREATE INDEX IF NOT EXISTS ix_agreement_parties_cui ON agreement_parties (cui);

CREATE TABLE IF NOT EXISTS agreement_references (
  agreement_id TEXT NOT NULL REFERENCES agreements (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  raw          TEXT NOT NULL,
  normalized   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_agreement_refs_norm ON agreement_references (normalized);

-- Normalized copy of terms for SQL reporting (e.g. a BI dashboard); the source of truth is document_json.
CREATE TABLE IF NOT EXISTS agreement_terms (
  agreement_id TEXT NOT NULL REFERENCES agreements (id) ON DELETE CASCADE,
  term_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  description  TEXT NOT NULL,
  unit         TEXT,
  unit_price   TEXT,
  max_quantity TEXT,
  amount       TEXT,
  rate         TEXT,
  period       TEXT,
  PRIMARY KEY (agreement_id, term_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id                 TEXT PRIMARY KEY,
  profile_id         TEXT NOT NULL,
  source_path        TEXT NOT NULL,
  source_sha256      TEXT NOT NULL,
  issuer_cui         TEXT NOT NULL,
  recipient_cui      TEXT NOT NULL,
  series             TEXT,
  number             TEXT NOT NULL,
  issue_date         TEXT NOT NULL,
  currency           TEXT NOT NULL,
  net                TEXT NOT NULL,
  vat                TEXT NOT NULL,
  gross              TEXT NOT NULL,
  direction          TEXT NOT NULL,
  document_json      TEXT NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_invoices_issuer_number ON invoices (profile_id, issuer_cui, number);
CREATE INDEX IF NOT EXISTS ix_invoices_issuer_gross ON invoices (profile_id, issuer_cui, gross, issue_date);

CREATE TABLE IF NOT EXISTS invoice_lines (
  invoice_id  TEXT NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  description TEXT NOT NULL,
  unit        TEXT,
  quantity    TEXT NOT NULL,
  unit_price  TEXT NOT NULL,
  net         TEXT NOT NULL,
  vat_rate    TEXT NOT NULL,
  PRIMARY KEY (invoice_id, line_no)
);

CREATE TABLE IF NOT EXISTS check_results (
  id               TEXT PRIMARY KEY,
  invoice_id       TEXT NOT NULL REFERENCES invoices (id),
  profile_id       TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  agreement_id     TEXT,
  match_method     TEXT NOT NULL,
  match_confidence REAL NOT NULL,
  verdict          TEXT NOT NULL,
  total_cost_usd   REAL NOT NULL,
  result_json      TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_check_results_invoice ON check_results (invoice_id);

CREATE TABLE IF NOT EXISTS issues (
  check_result_id TEXT NOT NULL REFERENCES check_results (id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  code            TEXT NOT NULL,
  severity        TEXT NOT NULL,
  line_no         INTEGER,
  term_id         TEXT,
  expected        TEXT,
  actual          TEXT,
  PRIMARY KEY (check_result_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_issues_code ON issues (code);

-- What has been invoiced against each agreement/term. The agent writes pending_review; humans approve/reject.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              TEXT PRIMARY KEY,
  agreement_id    TEXT NOT NULL REFERENCES agreements (id),
  term_id         TEXT,
  invoice_id      TEXT NOT NULL REFERENCES invoices (id),
  invoice_number  TEXT NOT NULL,
  issuer_cui      TEXT NOT NULL,
  quantity        TEXT,
  net             TEXT NOT NULL,
  currency        TEXT NOT NULL,
  period_from     TEXT,
  period_to       TEXT,
  status          TEXT NOT NULL,
  recorded_at     TEXT NOT NULL,
  check_result_id TEXT NOT NULL REFERENCES check_results (id)
);
CREATE INDEX IF NOT EXISTS ix_ledger_agreement ON ledger_entries (agreement_id, term_id);

-- Token usage and cost per LLM call. Never stores document content.
CREATE TABLE IF NOT EXISTS llm_calls (
  id                 TEXT PRIMARY KEY,
  task               TEXT NOT NULL,
  model              TEXT NOT NULL,
  document_sha256    TEXT,
  input_tokens       INTEGER NOT NULL,
  output_tokens      INTEGER NOT NULL,
  cache_read_tokens  INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cost_usd           REAL NOT NULL,
  latency_ms         INTEGER NOT NULL,
  cached             INTEGER NOT NULL,
  created_at         TEXT NOT NULL
);
