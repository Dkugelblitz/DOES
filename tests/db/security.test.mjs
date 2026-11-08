// Database security tests: run against real Postgres 16 with the Supabase shim.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startCluster, createUser, as, asAnon, asService, onboard } from "./harness.mjs";
import { seed } from "../../scripts/seed-db.mjs";

let cluster;
before(async () => { cluster = await startCluster(); });
after(async () => { await cluster?.stop(); });

const denied = (p, msg = /permission denied|row-level security|not granted|admin only|service role only|already onboarded/) => assert.rejects(p, msg);
const q1 = async (db, sql, args) => (await db.query(sql, args)).rows;
const count = async (db, sql, args) => Number((await db.query(sql, args)).rows[0].count);
const LEVEL3_TOPIC = "databricks/governance";      // min_level 3
const LEVEL2_TOPIC = "databricks/liquid-clustering"; // min_level 2
const LEVEL1_TOPIC = "databricks/merge-scd1-scd2-cdc";

describe("sign-up and onboarding", () => {
  let db; before(async () => { db = await cluster.freshDb(); }); after(() => db.end());

  test("new auth user gets a profile, a non-admin role and no levels", async () => {
    const u = await createUser(db, "new@example.com", { name: "Asha Rao" });
    const [p] = await q1(db, "select display_name, onboarded_at from profiles where id = $1", [u]);
    assert.equal(p.display_name, "Asha Rao"); assert.equal(p.onboarded_at, null);
    const [r] = await q1(db, "select is_admin from roles where user_id = $1", [u]);
    assert.equal(r.is_admin, false);
    const [a] = await as(db, u, d => q1(d, "select public.my_access() a"));
    assert.deepEqual(a.a.levels, []); assert.equal(a.a.onboarded, false);
    assert.equal(await as(db, u, d => count(d, "select count(*) from topics")), 0, "no level, no content");
  });

  test("onboarding grants exactly one level, once", async () => {
    const u = await createUser(db, "pick@example.com");
    await onboard(db, u, 2);
    const [a] = await as(db, u, d => q1(d, "select public.my_access() a"));
    assert.deepEqual(a.a.levels, [2]); assert.equal(a.a.active_level, 2); assert.equal(a.a.onboarded, true);
    await denied(onboard(db, u, 3));
    assert.equal(await count(db, "select count(*) from level_grants where user_id = $1", [u]), 1);
  });

  test("users cannot give themselves levels, admin, or an unheld active level", async () => {
    const u = await createUser(db, "sneaky@example.com"); await onboard(db, u, 1);
    await denied(as(db, u, d => d.query("insert into level_grants (user_id, level) values ($1, 3)", [u])));
    await denied(as(db, u, d => d.query("update roles set is_admin = true where user_id = $1", [u])));
    await denied(as(db, u, d => d.query("update profiles set active_level = 3 where id = $1", [u])));
    await denied(as(db, u, d => d.query("update profiles set disabled_at = null where id = $1", [u])));
    await denied(as(db, u, d => d.query("select public.set_active_level(3::smallint)")));
    await denied(as(db, u, d => d.query("insert into xp_events (user_id, kind, points, idempotency_key) values ($1, 'topic_done', 9999, 'x')", [u])));
    await denied(as(db, u, d => d.query("update user_stats set xp = 99999 where user_id = $1", [u])));
  });

  test("only allow-listed functions are callable by end users", async () => {
    const ALLOWED_AUTH = ["private.active_uid", "private.card_level", "private.held_levels", "private.is_admin", "private.max_level",
      "private.sprint_item_visible", "private.subtopic_visible", "private.topic_shared", "private.topic_visible",
      "public.complete_onboarding", "public.level_summary", "public.my_access", "public.my_topic_flags", "public.pareto_topics", "public.set_active_level", "public.set_subtopic_done", "public.set_topic_status", "public.touch_activity"];
    const rows = await q1(db, `select n.nspname || '.' || p.proname f,
        has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') order by 1`);
    assert.deepEqual(rows.filter(r => r.anon).map(r => r.f), [], "anon can execute nothing");
    assert.deepEqual(rows.filter(r => r.auth).map(r => r.f), ALLOWED_AUTH);
    const u = await createUser(db, "forger@example.com");
    await denied(as(db, u, d => d.query("select private.audit(null, 'forged', null, null, null, null, null)")));
  });

  test("anonymous callers see nothing", async () => {
    await denied(asAnon(db, d => d.query("select * from topics")));
    await denied(asAnon(db, d => d.query("select * from profiles")));
    await denied(asAnon(db, d => d.query("select public.my_access()")));
  });
});

