// Admin console and level-request tests (real Postgres 16 + Supabase shim).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startCluster, createUser, as, asService, onboard } from "./harness.mjs";

let cluster;
before(async () => { cluster = await startCluster(); });
after(async () => { await cluster?.stop(); });

const q1 = async (db, sql, args) => (await db.query(sql, args)).rows;
const count = async (db, sql, args) => Number((await db.query(sql, args)).rows[0].count);
const fresh = () => ({ amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 30 }] });
const stale = () => ({ amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 3600 }] });
const rpc = async (db, uid, sql, args, claims) => {
  const rows = await as(db, uid, d => q1(d, sql, args), "authenticated", claims);
  return rows[0] && Object.values(rows[0])[0];
};
const audits = db => count(db, "select count(*) from admin_audit_log");

async function makeAdmin(db, email) {
  const id = await createUser(db, email); await onboard(db, id, 3);
  await asService(db, d => d.query("select public.bootstrap_admins($1)", [[email]]));
  return id;
}

describe("non-admins are refused on every admin function", () => {
  let db, user, target;
  before(async () => {
    db = await cluster.freshDb();
    user = await createUser(db, "plain@example.com"); await onboard(db, user, 1);
    target = await createUser(db, "target@example.com"); await onboard(db, target, 1);
  });
  after(() => db.end());

  test("every admin_* function raises 'admin only' for a normal user", async () => {
    const calls = [
      ["select public.admin_overview()", []],
      ["select public.admin_list_users(null, 25, 0)", []],
      ["select public.admin_user_detail($1)", [target]],
      ["select public.admin_grant_level($1, 2::smallint, null, null)", [target]],
      ["select public.admin_revoke_level($1, 1::smallint)", [target]],
      ["select public.admin_bulk_grant(array[$1::uuid], 2::smallint, null)", [target]],
      ["select public.admin_set_active_level($1, 1::smallint)", [target]],
      ["select public.admin_set_admin($1, true)", [user]],
      ["select public.admin_set_disabled($1, true)", [target]],
      ["select public.admin_decide_request(1, true, null)", []],
      ["select public.admin_import_users('[{\"email\":\"x@example.com\",\"levels\":[3]}]'::jsonb)", []],
      ["select public.admin_delete_invite('x@example.com')", []],
      ["select public.admin_analytics()", []],
      ["select public.admin_join_policy()", []],
      ["select public.admin_set_join_policy('open', '{}')", []],
      ["select public.admin_content('topics', null)", []],
      ["select public.admin_save_topic('{\"id\":\"databricks/acid\",\"name\":\"Hacked\"}'::jsonb)", []],
      ["select public.admin_save_card('{\"deck\":\"x\",\"question\":\"q\",\"answer\":\"a\",\"topic_id\":\"databricks/acid\"}'::jsonb)", []],
      ["select public.admin_save_design('{\"title\":\"x\",\"points\":[\"p\"]}'::jsonb)", []],
      ["select public.admin_save_document('sprint_intro', '{\"intro\":\"hacked\"}'::jsonb)", []],
      ["select public.admin_restore_version('topic', 'databricks/acid', 1)", []],
    ];
    // The test below guarantees this list covers every admin_* function in the database.
    const fns = (await q1(db, "select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname like 'admin\\_%' order by 1")).map(r => r.proname);
    assert.deepEqual(fns, calls.map(([s]) => s.match(/public\.(admin_\w+)/)[1]).sort());
    for (const [sql, args] of calls)
      await assert.rejects(as(db, user, d => d.query(sql, args), "authenticated", fresh()), /admin only/, sql);
    assert.equal(await audits(db), 0, "nothing was audited because nothing happened");
    assert.equal(await count(db, "select count(*) from level_grants where user_id = $1", [target]), 1);
  });

  test("a disabled admin is refused too", async () => {
    const a = await makeAdmin(db, "was-admin@example.com");
    await db.query("update profiles set disabled_at = now() where id = $1", [a]);
    await assert.rejects(as(db, a, d => d.query("select public.admin_overview()")), /admin only/);
  });
});

