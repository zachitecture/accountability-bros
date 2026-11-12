// A real Postgres (PGlite, running in-process) loaded with the test stand-ins
// and then the exact supabase/schema.sql that gets pasted into Supabase.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function lit(v) {
  if (v === null || v === undefined) return 'null';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

export async function createDb() {
  const db = new PGlite();
  await db.exec(readFileSync(join(here, 'stubs.sql'), 'utf8'));
  await db.exec(readFileSync(join(here, '..', 'supabase', 'schema.sql'), 'utf8'));

  // Run one statement the way Supabase would for a signed-in member.
  async function asUser(uid, sql, role = 'authenticated') {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.exec(`select set_config('request.jwt.claim.sub', ${lit(uid || '')}, true)`);
      const res = await tx.query(sql);
      return res.rows;
    });
  }

  async function call(uid, fn, args = {}, role = 'authenticated') {
    if (!/^[a-z_]+$/.test(fn)) throw new Error('bad function name');
    const list = Object.entries(args)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (!/^[a-z_]+$/.test(k)) throw new Error('bad argument name');
        return `${k} => ${lit(v)}`;
      })
      .join(', ');
    const rows = await asUser(uid, `select public.${fn}(${list}) as r`, role);
    return rows[0].r;
  }

  async function newUser(email, password = 'password123') {
    const res = await db.query(`insert into auth.users (email, password) values (${lit(email)}, ${lit(password)}) returning id`);
    return res.rows[0].id;
  }

  async function setNow(iso) {
    await db.exec(
      `create or replace function public.app_now() returns timestamptz language sql stable as $f$ select ${lit(iso)}::timestamptz $f$`
    );
  }

  return { db, asUser, call, newUser, setNow };
}
