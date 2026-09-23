import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
export function database(connectionString) {
  const pool = new pg.Pool({ connectionString, max:10 });
  const context = new AsyncLocalStorage();
  const q = (sql, params=[]) => (context.getStore() || pool).query(sql, params);
  return { pool, q,
    async init() { await q(await readFile(new URL('./schema.sql',import.meta.url),'utf8')); },
    async lock(key, fn) {
      const client = await pool.connect();
      try { await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[String(key)]); return await context.run(client,()=>fn(client)); }
      finally { try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[String(key)]); } finally { client.release(); } }
    },
    async transaction(fn) {
      const inherited=context.getStore();
      const client = inherited || await pool.connect();
      try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
      catch (err) { await client.query('ROLLBACK'); throw err; } finally { if(!inherited) client.release(); }
    }
  };
}