describe("granting and revoking levels", () => {
  let db, admin, u;
  before(async () => {
    db = await cluster.freshDb();
    admin = await makeAdmin(db, "boss@example.com");
    u = await createUser(db, "learner@example.com"); await onboard(db, u, 1);
  });
  after(() => db.end());

  test("grant adds a level, audits it with before/after and notifies the user", async () => {
    const n = await audits(db);
    const acc = await rpc(db, admin, "select public.admin_grant_level($1, 2::smallint, null, 'promo')", [u]);
    assert.deepEqual(acc.granted, [1, 2]);
    assert.equal(await audits(db), n + 1);
    const [a] = await q1(db, "select actor_id, action, target_user_id, before, after from admin_audit_log order by id desc limit 1");
    assert.equal(a.actor_id, admin); assert.equal(a.action, "grant_level"); assert.equal(a.target_user_id, u);
    assert.deepEqual(a.before.levels, [1]); assert.deepEqual(a.after.levels, [1, 2]);
    assert.equal(await count(db, "select count(*) from notifications where user_id = $1 and kind = 'level_granted'", [u]), 1);
    await rpc(db, admin, "select public.admin_grant_level($1, 2::smallint, null, null)", [u]);
    assert.equal(await audits(db), n + 1, "granting a held level is a no-op");
  });

  test("expiry must be in the future and changing it is audited", async () => {
    await assert.rejects(as(db, admin, d => d.query("select public.admin_grant_level($1, 2::smallint, now() - interval '1 day', null)", [u])), /future/);
    const n = await audits(db);
    await rpc(db, admin, "select public.admin_grant_level($1, 2::smallint, now() + interval '30 days', null)", [u]);
    const [a] = await q1(db, "select action from admin_audit_log order by id desc limit 1");
    assert.equal(a.action, "change_grant_expiry"); assert.equal(await audits(db), n + 1);
  });

  test("an expired grant can be granted again", async () => {
    await db.query("update level_grants set granted_at = now() - interval '2 days', expires_at = now() - interval '1 day' where user_id = $1 and level = 2 and revoked_at is null", [u]);
    assert.deepEqual((await rpc(db, admin, "select public.my_access()", [])) && (await as(db, u, d => q1(d, "select public.my_access() a")))[0].a.levels, [1]);
    const acc = await rpc(db, admin, "select public.admin_grant_level($1, 2::smallint, null, null)", [u]);
    assert.deepEqual(acc.granted, [1, 2]);
  });

  test("revoke keeps progress, moves the active level and refuses to remove the last level", async () => {
    await as(db, u, d => d.query("select public.set_active_level(2::smallint)"));
    await as(db, u, d => d.query("select public.set_topic_status('databricks/liquid-clustering', 2::smallint)"));
    const n = await audits(db);
    const acc = await rpc(db, admin, "select public.admin_revoke_level($1, 2::smallint)", [u]);
    assert.deepEqual(acc.granted, [1]); assert.equal(acc.active_level, 1, "falls back to the lowest remaining level");
    assert.equal(await audits(db), n + 1);
    assert.equal(await count(db, "select count(*) from topic_progress where user_id = $1 and topic_id = 'databricks/liquid-clustering' and status = 2", [u]), 1);
    await assert.rejects(as(db, admin, d => d.query("select public.admin_revoke_level($1, 1::smallint)", [u])), /at least one level/);
    await assert.rejects(as(db, admin, d => d.query("select public.admin_revoke_level($1, 3::smallint)", [u])), /not granted/);
    await rpc(db, admin, "select public.admin_grant_level($1, 2::smallint, null, null)", [u]);
    const [p] = await as(db, u, d => q1(d, "select status from topic_progress where topic_id = 'databricks/liquid-clustering'"));
    assert.equal(p.status, 2, "progress is back after regranting");
  });

  test("bulk grant and set active level", async () => {
    const v = await createUser(db, "v@example.com"); await onboard(db, v, 1);
    const n = await audits(db);
    const r = await rpc(db, admin, "select public.admin_bulk_grant($1::uuid[], 3::smallint, null)", [[u, v, v]]);
    assert.deepEqual(r, { granted: 2, already_held: 0 });
    assert.equal(await audits(db), n + 2, "one audit entry per user changed");
    await assert.rejects(as(db, admin, d => d.query("select public.admin_set_active_level($1, 2::smallint)", [v])), /grant level 2/);
    const acc = await rpc(db, admin, "select public.admin_set_active_level($1, 3::smallint)", [v]);
    assert.equal(acc.active_level, 3);
    const [a] = await q1(db, "select action, before, after from admin_audit_log order by id desc limit 1");
    assert.equal(a.action, "set_active_level"); assert.equal(a.before.active_level, 1); assert.equal(a.after.active_level, 3);
  });
});

