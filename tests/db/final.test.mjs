// Milestone 10: game deltas, next topic, analytics, content editing and custom topics.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startCluster, createUser, as, asService, onboard } from "./harness.mjs";

let cluster, db, admin, u, v;
before(async () => {
  cluster = await startCluster();
  db = await cluster.freshDb();
  admin = await createUser(db, "root@example.com"); await onboard(db, admin, 3);
  await asService(db, d => d.query("select public.bootstrap_admins(array['root@example.com'])"));
  u = await createUser(db, "learner@example.com"); await onboard(db, u, 1);
  v = await createUser(db, "peer@example.com"); await onboard(db, v, 1);
});
after(async () => { await db?.end(); await cluster?.stop(); });

const q1 = async (sql, args) => (await db.query(sql, args)).rows;
const call = (uid, sql, args) => as(db, uid, d => d.query(sql, args)).then(r => Object.values(r.rows[0])[0]);
const audits = async () => Number((await q1("select count(*) from admin_audit_log"))[0].count);

describe("encouragement data", () => {
  test("finishing a topic reports XP gained and new badges", async () => {
    const r = await call(u, "select public.set_topic_status('databricks/acid', 2::smallint)");
    assert.equal(r.game.xp_before, 0); assert.equal(r.game.xp_after, 30);
    assert.deepEqual(r.game.new_badges.map(b => b.id), ["first-topic"]);
    const again = await call(u, "select public.set_topic_status('databricks/acid', 2::smallint)");
    assert.equal(again.game.xp_after - again.game.xp_before, 0); assert.deepEqual(again.game.new_badges, []);
    const sub = (await q1("select id from subtopics where topic_id = 'databricks/vacuum' order by sort_order")).map(r => r.id);
    let last; for (const id of sub) last = await call(u, "select public.set_subtopic_done($1, true)", [id]);
    assert.equal(last.status, 2); assert.equal(last.game.xp_after - last.game.xp_before, 30, "the subtopic that completes a topic reports the XP");
  });

  test("next suggested topic prefers the Pareto core, and refuses unheld levels", async () => {
    const n = await call(u, "select public.my_next_topic(1::smallint)");
    assert.equal(n.core, true);
    assert.ok((await q1("select 1 from topics where id = $1 and 1 = any(pareto_levels)", [n.topic_id])).length);
    await assert.rejects(as(db, u, d => d.query("select public.my_next_topic(2::smallint)")), /not granted/);
  });
});

describe("admin analytics", () => {
  test("aggregates only, admins only", async () => {
    await as(db, u, d => d.query("select public.save_note('databricks/acid', 'SECRET-NOTE-TEXT about ACID')"));
    await as(db, u, d => d.query("insert into bookmarks (user_id, topic_id) values ($1, 'databricks/acid')", [u]));
    await as(db, v, d => d.query("insert into bookmarks (user_id, topic_id) values ($1, 'databricks/acid')", [v]));
    const a = await call(admin, "select public.admin_analytics()");
    assert.equal(a.weeks.length, 8);
    assert.ok(a.weeks.at(-1).active_users >= 1);
    assert.equal(a.most_bookmarked[0].topic_id, "databricks/acid"); assert.equal(a.most_bookmarked[0].n, 2);
    assert.equal(a.least_completed.length, 10);
    assert.equal(a.level_distribution.length, 3);
    assert.ok(!JSON.stringify(a).includes("SECRET-NOTE-TEXT"));
    await assert.rejects(as(db, u, d => d.query("select public.admin_analytics()")), /admin only/);
  });
});

