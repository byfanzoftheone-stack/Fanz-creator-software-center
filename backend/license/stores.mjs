// Pluggable, async, transactional stores for license-webhook.
// Every store implements:  async transaction(fn)  where fn(tx) receives an object with:
//   claimEvent(id, type, at) -> boolean   (true only for the FIRST claim of this event id)
//   putLicense(hash, lic)      getLicense(hash) -> lic|null
//   revokeMatching({subscription, customer, reason, at}) -> count revoked
//   putOutbox(hash, entry)     listPending() -> [{hash,tier,email,key}]
//   markDelivered(hash, approver, at)   (throws if unknown)
// If fn throws, NOTHING from that transaction is kept (so a Stripe retry can succeed).
// Zero dependencies: Postgres takes an injected pool (e.g. new pg.Pool(...)).
import fs from 'node:fs';
import path from 'node:path';

/** Serialises async work in one process. */
class Mutex {
  constructor() { this.tail = Promise.resolve(); }
  run(fn) {
    const r = this.tail.then(() => fn());
    this.tail = r.catch(() => {});
    return r;
  }
}

const EMPTY = () => ({ events: {}, licenses: {}, outbox: {} });

class DocTx {
  constructor(db) { this.db = db; }
  async claimEvent(id, type, at) {
    if (this.db.events[id]) return false;
    this.db.events[id] = { type, at };
    return true;
  }
  async putLicense(hash, lic) { this.db.licenses[hash] = lic; }
  async getLicense(hash) { return this.db.licenses[hash] || null; }
  async revokeMatching({ subscription, customer, reason, at }) {
    let n = 0;
    for (const lic of Object.values(this.db.licenses)) {
      const match = (subscription && lic.subscription === subscription) || (customer && lic.customer === customer);
      if (match && lic.status === 'active') { lic.status = 'revoked'; lic.revoked = at; lic.reason = reason; n++; }
    }
    return n;
  }
  async putOutbox(hash, entry) { this.db.outbox[hash] = entry; }
  async listPending() {
    return Object.entries(this.db.outbox).filter(([, o]) => o.status === 'pending_delivery')
      .map(([hash, o]) => ({ hash, tier: o.tier, email: o.email ?? null, key: o.key }));
  }
  async markDelivered(hash, approver, at) {
    const o = this.db.outbox[hash];
    if (!o) throw new Error('unknown outbox entry');
    this.db.outbox[hash] = { tier: o.tier, status: 'delivered', delivered_at: at, approver };
  }
}

/** In-memory (tests, demos). Lost on restart. */
export class MemoryStore {
  constructor() { this.db = EMPTY(); this.mutex = new Mutex(); }
  transaction(fn) {
    return this.mutex.run(async () => {
      const copy = structuredClone(this.db);
      const out = await fn(new DocTx(copy));
      this.db = copy;
      return out;
    });
  }
}

/** JSON file. Same file format as the original sync JsonStore, so existing DBs keep working.
 *  Single process only (document in your deploy notes). */
export class JsonFileStore {
  constructor(file) { this.file = file; this.mutex = new Mutex(); fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); }
  #read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return EMPTY(); throw e; }
  }
  transaction(fn) {
    return this.mutex.run(async () => {
      const db = this.#read();
      for (const k of ['events', 'licenses', 'outbox']) db[k] ||= {};
      const out = await fn(new DocTx(db));
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      return out;
    });
  }
}

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS license_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS licenses (
  hash TEXT PRIMARY KEY, tier TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL,
  customer TEXT, subscription TEXT, email_masked TEXT, session TEXT, revoked TEXT, reason TEXT);
CREATE INDEX IF NOT EXISTS licenses_subscription ON licenses(subscription);
CREATE INDEX IF NOT EXISTS licenses_customer ON licenses(customer);
CREATE TABLE IF NOT EXISTS license_outbox (
  hash TEXT PRIMARY KEY, tier TEXT NOT NULL, status TEXT NOT NULL, key TEXT, email TEXT,
  created TEXT, delivered_at TEXT, approver TEXT);