describe("level-gated content", () => {
  let db, de, pde;
  before(async () => {
    db = await cluster.freshDb();
    de = await createUser(db, "de@example.com"); await onboard(db, de, 1);
    pde = await createUser(db, "pde@example.com"); await onboard(db, pde, 2);
  });
  after(() => db.end());

  test("a level-1 user sees only level-1 topics, subtopics, cards, designs and sprint items", async () => {
    await as(db, de, async d => {
      assert.equal(await count(d, "select count(*) from topics"), 71);
      assert.equal(await count(d, "select count(*) from topics where min_level > 1"), 0);
      assert.equal(await count(d, "select count(*) from cards"), 19);
      assert.equal(await count(d, "select count(*) from designs"), 1);
      assert.equal(await count(d, "select count(*) from sprint_items"), 29);
      assert.equal(await count(d, "select count(*) from sprint_blocks where min_level > 1"), 0);
    });
  });

  test("direct ID access to higher-level content returns nothing", async () => {
    await as(db, de, async d => {
      assert.equal(await count(d, "select count(*) from topics where id = $1", [LEVEL3_TOPIC]), 0);
      assert.equal(await count(d, "select count(*) from subtopics where topic_id = $1", [LEVEL2_TOPIC]), 0);
      assert.equal(await count(d, "select count(*) from cards where id = 'databricks-liquid-clustering-vs-partitioning-z-order'"), 0);
      assert.equal(await count(d, "select count(*) from designs where id = 'enterprise-rag-copilot-platform'"), 0);
      assert.equal(await count(d, "select count(*) from sprint_items where id = 'd2b5i1'"), 0);
    });
  });

  test("Pareto flags are only reachable for held levels", async () => {
    await denied(as(db, de, d => d.query("select pareto_levels from topics")));
    await denied(as(db, de, d => d.query("select * from public.pareto_topics(2::smallint)")));
    assert.equal(await as(db, de, d => count(d, "select count(*) from public.pareto_topics(1::smallint)")), 15);
    const flags = await as(db, de, d => q1(d, "select distinct unnest(pareto_levels) l from public.my_topic_flags()"));
    assert.deepEqual(flags.map(f => f.l), [1]);
    assert.equal(await as(db, pde, d => count(d, "select count(*) from public.pareto_topics(2::smallint)")), 28);
    await denied(as(db, pde, d => d.query("select * from public.pareto_topics(1::smallint)")), /not granted/);
  });

  test("level_summary counts the chosen level's view and refuses unheld levels", async () => {
    const [s1] = await as(db, de, d => q1(d, "select public.level_summary(1::smallint) s"));
    assert.equal(s1.s.topics, 71); assert.equal(s1.s.pareto, 15); assert.equal(s1.s.cards, 19); assert.equal(s1.s.designs, 1);
    await denied(as(db, de, d => d.query("select public.level_summary(2::smallint)")), /not granted/);
    const admin = await createUser(db, "viewer-admin@example.com"); await onboard(db, admin, 1);
    await db.query("update roles set is_admin = true where user_id = $1", [admin]);
    const counts = [];
    for (const l of [1, 2, 3]) counts.push((await as(db, admin, d => q1(d, "select public.level_summary($1::smallint) s", [l])))[0].s.topics);
    assert.deepEqual(counts, [71, 126, 148], "an admin's view narrows by the chosen level");
  });

  test("a user cannot write progress, notes or bookmarks against topics they can't see", async () => {
    await denied(as(db, de, d => d.query("insert into topic_progress (user_id, topic_id, status) values ($1, $2, 2)", [de, LEVEL3_TOPIC])));
    await denied(as(db, de, d => d.query("insert into notes (user_id, topic_id, body_md) values ($1, $2, 'x')", [de, LEVEL2_TOPIC])));
    await denied(as(db, de, d => d.query("insert into bookmarks (user_id, topic_id) values ($1, $2)", [de, LEVEL2_TOPIC])));
    await as(db, de, d => d.query("insert into topic_progress (user_id, topic_id, status) values ($1, $2, 2)", [de, LEVEL1_TOPIC]));
    const [p] = await q1(db, "select done_at, first_done_at from topic_progress where user_id = $1 and topic_id = $2", [de, LEVEL1_TOPIC]);
    assert.ok(p.done_at && p.first_done_at, "server stamps done_at");
  });
});