describe("content editing", () => {
  test("editing a topic versions it, audits it, and keeps people's subtopic ticks", async () => {
    const tick = (await q1("select id from subtopics where topic_id = 'databricks/acid' and slug = 'atomicity'"))[0].id;
    await as(db, u, d => d.query("select public.set_subtopic_done($1, true)", [tick]));
    const n = await audits();
    const r = await call(admin, "select public.admin_save_topic($1::jsonb)", [JSON.stringify({ id: "databricks/acid", name: "ACID guarantees", min_level: 1, pareto_levels: [1, 2], subtopics: ["Durability", "Atomicity", "Isolation"] })]);
    assert.equal(r.name, "ACID guarantees"); assert.deepEqual(r.pareto_levels, [1, 2]);
    assert.deepEqual(r.subtopics.map(s => s.name), ["Durability", "Atomicity", "Isolation"]);
    assert.equal((await q1("select archived_at is not null a from subtopics where topic_id = 'databricks/acid' and slug = 'consistency'"))[0].a, true, "removed subtopic archived, not deleted");
    assert.equal((await q1("select count(*)::int n from subtopic_progress where subtopic_id = $1", [tick]))[0].n, 1, "ticks kept");
    assert.equal(await audits(), n + 1);
    const vers = await q1("select version from content_versions where entity_type = 'topic' and entity_id = 'databricks/acid' order by version");
    assert.deepEqual(vers.map(x => x.version), [1, 2]);
    // Learners see the new name; Pareto now includes level 2.
    assert.equal((await as(db, u, d => d.query("select name from topics where id = 'databricks/acid'"))).rows[0].name, "ACID guarantees");
  });

  test("the editor can read archived items and Pareto flags; learners can't", async () => {
    const t = await call(admin, "select public.admin_content('topic', 'databricks/acid')");
    assert.ok(Array.isArray(t.pareto_levels) && t.modules.length >= 1);
    const list = await call(admin, "select public.admin_content('topics', 'databricks')");
    assert.equal(list.length, 44);
    await assert.rejects(as(db, u, d => d.query("select public.admin_content('topics', null)")), /admin only/);
  });

  test("invalid edits are refused", async () => {
    await assert.rejects(as(db, admin, d => d.query("select public.admin_save_topic($1::jsonb)", [JSON.stringify({ id: "databricks/acid", min_level: 3, pareto_levels: [1] })])), /check constraint/);
    await assert.rejects(as(db, admin, d => d.query("select public.admin_save_document('hackerrank', '{\"sections\": []}'::jsonb)")), /sections/);
    await assert.rejects(as(db, admin, d => d.query("select public.admin_save_document('gamification', '{\"xp\": {}}'::jsonb)")), /points/);
    await assert.rejects(as(db, admin, d => d.query("select public.admin_save_document('nope', '{}'::jsonb)")), /unknown document/);
    await assert.rejects(as(db, admin, d => d.query("select public.admin_save_card('{\"deck\":\"x\",\"question\":\"q\",\"answer\":\"a\",\"topic_id\":\"nope/nope\"}'::jsonb)")), /existing topic/);
  });

  test("restoring an old version makes a new version and is audited", async () => {
    const n = await audits();
    const r = await call(admin, "select public.admin_restore_version('topic', 'databricks/acid', 1)");
    assert.equal(r.name, "ACID"); assert.deepEqual(r.pareto_levels, []);
    assert.deepEqual(r.subtopics.map(s => s.name), ["Atomicity", "Consistency", "Isolation", "Durability"]);
    const vers = await q1("select version from content_versions where entity_type = 'topic' and entity_id = 'databricks/acid' order by version");
    assert.deepEqual(vers.map(x => x.version), [1, 2, 3], "history is never rewritten");
    assert.deepEqual((await q1("select action from admin_audit_log order by id desc limit 2")).map(x => x.action).sort(), ["content_edit", "content_restore"]);
    assert.equal(await audits(), n + 2);
  });

  test("new cards and designs, archiving, and HackerRank document edits", async () => {
    const c = await call(admin, "select public.admin_save_card($1::jsonb)", [JSON.stringify({ deck: "SQL", question: "What is a semi-join?", answer: "EXISTS: returns left rows with a match, without duplicates.", topic_id: "sql-coding/joins-all-types-self-joins" })]);
    assert.ok(c.id.startsWith("sql-what-is-a-semi-join"));
    assert.equal((await as(db, u, d => d.query("select count(*)::int n from cards where id = $1", [c.id]))).rows[0].n, 1, "level-1 learners see it (inherits topic level)");
    await call(admin, "select public.admin_save_card($1::jsonb)", [JSON.stringify({ ...c, archived: true })]);
    assert.equal((await as(db, u, d => d.query("select count(*)::int n from cards where id = $1", [c.id]))).rows[0].n, 0, "archived cards disappear");
    const d = await call(admin, "select public.admin_save_design($1::jsonb)", [JSON.stringify({ title: "Feature store design", min_level: 3, points: ["Offline and online stores"], topic_ids: ["architecture/feature-store-ml-platform"] })]);
    assert.equal((await as(db, u, x => x.query("select count(*)::int n from designs where id = $1", [d.id]))).rows[0].n, 0, "level-3 design hidden from level 1");
    const hr = (await q1("select data from content_documents where key = 'hackerrank'"))[0].data;
    hr.sections.push({ id: "new-round", title: "New round type", body: "Pair-programming with an AI agent." });
    await call(admin, "select public.admin_save_document('hackerrank', $1::jsonb)", [JSON.stringify(hr)]);
    const seen = (await as(db, u, x => x.query("select data from content_documents where key = 'hackerrank'"))).rows[0].data;
    assert.equal(seen.sections.at(-1).title, "New round type");
  });

  test("editing badge rules in the gamification document updates the badges", async () => {
    const g = (await q1("select data from content_documents where key = 'gamification'"))[0].data;
    const doneNow = Number((await q1("select count(*) from topic_progress where user_id = $1 and status = 2", [u]))[0].count);
    assert.ok(doneNow >= 1);
    g.badges.find(b => b.id === "10-topics").rule.gte = doneNow;
    g.xp.topic_done.points = 50;
    await call(admin, "select public.admin_save_document('gamification', $1::jsonb)", [JSON.stringify(g)]);
    assert.equal((await q1("select rule ->> 'gte' g from badges where id = '10-topics'"))[0].g, String(doneNow));
    const game = await call(u, "select public.my_game()");
    assert.ok(game.badges.find(b => b.id === "10-topics").earned_at, "the topics already done now meet the edited rule");
    const r = await call(u, "select public.set_topic_status('databricks/time-travel', 2::smallint)");
    assert.equal(r.game.xp_after - r.game.xp_before, 50, "new points apply to new actions");
  });
});