`;

const LIC_COLS = ['tier', 'status', 'created', 'customer', 'subscription', 'email_masked', 'session', 'revoked', 'reason'];
const lic = (row) => { if (!row) return null; const o = {}; for (const c of LIC_COLS) if (row[c] !== null && row[c] !== undefined) o[c] = row[c]; return o; };

class SqliteTx {
  constructor(db) { this.db = db; }
  async claimEvent(id, type, at) {
    return this.db.prepare('INSERT OR IGNORE INTO license_events(id,type,at) VALUES(?,?,?)').run(id, type, at).changes === 1;
  }
  async putLicense(hash, l) {
    this.db.prepare(`INSERT OR REPLACE INTO licenses(hash,tier,status,created,customer,subscription,email_masked,session,revoked,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(hash, l.tier, l.status, l.created, l.customer ?? null, l.subscription ?? null,
      l.email_masked ?? null, l.session ?? null, l.revoked ?? null, l.reason ?? null);
  }
  async getLicense(hash) { return lic(this.db.prepare('SELECT * FROM licenses WHERE hash=?').get(hash)); }
  async revokeMatching({ subscription, customer, reason, at }) {
    return this.db.prepare(`UPDATE licenses SET status='revoked', revoked=?, reason=? WHERE status='active'
      AND ((subscription IS NOT NULL AND subscription=?) OR (customer IS NOT NULL AND customer=?))`)
      .run(at, reason, subscription ?? null, customer ?? null).changes;
  }
  async putOutbox(hash, e) {
    this.db.prepare(`INSERT OR REPLACE INTO license_outbox(hash,tier,status,key,email,created,delivered_at,approver)
      VALUES(?,?,?,?,?,?,?,?)`).run(hash, e.tier, e.status, e.key ?? null, e.email ?? null, e.created ?? null, e.delivered_at ?? null, e.approver ?? null);
  }
  async listPending() {
    return this.db.prepare(`SELECT hash,tier,email,key FROM license_outbox WHERE status='pending_delivery'`).all()
      .map((r) => ({ hash: r.hash, tier: r.tier, email: r.email ?? null, key: r.key }));
  }
  async markDelivered(hash, approver, at) {
    const n = this.db.prepare(`UPDATE license_outbox SET status='delivered', key=NULL, email=NULL, delivered_at=?, approver=? WHERE hash=?`)
      .run(at, approver, hash).changes;
    if (n === 0) throw new Error('unknown outbox entry');
  }
}

/** SQLite via Node's built-in node:sqlite (Node >= 22.5). Durable, real transactions, multi-process safe
 *  on one machine with a persistent disk (Railway/Render volume, VPS). Not for ephemeral/serverless disks. */
export class SqliteStore {
  constructor(file = ':memory:') {
    this.ready = import('node:sqlite').then(({ DatabaseSync }) => {
      if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      this.db = new DatabaseSync(file);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      this.db.exec(SQLITE_SCHEMA);
      if (file !== ':memory:') { try { fs.chmodSync(file, 0o600); } catch { /* best effort */ } }
    });
    this.mutex = new Mutex();
  }
  transaction(fn) {
    return this.mutex.run(async () => {
      await this.ready;
      this.db.exec('BEGIN IMMEDIATE');
      try { const out = await fn(new SqliteTx(this.db)); this.db.exec('COMMIT'); return out; }
      catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
    });
  }
  close() { try { this.db.close(); } catch { /* ignore */ } }
}

export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS license_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS licenses (
  hash TEXT PRIMARY KEY, tier TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL,
  customer TEXT, subscription TEXT, email_masked TEXT, session TEXT, revoked TEXT, reason TEXT);
CREATE INDEX IF NOT EXISTS licenses_subscription ON licenses(subscription);
CREATE INDEX IF NOT EXISTS licenses_customer ON licenses(customer);
CREATE TABLE IF NOT EXISTS license_outbox (
  hash TEXT PRIMARY KEY, tier TEXT NOT NULL, status TEXT NOT NULL, key TEXT, email TEXT,
  created TEXT, delivered_at TEXT, approver TEXT);