describe("own-data isolation", () => {
  let db, a, b;
  before(async () => {
    db = await cluster.freshDb();
    a = await createUser(db, "a@example.com"); await onboard(db, a, 1);
    b = await createUser(db, "b@example.com"); await onboard(db, b, 1);
    await as(db, b, async d => {
      await d.query("insert into topic_progress (user_id, topic_id, status) values ($1, $2, 1)", [b, LEVEL1_TOPIC]);
      await d.query("insert into notes (user_id, topic_id, body_md) values ($1, $2, 'B private note')", [b, LEVEL1_TOPIC]);
      await d.query("insert into bookmarks (user_id, topic_id) values ($1, $2)", [b, LEVEL1_TOPIC]);
      await d.query("insert into links (user_id, topic_id, kind, title) values ($1, $2, 'Link', 'B link')", [b, LEVEL1_TOPIC]);
    });
  });
  after(() => db.end());

  test("user A can't read user B's rows", async () => {
    await as(db, a, async d => {
      for (const t of ["topic_progress", "notes", "bookmarks", "links", "level_grants", "roles", "user_stats"])
        assert.equal(await count(d, `select count(*) from ${t} where user_id = $1`, [b]), 0, t);
      assert.equal(await count(d, "select count(*) from profiles where id = $1", [b]), 0);
    });
  });

  test("user A can't write rows as user B or change B's rows", async () => {
    await denied(as(db, a, d => d.query("insert into notes (user_id, topic_id, body_md) values ($1, $2, 'forged')", [b, LEVEL1_TOPIC])));
    await as(db, a, d => d.query("update notes set body_md = 'hacked' where user_id = $1", [b]));
    await as(db, a, d => d.query("delete from bookmarks where user_id = $1", [b]));
    const [n] = await q1(db, "select body_md from notes where user_id = $1", [b]);
    assert.equal(n.body_md, "B private note");
    assert.equal(await count(db, "select count(*) from bookmarks where user_id = $1", [b]), 1);
  });

  test("attachments must live under the owner's storage folder and respect type limits", async () => {
    await denied(as(db, a, d => d.query("insert into attachments (user_id, topic_id, storage_path, mime_type, bytes, original_name) values ($1, $2, $3, 'image/png', 10, 'x.png')", [a, LEVEL1_TOPIC, `${b}/x.png`])));
    await assert.rejects(as(db, a, d => d.query("insert into attachments (user_id, topic_id, storage_path, mime_type, bytes, original_name) values ($1, $2, $3, 'text/html', 10, 'x.html')", [a, LEVEL1_TOPIC, `${a}/x.html`])), /not allowed/);
    await assert.rejects(as(db, a, d => d.query("insert into attachments (user_id, topic_id, storage_path, mime_type, bytes, original_name) values ($1, $2, $3, 'application/pdf', 99999999, 'big.pdf')", [a, LEVEL1_TOPIC, `${a}/big.pdf`])), /too large/);
    await as(db, a, d => d.query("insert into attachments (user_id, topic_id, storage_path, mime_type, bytes, original_name) values ($1, $2, $3, 'image/png', 1000, 'ok.png')", [a, LEVEL1_TOPIC, `${a}/ok.png`]));
  });

  test("a disabled account sees and changes nothing", async () => {
    await db.query("update profiles set disabled_at = now() where id = $1", [b]);
    await as(db, b, async d => {
      assert.equal(await count(d, "select count(*) from topics"), 0);
      assert.equal(await count(d, "select count(*) from notes"), 0);
    });
    await denied(as(db, b, d => d.query("insert into bookmarks (user_id, topic_id) values ($1, 'databricks/acid')", [b])));
    await db.query("update profiles set disabled_at = null where id = $1", [b]);
  });
});