describe("admin roles and account status", () => {
  let db, a, b, u;
  before(async () => {
    db = await cluster.freshDb();
    a = await makeAdmin(db, "a@example.com");
    u = await createUser(db, "u@example.com"); await onboard(db, u, 1);
  });
  after(() => db.end());

  test("promoting requires a sign-in within the last 10 minutes", async () => {
    await assert.rejects(as(db, a, d => d.query("select public.admin_set_admin($1, true)", [u])), /reauth required/);
    await assert.rejects(as(db, a, d => d.query("select public.admin_set_admin($1, true)", [u]), "authenticated", stale()), /reauth required/);
    const n = await audits(db);
    const acc = await rpc(db, a, "select public.admin_set_admin($1, true)", [u], fresh());
    assert.equal(acc.is_admin, true); assert.deepEqual(acc.levels, [1, 2, 3]);
    assert.equal(await audits(db), n + 1);
    b = u;
  });

  test("the last active admin can't be demoted or disabled", async () => {
    await rpc(db, a, "select public.admin_set_admin($1, false)", [b], fresh());
    await assert.rejects(as(db, a, d => d.query("select public.admin_set_admin($1, false)", [a]), "authenticated", fresh()), /last admin/);
    // A disabled admin doesn't count as a remaining admin.
    await rpc(db, a, "select public.admin_set_admin($1, true)", [b], fresh());
    await rpc(db, a, "select public.admin_set_disabled($1, true)", [b]);
    await assert.rejects(as(db, a, d => d.query("select public.admin_set_admin($1, false)", [a]), "authenticated", fresh()), /last admin/);
    await assert.rejects(as(db, a, d => d.query("select public.admin_set_disabled($1, true)", [a])), /your own account/);
    assert.equal((await q1(db, "select is_admin from roles where user_id = $1", [a]))[0].is_admin, true);
  });

  test("disable and re-enable are audited and take effect immediately", async () => {
    const c = await createUser(db, "c@example.com"); await onboard(db, c, 1);
    const n = await audits(db);
    await rpc(db, a, "select public.admin_set_disabled($1, true)", [c]);
    assert.equal(await as(db, c, d => count(d, "select count(*) from topics")), 0);
    await rpc(db, a, "select public.admin_set_disabled($1, false)", [c]);
    assert.equal(await as(db, c, d => count(d, "select count(*) from topics")), 71);
    const acts = (await q1(db, "select action from admin_audit_log where id > (select max(id) - 2 from admin_audit_log) order by id")).map(r => r.action);
    assert.deepEqual(acts, ["disable_user", "enable_user"]); assert.equal(await audits(db), n + 2);
  });
});

describe("level requests", () => {
  let db, admin, u;
  before(async () => {
    db = await cluster.freshDb();
    admin = await makeAdmin(db, "boss@example.com");
    u = await createUser(db, "asker@example.com"); await onboard(db, u, 1);
  });
  after(() => db.end());

  test("a user can request a level they don't hold, once at a time", async () => {
    await assert.rejects(as(db, u, d => d.query("select public.request_level(1::smallint, null)")), /already have this level/);
    const id = await rpc(db, u, "select public.request_level(2::smallint, 'moving to a principal role')", []);
    assert.ok(id);
    await assert.rejects(as(db, u, d => d.query("select public.request_level(2::smallint, null)")), /pending request/);
    assert.equal(await as(db, u, d => count(d, "select count(*) from level_requests")), 1);
  });

  test("users can't approve their own request or change requests directly", async () => {
    await assert.rejects(as(db, u, d => d.query("update level_requests set status = 'approved'")), /permission denied/);
    await assert.rejects(as(db, u, d => d.query("select public.admin_decide_request(id, true, null) from level_requests")), /admin only/);
  });

  test("approving grants the level, notifies the user and is audited", async () => {
    const [{ id }] = await q1(db, "select id from level_requests where user_id = $1", [u]);
    const n = await audits(db);
    const acc = await rpc(db, admin, "select public.admin_decide_request($1, true, 'welcome')", [id]);
    assert.deepEqual(acc.granted, [1, 2]);
    const acts = (await q1(db, "select action from admin_audit_log order by id desc limit 2")).map(r => r.action);
    assert.deepEqual(acts.sort(), ["approve_request", "grant_level"]); assert.equal(await audits(db), n + 2);
    assert.equal(await as(db, u, d => count(d, "select count(*) from notifications where kind = 'request_approved'")), 1);
    await assert.rejects(as(db, admin, d => d.query("select public.admin_decide_request($1, false, null)", [id])), /already approved/);
  });

  test("denying and cancelling", async () => {
    const id3 = await rpc(db, u, "select public.request_level(3::smallint, null)", []);
    await rpc(db, admin, "select public.admin_decide_request($1, false, 'not yet')", [id3]);
    const [r] = await q1(db, "select status, decision_note from level_requests where id = $1", [id3]);
    assert.equal(r.status, "denied"); assert.equal(r.decision_note, "not yet");
    assert.equal(await as(db, u, d => count(d, "select count(*) from notifications where kind = 'request_denied'")), 1);
    const again = await rpc(db, u, "select public.request_level(3::smallint, null)", []);
    await as(db, u, d => d.query("select public.cancel_level_request($1)", [again]));
    assert.equal((await q1(db, "select status from level_requests where id = $1", [again]))[0].status, "cancelled");
  });
});