describe("custom topics", () => {
  test("private to their owner, behave like normal topics, and can't farm XP", async () => {
    const { topic_id } = await call(u, "select public.create_custom_topic('databricks', 'Photon internals', array['Vectorised engine', 'When it helps'])");
    assert.match(topic_id, /^databricks\/my-[0-9a-f]{10}$/);
    assert.equal((await as(db, u, d => d.query("select count(*)::int n from topics where id = $1", [topic_id]))).rows[0].n, 1);
    assert.equal((await as(db, v, d => d.query("select count(*)::int n from topics where id = $1", [topic_id]))).rows[0].n, 0, "other users can't see it");
    assert.equal((await as(db, admin, d => d.query("select count(*)::int n from topics where id = $1", [topic_id]))).rows[0].n, 0, "admins can't see it either");
    await assert.rejects(as(db, v, d => d.query("select public.set_topic_status($1, 2::smallint)", [topic_id])), /not available/);
    const before = (await call(u, "select public.my_game()")).xp;
    await call(u, "select public.set_topic_status($1, 2::smallint)", [topic_id]);
    await as(db, u, d => d.query("select public.save_note($1, 'Notes about Photon vectorised execution')", [topic_id]));
    assert.ok((await call(u, "select public.my_game()")).xp > before);
    await assert.rejects(as(db, v, d => d.query("select public.delete_custom_topic($1)", [topic_id])), /not found/);
    await as(db, u, d => d.query("select public.delete_custom_topic($1)", [topic_id]));
    assert.equal((await call(u, "select public.my_game()")).xp, before, "deleting it removes the XP it earned");
    await assert.rejects(as(db, u, d => d.query("select public.create_custom_topic('databricks', '   ', null)")), /name/);
    await assert.rejects(as(db, u, d => d.query("insert into topics (id, domain_slug, module_slug, slug, name, owner_id) values ('databricks/x', 'databricks', 'my-topics', 'x', 'x', $1)", [u])), /permission denied/);
  });
});
