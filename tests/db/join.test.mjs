// Control who can join (real Postgres 16 + Supabase shim).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startCluster, createUser, as, asService, onboard } from "./harness.mjs";

let cluster, db, admin, member;
before(async () => {
  cluster = await startCluster();
  db = await cluster.freshDb();
  admin = await createUser(db, "root@example.com"); await onboard(db, admin, 3);
  await asService(db, d => d.query("select public.bootstrap_admins(array['root@example.com'])"));
  member = await createUser(db, "member@example.com"); await onboard(db, member, 1);
});
after(async () => { await db?.end(); await cluster?.stop(); });

const call = (uid, sql, args) => as(db, uid, d => d.query(sql, args)).then(r => Object.values(r.rows[0])[0]);
const setPolicy = (mode, domains) => call(admin, "select public.admin_set_join_policy($1, $2)", [mode, domains]);
const status = uid => call(uid, "select public.my_join_status()");
const tryOnboard = (uid, level = 1) => as(db, uid, d => d.query("select public.complete_onboarding($1::smallint, 'UTC', null)", [level]));

describe("join policy", () => {
  test("open by default: anyone can join", async () => {
    const u = await createUser(db, "anyone@random.org");
    assert.deepEqual(await status(u), { mode: "open", allowed: true, reason: "open", pending_requests: [] });
    await tryOnboard(u);
  });

  test("only admins can read or change it, and changes are audited", async () => {
    await assert.rejects(as(db, member, d => d.query("select public.admin_set_join_policy('invite_only', '{}')")), /admin only/);
    await assert.rejects(as(db, member, d => d.query("select public.admin_join_policy()")), /admin only/);
    await assert.rejects(as(db, member, d => d.query("select * from join_policy")), /permission denied/);
    const r = await setPolicy("invite_only", ["@Acme.com ", "partner.co.in", ""]);
    assert.equal(r.mode, "invite_only"); assert.deepEqual(r.allowed_domains, ["acme.com", "partner.co.in"]);
    const [a] = (await db.query("select action, before, after from admin_audit_log order by id desc limit 1")).rows;
    assert.equal(a.action, "set_join_policy"); assert.equal(a.before.mode, "open"); assert.equal(a.after.mode, "invite_only");
  });

  test("bad domains and gmail.com are refused", async () => {
    await assert.rejects(as(db, admin, d => d.query("select public.admin_set_join_policy('invite_only', array['not a domain'])")), /domains look like/);
    await assert.rejects(as(db, admin, d => d.query("select public.admin_set_join_policy('invite_only', array['gmail.com'])")), /use Open mode/);
    await assert.rejects(as(db, admin, d => d.query("select public.admin_set_join_policy('closed', '{}')")), /open or invite_only/);
  });

  test("invite-only: strangers wait and see nothing; existing members are unaffected", async () => {
    const s = await createUser(db, "stranger@random.org");
    assert.deepEqual(await status(s), { mode: "invite_only", allowed: false, reason: "not_invited", pending_requests: [] });
    await assert.rejects(tryOnboard(s), /invite only/);
    assert.equal(await as(db, s, d => d.query("select count(*)::int n from topics")).then(r => r.rows[0].n), 0);
    assert.equal(await as(db, member, d => d.query("select count(*)::int n from topics")).then(r => r.rows[0].n), 71, "members keep access");
  });

  test("allowed domains (case-insensitive) and CSV invites can join", async () => {
    const d = await createUser(db, "Priya@ACME.com");
    assert.equal((await status(d)).reason, "domain");
    await tryOnboard(d, 2);
    const sub = await createUser(db, "x@eu.acme.com");
    assert.equal((await status(sub)).allowed, false, "only the exact domain, not subdomains");
    await call(admin, "select public.admin_import_users($1::jsonb)", [JSON.stringify([{ email: "guest@other.net", levels: [3] }])]);
    const g = await createUser(db, "guest@other.net");
    assert.equal((await status(g)).reason, "invited");
    const r = await tryOnboard(g, 1);
    assert.deepEqual(r.rows[0].complete_onboarding.levels, [3], "invite levels apply");
  });

  test("unverified emails can't join by domain or invite", async () => {
    const u = await createUser(db, "late@acme.com", { verified: false });
    assert.equal((await status(u)).reason, "unverified");
    await assert.rejects(tryOnboard(u), /invite only/);
  });

  test("a stranger can ask for access; approval lets them in with that level", async () => {
    const s = await createUser(db, "hopeful@random.org");
    await call(s, "select public.request_level(2::smallint, 'Preparing for a principal role')");
    assert.deepEqual((await status(s)).pending_requests, [2]);
    const [{ id }] = (await db.query("select id from level_requests where user_id = $1", [s])).rows;
    await call(admin, "select public.admin_decide_request($1, true, 'welcome')", [id]);
    assert.equal((await status(s)).reason, "approved");
    const r = await tryOnboard(s, 1);
    assert.deepEqual(r.rows[0].complete_onboarding.levels, [2], "keeps the approved level, ignores the picker");
  });

  test("switching back to open lets everyone in again", async () => {
    await setPolicy("open", []);
    const late = await createUser(db, "later@random.org");
    await tryOnboard(late);
  });
});