`;

class PgTx {
  constructor(client) { this.c = client; }
  async claimEvent(id, type, at) {
    // Concurrent identical events block on the primary key until the first commits, then no-op: exactly-once.
    const r = await this.c.query('INSERT INTO license_events(id,type,at) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING', [id, type, at]);
    return r.rowCount === 1;
  }
  async putLicense(hash, l) {
    await this.c.query(`INSERT INTO licenses(hash,tier,status,created,customer,subscription,email_masked,session,revoked,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (hash) DO UPDATE SET tier=EXCLUDED.tier,status=EXCLUDED.status,created=EXCLUDED.created,customer=EXCLUDED.customer,
        subscription=EXCLUDED.subscription,email_masked=EXCLUDED.email_masked,session=EXCLUDED.session,revoked=EXCLUDED.revoked,reason=EXCLUDED.reason`,
      [hash, l.tier, l.status, l.created, l.customer ?? null, l.subscription ?? null, l.email_masked ?? null, l.session ?? null, l.revoked ?? null, l.reason ?? null]);
  }
  async getLicense(hash) { const r = await this.c.query('SELECT * FROM licenses WHERE hash=$1', [hash]); return lic(r.rows[0]); }
  async revokeMatching({ subscription, customer, reason, at }) {
    const r = await this.c.query(`UPDATE licenses SET status='revoked', revoked=$1, reason=$2 WHERE status='active'
      AND ((subscription IS NOT NULL AND subscription=$3) OR (customer IS NOT NULL AND customer=$4))`,
      [at, reason, subscription ?? null, customer ?? null]);
    return r.rowCount;
  }
  async putOutbox(hash, e) {
    await this.c.query(`INSERT INTO license_outbox(hash,tier,status,key,email,created,delivered_at,approver) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (hash) DO UPDATE SET tier=EXCLUDED.tier,status=EXCLUDED.status,key=EXCLUDED.key,email=EXCLUDED.email,
        created=EXCLUDED.created,delivered_at=EXCLUDED.delivered_at,approver=EXCLUDED.approver`,
      [hash, e.tier, e.status, e.key ?? null, e.email ?? null, e.created ?? null, e.delivered_at ?? null, e.approver ?? null]);
  }
  async listPending() {
    const r = await this.c.query(`SELECT hash,tier,email,key FROM license_outbox WHERE status='pending_delivery'`);
    return r.rows.map((x) => ({ hash: x.hash, tier: x.tier, email: x.email ?? null, key: x.key }));
  }
  async markDelivered(hash, approver, at) {
    const r = await this.c.query(`UPDATE license_outbox SET status='delivered', key=NULL, email=NULL, delivered_at=$1, approver=$2 WHERE hash=$3`, [at, approver, hash]);
    if (r.rowCount === 0) throw new Error('unknown outbox entry');
  }
}

/** Postgres via an injected pool (node-postgres `new Pool(...)` or anything with connect()->client.query/release).
 *  Works with Neon, Supabase, RDS, Railway Postgres: the right choice for serverless. Call `await store.ensureSchema()` once. */
export class PostgresStore {
  constructor(pool) { if (!pool || typeof pool.connect !== 'function') throw new Error('pool with connect() required'); this.pool = pool; }
  async ensureSchema() {
    const c = await this.pool.connect();
    try { await c.query(POSTGRES_SCHEMA); } finally { c.release(); }
  }
  async transaction(fn) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(new PgTx(c));
      await c.query('COMMIT');
      return out;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* connection may be dead */ }
      throw e;
    } finally { c.release(); }
  }
}

/** Pick a store from environment (fail closed: throws if nothing is configured, so callers return 503/deny, never allow).
 *   LICENSE_DATABASE_URL=postgres://...   -> PostgresStore (needs the `pg` package; use this on serverless hosts)
 *   LICENSE_DB=/data/licenses.sqlite      -> SqliteStore   (persistent disk only)
 *   LICENSE_DB=./data/licenses.json       -> JsonFileStore (local/dev, single process)
 */
export async function storeFromEnv(env = process.env) {
  const url = env.LICENSE_DATABASE_URL;
  if (url) {
    let pg;
    try { pg = (await import('pg')).default; } catch { throw new Error('LICENSE_DATABASE_URL is set but the "pg" package is not installed'); }
    const ssl = env.LICENSE_DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : undefined;
    const store = new PostgresStore(new pg.Pool({ connectionString: url, max: Number(env.LICENSE_DB_POOL_MAX) || 5, ssl }));
    await store.ensureSchema();
    return store;
  }
  const file = env.LICENSE_DB;
  if (!file) throw new Error('license store not configured: set LICENSE_DATABASE_URL (Postgres) or LICENSE_DB (path)');
  return file.endsWith('.json') ? new JsonFileStore(file) : new SqliteStore(file);
}
