import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

// Credenciales/host vía variables PG* estándar (PGHOST, PGUSER, PGPASSWORD, PGDATABASE).
export function createPool() {
  const pool = new pg.Pool({
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000, // lo aplica el servidor
    query_timeout: 5_000 // lo aplica el cliente pg
  });
  pool.on('error', () => {}); // errores de clientes ociosos: no tumbar el proceso
  return pool;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Migrador idempotente: lock asesor + tabla schema_migrations + una transacción por archivo.
export async function migrate(pool, dir, log = console) {
  let client;
  for (let attempt = 1; ; attempt++) {
    try {
      client = await pool.connect();
      break;
    } catch (err) {
      if (attempt >= 15) throw err;
      log.warn?.(`BD no disponible (intento ${attempt}), reintentando...`);
      await sleep(1000);
    }
  }
  try {
    await client.query('SELECT pg_advisory_lock($1)', [727274]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const done = new Set(rows.map((r) => r.version));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
        await client.query('COMMIT');
        log.info?.(`migración aplicada: ${f}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [727274]).catch(() => {});
    client.release();
  }
}
