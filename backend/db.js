const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: url,
  ssl: url && /sslmode=require|railway\.app|rlwy\.net/.test(url) && !/railway\.internal/.test(url) ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  is_adult BOOLEAN NOT NULL,
  is_public_figure BOOLEAN NOT NULL,
  code_words TEXT[] NOT NULL,
  phrase TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | passed | failed | used | withdrawn
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  statement_audio BYTEA,
  statement_mime TEXT,
  statement_sha256 TEXT,
  transcript TEXT,
  check_detail JSONB,
  checked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS voices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id UUID NOT NULL UNIQUE REFERENCES consents(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'held',      -- held | active | rejected | revoked
  el_voice_id TEXT,
  requires_verification BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS voice_samples (
  id SERIAL PRIMARY KEY,
  voice_id UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  is_consent_statement BOOLEAN NOT NULL DEFAULT false,
  data BYTEA NOT NULL,
  mime TEXT,
  sha256 TEXT NOT NULL,
  size INT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL,
  target TEXT,
  decision TEXT,
  rule TEXT,
  detail JSONB
);

-- The audit log is append-only: updates and deletes are refused by the database itself (VC-8).
CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit log is append-only (VC-8)'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_no_change ON audit;
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON audit
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();
`;

async function init() { await pool.query(SCHEMA); }

async function audit(action, { target = null, decision = null, rule = null, detail = null } = {}) {
  await pool.query('INSERT INTO audit (action, target, decision, rule, detail) VALUES ($1,$2,$3,$4,$5)',
    [action, target, decision, rule, detail ? JSON.stringify(detail) : null]);
}

module.exports = { pool, init, audit };