describe("revoking and regranting levels", () => {
  let db, u;
  before(async () => { db = await cluster.freshDb(); u = await createUser(db, "rr@example.com"); await onboard(db, u, 1); });
  after(() => db.end());

  test("revoke hides content but keeps progress; regrant brings it all back", async () => {
    await db.query("insert into level_grants (user_id, level, source) values ($1, 2, 'admin')", [u]);
    await as(db, u, async d => {
      await d.query("insert into topic_progress (user_id, topic_id, status) values ($1, $2, 2)", [u, LEVEL2_TOPIC]);
      await d.query("insert into notes (user_id, topic_id, body_md) values ($1, $2, 'liquid clustering notes')", [u, LEVEL2_TOPIC]);
    });
    await db.query("update level_grants set revoked_at = now() where user_id = $1 and level = 2", [u]);
    assert.equal(await as(db, u, d => count(d, "select count(*) from topics where id = $1", [LEVEL2_TOPIC])), 0, "hidden after revoke");
    assert.equal(await count(db, "select count(*) from topic_progress where user_id = $1 and topic_id = $2", [u, LEVEL2_TOPIC]), 1, "progress kept");
    await db.query("insert into level_grants (user_id, level, source) values ($1, 2, 'admin')", [u]);
    await as(db, u, async d => {
      assert.equal(await count(d, "select count(*) from topics where id = $1", [LEVEL2_TOPIC]), 1);
      const [p] = await q1(d, "select status from topic_progress where topic_id = $1", [LEVEL2_TOPIC]);
      assert.equal(p.status, 2);
      const [n] = await q1(d, "select body_md from notes where topic_id = $1", [LEVEL2_TOPIC]);
      assert.equal(n.body_md, "liquid clustering notes");
    });
  });

  test("an expired grant stops counting", async () => {
    await db.query("insert into level_grants (user_id, level, source, granted_at, expires_at) values ($1, 3, 'admin', now() - interval '2 days', now() - interval '1 day')", [u]);
    const [a] = await as(db, u, d => q1(d, "select public.my_access() a"));
    assert.deepEqual(a.a.levels, [1, 2]);
  });
});

describe("ADMIN_EMAILS bootstrap", () => {
  let db; before(async () => { db = await cluster.freshDb(); }); after(() => db.end());

  test("signed-in users and anonymous callers cannot run the bootstrap", async () => {
    const u = await createUser(db, "boss@example.com"); await onboard(db, u, 1);
    await denied(as(db, u, d => d.query("select public.bootstrap_admins(array['boss@example.com'])")));
    await denied(asAnon(db, d => d.query("select public.bootstrap_admins(array['boss@example.com'])")));
    const [r] = await q1(db, "select is_admin from roles where user_id = $1", [u]);
    assert.equal(r.is_admin, false);
  });

  test("unverified emails are never promoted", async () => {
    const u = await createUser(db, "unverified-admin@example.com", { verified: false });
    const [r] = await asService(db, d => q1(d, "select public.bootstrap_admins(array['unverified-admin@example.com']) n"));
    assert.equal(r.n, 0);
    assert.equal((await q1(db, "select is_admin from roles where user_id = $1", [u]))[0].is_admin, false);
  });

  test("service role promotes verified listed emails once, with an audit entry", async () => {
    const [r] = await asService(db, d => q1(d, "select public.bootstrap_admins(array[' BOSS@example.com ', '']) n"));
    assert.equal(r.n, 1);
    const [again] = await asService(db, d => q1(d, "select public.bootstrap_admins(array['boss@example.com']) n"));
    assert.equal(again.n, 0, "idempotent");
    const audit = await q1(db, "select actor_id, action, after from admin_audit_log where action = 'bootstrap_admin'");
    assert.equal(audit.length, 1); assert.equal(audit[0].actor_id, null); assert.equal(audit[0].after.is_admin, true);
  });

  test("admins hold all three levels and see all content", async () => {
    const [{ id }] = await q1(db, "select id from profiles where email = 'boss@example.com'");
    await as(db, id, async d => {
      const [a] = await q1(d, "select public.my_access() a");
      assert.equal(a.a.is_admin, true); assert.deepEqual(a.a.levels, [1, 2, 3]);
      assert.equal(await count(d, "select count(*) from topics"), 148);
      assert.equal(await count(d, "select count(*) from public.pareto_topics(3::smallint)"), 31);
      await d.query("select public.set_active_level(3::smallint)");
    });
  });
});

