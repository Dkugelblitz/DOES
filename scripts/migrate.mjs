#!/usr/bin/env node
// Applies supabase/migrations/*.sql in order to DATABASE_URL, once each.
// Records applied files in private.schema_migrations. Each file runs in its own transaction.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL (see docs/SETUP.md)"); process.exit(2); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("create schema if not exists private; create table if not exists private.schema_migrations (file text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query("select file from private.schema_migrations")).rows.map(r => r.file));
  for (const f of readdirSync(DIR).filter(f => f.endsWith(".sql")).sort()) {
    if (done.has(f)) { console.log(`skip   ${f}`); continue; }
    await db.query("begin");
    try {
      await db.query(readFileSync(join(DIR, f), "utf8"));
      await db.query("insert into private.schema_migrations (file) values ($1)", [f]);
      await db.query("commit");
      console.log(`apply  ${f}`);
    } catch (e) { await db.query("rollback"); console.error(`FAILED ${f}: ${e.message}`); process.exit(1); }
  }
} finally { await db.end(); }