describe("user list, detail and CSV import", () => {
  let db, admin, u;
  before(async () => {
    db = await cluster.freshDb();
    admin = await makeAdmin(db, "boss@example.com");
    u = await createUser(db, "priya.sharma@example.com", { name: "Priya Sharma" }); await onboard(db, u, 1);
    await as(db, u, async d => {
      await d.query("select public.set_topic_status('databricks/acid', 2::smallint)");
      await d.query("insert into notes (user_id, topic_id, body_md) values ($1, 'databricks/acid', 'TOP SECRET NOTE')", [u]);
    });
  });
  after(() => db.end());

  test("list searches by email or name and pages", async () => {
    const all = await rpc(db, admin, "select public.admin_list_users(null, 25, 0)", []);
    assert.equal(all.total, 2);
    const hit = await rpc(db, admin, "select public.admin_list_users('SHARMA', 25, 0)", []);
    assert.equal(hit.total, 1); assert.equal(hit.users[0].email, "priya.sharma@example.com");
    assert.equal(hit.users[0].topics_done, 1); assert.deepEqual(hit.users[0].granted, [1]);
    assert.equal((await rpc(db, admin, "select public.admin_list_users('%', 25, 0)", [])).total, 0, "search is literal, not a pattern");
    assert.equal((await rpc(db, admin, "select public.admin_list_users(null, 1, 1)", [])).users.length, 1);
  });

  test("user detail has progress but never private notes", async () => {
    const d = await rpc(db, admin, "select public.admin_user_detail($1)", [u]);
    assert.equal(d.progress.length, 3);
    const db1 = d.progress[0].domains.find(x => x.domain === "Databricks");
    assert.equal(db1.done, 1);
    assert.ok(!JSON.stringify(d).includes("TOP SECRET NOTE"));
  });

  test("import grants existing users, invites new ones and skips bad rows", async () => {
    const rows = [
      { email: "PRIYA.SHARMA@example.com", levels: [2, 3] },
      { email: "newbie@example.com", levels: [2] },
      { email: "not-an-email", levels: [1] },
      { email: "nolevels@example.com", levels: [7] },
    ];
    const r = await rpc(db, admin, "select public.admin_import_users($1::jsonb)", [JSON.stringify(rows)]);
    assert.equal(r.granted, 2); assert.equal(r.invited, 1); assert.equal(r.skipped.length, 2);
    assert.deepEqual((await rpc(db, admin, "select public.admin_user_detail($1)", [u])).access.granted, [1, 2, 3]);
    assert.equal(await count(db, "select count(*) from admin_audit_log where action = 'import_invite' and entity_id = 'newbie@example.com'"), 1);
  });

  test("an invite is claimed at onboarding by a verified email, replacing the level picker", async () => {
    const n = await createUser(db, "newbie@example.com");
    const [inv] = await as(db, n, d => q1(d, "select public.my_invite() l"));
    assert.deepEqual(inv.l, [2]);
    const [a] = await as(db, n, d => q1(d, "select public.complete_onboarding(1::smallint, 'UTC', null) a"));
    assert.deepEqual(a.a.levels, [2], "invite levels win over the picker");
    assert.ok((await q1(db, "select claimed_at from level_invites where email = 'newbie@example.com'"))[0].claimed_at);
  });

  test("an unverified account doesn't claim an invite", async () => {
    await rpc(db, admin, "select public.admin_import_users($1::jsonb)", [JSON.stringify([{ email: "pending@example.com", levels: [3] }])]);
    const p = await createUser(db, "pending@example.com", { verified: false });
    const [a] = await as(db, p, d => q1(d, "select public.complete_onboarding(1::smallint, 'UTC', null) a"));
    assert.deepEqual(a.a.levels, [1]);
  });

  test("admin-granted levels before onboarding are kept", async () => {
    const g = await createUser(db, "pregranted@example.com");
    await rpc(db, admin, "select public.admin_grant_level($1, 3::smallint, null, null)", [g]);
    const [a] = await as(db, g, d => q1(d, "select public.complete_onboarding(1::smallint, 'UTC', null) a"));
    assert.deepEqual(a.a.levels, [3]); assert.equal(a.a.active_level, 3);
  });
});