describe("admin read boundaries and the audit log", () => {
  let db, admin, user;
  before(async () => {
    db = await cluster.freshDb();
    admin = await createUser(db, "root@example.com"); await onboard(db, admin, 3);
    await asService(db, d => d.query("select public.bootstrap_admins(array['root@example.com'])"));
    user = await createUser(db, "learner@example.com"); await onboard(db, user, 1);
    await as(db, user, async d => {
      await d.query("insert into topic_progress (user_id, topic_id, status) values ($1, $2, 1)", [user, LEVEL1_TOPIC]);
      await d.query("insert into notes (user_id, topic_id, body_md) values ($1, $2, 'my secret thoughts')", [user, LEVEL1_TOPIC]);
      await d.query("insert into links (user_id, topic_id, kind, title) values ($1, $2, 'Article', 'private link')", [user, LEVEL1_TOPIC]);
    });
  });
  after(() => db.end());

  test("admins read profiles and progress but not unshared notes or links", async () => {
    await as(db, admin, async d => {
      assert.equal(await count(d, "select count(*) from profiles where id = $1", [user]), 1);
      assert.equal(await count(d, "select count(*) from topic_progress where user_id = $1", [user]), 1);
      assert.equal(await count(d, "select count(*) from notes where user_id = $1", [user]), 0);
      assert.equal(await count(d, "select count(*) from links where user_id = $1", [user]), 0);
    });
  });

  test("once the user shares a topic, admins can read that topic's notes and links", async () => {
    await as(db, user, d => d.query("insert into topic_shares (user_id, topic_id) values ($1, $2)", [user, LEVEL1_TOPIC]));
    await as(db, admin, async d => {
      assert.equal(await count(d, "select count(*) from notes where user_id = $1", [user]), 1);
      assert.equal(await count(d, "select count(*) from links where user_id = $1", [user]), 1);
    });
    await as(db, user, d => d.query("delete from topic_shares where user_id = $1", [user]));
    assert.equal(await as(db, admin, d => count(d, "select count(*) from notes where user_id = $1", [user])), 0, "unsharing revokes access");
  });

  test("non-admins can't read the audit log or content history", async () => {
    await as(db, user, async d => {
      assert.equal(await count(d, "select count(*) from admin_audit_log"), 0);
      assert.equal(await count(d, "select count(*) from content_versions"), 0);
    });
    assert.ok(await as(db, admin, d => count(d, "select count(*) from admin_audit_log")) >= 1);
  });

  test("the audit log is append-only, even for the database owner", async () => {
    await assert.rejects(db.query("update admin_audit_log set action = 'tampered'"), /append-only/);
    await assert.rejects(db.query("delete from admin_audit_log"), /append-only/);
    await assert.rejects(db.query("truncate admin_audit_log"), /append-only/);
    await assert.rejects(db.query("delete from content_versions"), /append-only/);
  });

  test("a demoted (non-admin) user loses admin reads immediately", async () => {
    await db.query("update roles set is_admin = false where user_id = $1", [admin]);
    await as(db, admin, async d => {
      assert.equal(await count(d, "select count(*) from profiles where id = $1", [user]), 0);
      assert.equal(await count(d, "select count(*) from admin_audit_log"), 0);
    });
    await db.query("update roles set is_admin = true where user_id = $1", [admin]);
  });
});

