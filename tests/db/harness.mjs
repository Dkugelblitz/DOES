// Throwaway Postgres 16 cluster for DB tests: shim + migrations + seed in a template DB,
// then each test suite clones the template. Uses the system Postgres binaries
// (PG_BIN, default /usr/lib/postgresql/16/bin). Runs the server as the `postgres`
// OS user when the tests run as root, because initdb refuses to run as root.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seed } from "../../scripts/seed-db.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BIN = process.env.PG_BIN || "/usr/lib/postgresql/16/bin";
const asRoot = process.getuid?.() === 0;
const run = (cmd, args) => execFileSync(asRoot ? "runuser" : join(BIN, cmd), asRoot ? ["-u", "postgres", "--", join(BIN, cmd), ...args] : args, { stdio: "pipe" });

export async function startCluster() {
  const dir = mkdtempSync(join(tmpdir(), "deos-pg-"));
  chmodSync(dir, 0o777);
  const data = join(dir, "data"), port = 20000 + Math.floor(Math.random() * 20000);
  if (asRoot) execFileSync("chown", ["postgres", dir]);
  run("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"]);
  run("pg_ctl", ["-D", data, "-o", `-p ${port} -k ${dir} -c listen_addresses=''`, "-w", "-l", join(dir, "log"), "start"]);
  const conn = db => ({ host: dir, port, user: "postgres", database: db });
  const admin = new pg.Client(conn("postgres")); await admin.connect();
  await admin.query("create database deos_template");
  const t = new pg.Client(conn("deos_template")); await t.connect();
  await t.query(readFileSync(join(ROOT, "tests/db/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(join(ROOT, "supabase/migrations")).filter(f => f.endsWith(".sql")).sort())
    await t.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
  const seedResult = await seed(t, { mode: "init" });
  await t.end();
  let n = 0;
  return {
    seedResult,
    url: db => `postgresql://postgres@localhost/${db}?host=${encodeURIComponent(dir)}&port=${port}`,
    admin,
    async freshDb() {
      const name = `deos_t${++n}`;
      await admin.query(`create database ${name} template deos_template`);
      const c = new pg.Client(conn(name)); await c.connect();
      return c;
    },
    async stop() {
      await admin.end();
      run("pg_ctl", ["-D", data, "-m", "immediate", "stop"]);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---- helpers that act like Supabase requests ----
export async function createUser(db, email, { verified = true, name = null } = {}) {
  const { rows } = await db.query(
    "insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3) returning id",
    [email, verified ? new Date() : null, JSON.stringify(name ? { full_name: name } : {})]);
  return rows[0].id;
}

// Run fn inside a transaction as an end user (role authenticated + JWT sub), like PostgREST does.
// `claims` adds JWT claims, e.g. a recent sign-in: { amr: [{ method: "password", timestamp: <unix secs> }] }.
export async function as(db, uid, fn, role = "authenticated", claims = {}) {
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ ...(uid ? { sub: uid } : {}), role, ...claims })]);
    const r = await fn(db);
    await db.query("commit");
    return r;
  } catch (e) { await db.query("rollback"); throw e; }
}
export const asAnon = (db, fn) => as(db, null, fn, "anon");
export const asService = (db, fn) => as(db, null, fn, "service_role");

export async function onboard(db, uid, level) {
  return as(db, uid, d => d.query("select public.complete_onboarding($1::smallint, 'Asia/Kolkata', null) as a", [level]));
}