describe("content seeding", () => {
  test("re-seeding in init mode never overwrites; force mode only versions real changes", async () => {
    const db = await cluster.freshDb();
    const before = await count(db, "select count(*) from content_versions");
    const init = await seed(db, { mode: "init" });
    assert.equal(init.topics.kept, 148);
    await db.query("update topics set name = 'Admin renamed' where id = 'databricks/acid'");
    await seed(db, { mode: "init" });
    assert.equal((await q1(db, "select name from topics where id = 'databricks/acid'"))[0].name, "Admin renamed", "init keeps admin edits");
    const force = await seed(db, { mode: "force" });
    assert.equal(force.topics.unchanged, 148, "snapshots unchanged, so nothing re-versioned");
    assert.equal(await count(db, "select count(*) from content_versions"), before);
    await db.end();
  });
});

describe("progress functions", () => {
  let db, u, other;
  const T = "databricks/acid"; // 4 subtopics, min_level 1
  before(async () => {
    db = await cluster.freshDb();
    u = await createUser(db, "prog@example.com"); await onboard(db, u, 1);
    other = await createUser(db, "other@example.com"); await onboard(db, other, 1);
  });
  after(() => db.end());
  const call = (uid, sql, args) => as(db, uid, d => q1(d, sql, args)).then(r => Object.values(r[0])[0]);

  test("ticking subtopics drives the topic status both ways", async () => {
    const subs = (await q1(db, "select id from subtopics where topic_id = $1 order by sort_order", [T])).map(r => r.id);
    assert.equal(subs.length, 4);
    let r = await call(u, "select public.set_subtopic_done($1, true)", [subs[0]]);
    assert.deepEqual([r.status, r.subtopics_done, r.subtopics_total], [1, 1, 4]);
    for (const id of subs.slice(1)) r = await call(u, "select public.set_subtopic_done($1, true)", [id]);
    assert.equal(r.status, 2);
    const [p] = await q1(db, "select done_at, first_done_at from topic_progress where user_id = $1 and topic_id = $2", [u, T]);
    assert.ok(p.done_at && p.first_done_at);
    r = await call(u, "select public.set_subtopic_done($1, false)", [subs[3]]);
    assert.equal(r.status, 1, "unticking one drops back to in progress");
    const [p2] = await q1(db, "select done_at, first_done_at from topic_progress where user_id = $1 and topic_id = $2", [u, T]);
    assert.equal(p2.done_at, null); assert.ok(p2.first_done_at, "first_done_at is kept for XP and history");
    for (const id of subs.slice(0, 3)) r = await call(u, "select public.set_subtopic_done($1, false)", [id]);
    assert.equal(r.status, 0);
  });

  test("manual status works and is validated", async () => {
    assert.equal((await call(u, "select public.set_topic_status($1, 2::smallint)", [T])).status, 2);
    await assert.rejects(as(db, u, d => d.query("select public.set_topic_status($1, 5::smallint)", [T])), /invalid status/);
  });

  test("progress can't be recorded on topics above the caller's level or for other users", async () => {
    await denied(as(db, u, d => d.query("select public.set_topic_status('databricks/governance', 2::smallint)")), /not available/);
    await denied(as(db, u, d => d.query("select public.set_subtopic_done('databricks/liquid-clustering#clustering-keys', true)")), /not available/);
    await denied(as(db, u, d => d.query("select public.set_topic_status('databricks/does-not-exist', 1::smallint)")), /not available/);
    assert.equal(await count(db, "select count(*) from topic_progress where user_id = $1", [other]), 0, "only the caller's rows change");
  });
});
