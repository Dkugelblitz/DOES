// XP, streaks and badges (real Postgres 16 + Supabase shim).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startCluster, createUser, as, onboard } from "./harness.mjs";

let cluster, db;
before(async () => { cluster = await startCluster(); db = await cluster.freshDb(); });
after(async () => { await db?.end(); await cluster?.stop(); });

const q1 = async (sql, args) => (await db.query(sql, args)).rows;
const game = uid => as(db, uid, d => d.query("select public.my_game() g")).then(r => r.rows[0].g);
const run = (uid, sql, args) => as(db, uid, d => d.query(sql, args));
const xpOf = async uid => (await game(uid)).xp;
const newUser = async (email, level = 1) => { const id = await createUser(db, email); await onboard(db, id, level); return id; };
const T = "databricks/acid", T2 = "databricks/vacuum";

describe("XP", () => {
  test("topic done = 30 XP, once per topic for life", async () => {
    const u = await newUser("done@example.com");
    await run(u, "select public.set_topic_status($1, 2::smallint)", [T]);
    assert.equal(await xpOf(u), 30);
    for (const s of [0, 1, 2, 0, 2]) await run(u, "select public.set_topic_status($1, $2::smallint)", [T, s]);
    assert.equal(await xpOf(u), 30, "toggling done off and on again earns nothing more");
    for (const id of (await q1("select id from subtopics where topic_id = $1", [T2]))) await run(u, "select public.set_subtopic_done($1, true)", [id.id]);
    assert.equal(await xpOf(u), 60, "finishing via subtopics counts too");
  });

  test("note = 5 XP once per topic, only with 20+ characters", async () => {
    const u = await newUser("notes@example.com");
    await run(u, "select public.save_note($1, 'too short')", [T]);
    assert.equal(await xpOf(u), 0);
    for (let i = 0; i < 4; i++) await run(u, "select public.save_note($1, $2)", [T, `A proper note about ACID transactions, edit ${i}`]);
    assert.equal(await xpOf(u), 5, "re-saving doesn't add XP");
    await run(u, "select public.save_note($1, '')", [T]);
    await run(u, "select public.save_note($1, 'Writing the same note again from scratch')", [T]);
    assert.equal(await xpOf(u), 5, "deleting and rewriting doesn't add XP");
  });

  test("attachment = 5 XP once per topic", async () => {
    const u = await newUser("files@example.com");
    for (let i = 0; i < 3; i++)
      await run(u, "insert into attachments (user_id, topic_id, storage_path, mime_type, bytes, original_name) values ($1, $2, $3, 'image/png', 100, 'x.png')", [u, T, `${u}/${i}.png`]);
    await run(u, "delete from attachments where user_id = $1", [u]);
    await run(u, "insert into attachments (user_id, topic_id, storage_path, mime_type, bytes, original_name) values ($1, $2, $3, 'image/png', 100, 'x.png')", [u, T, `${u}/again.png`]);
    assert.equal(await xpOf(u), 5);
  });

  test("study minutes = 1 XP each, credited once per session", async () => {
    const u = await newUser("study@example.com");
    await run(u, "select public.start_study_session(null)");
    await db.query("update study_sessions set started_at = now() - interval '25 minutes', last_seen_at = now() where user_id = $1", [u]);
    await run(u, "select public.stop_study_session()");
    await run(u, "select public.stop_study_session()");
    const g = await game(u);
    assert.equal(g.xp, 25); assert.equal(g.stats.study_minutes, 25, "minutes are not double counted");
  });

  test("revision = 10 XP only when due, once per cycle", async () => {
    const u = await newUser("rev@example.com");
    await run(u, "select public.set_topic_status($1, 2::smallint)", [T]);
    await run(u, "select public.mark_revised($1)", [T]);
    assert.equal(await xpOf(u), 30, "early revision earns nothing");
    await db.query("update topic_progress set done_at = now() - interval '12 days', last_revised_at = now() - interval '6 days' where user_id = $1", [u]);
    await run(u, "select public.mark_revised($1)", [T]);
    await run(u, "select public.mark_revised($1)", [T]);
    const g = await game(u);
    assert.equal(g.xp, 40); assert.equal(g.stats.revisions, 1);
  });

  test("users can't write XP, badges or stats themselves", async () => {
    const u = await newUser("cheat@example.com");
    await assert.rejects(run(u, "insert into xp_events (user_id, kind, points, idempotency_key) values ($1, 'topic_done', 9999, 'x')", [u]), /permission denied/);
    await assert.rejects(run(u, "insert into user_badges (user_id, badge_id) values ($1, 'pareto-pro')", [u]), /permission denied/);
    await assert.rejects(run(u, "update user_stats set xp = 9999 where user_id = $1", [u]), /permission denied/);
    await assert.rejects(run(u, "select private.award_xp($1, 'topic_done', 'k', 100, '{}')", [u]), /permission denied/);
  });

  test("XP and level are global across levels", async () => {
    const u = await newUser("multi@example.com", 1);
    await run(u, "select public.set_topic_status($1, 2::smallint)", [T]);
    await db.query("insert into level_grants (user_id, level, source) values ($1, 3, 'admin')", [u]);
    await run(u, "select public.set_active_level(3::smallint)");
    const g = await game(u);
    assert.equal(g.xp, 30); assert.equal(g.level, 1);
    await run(u, "select public.set_topic_status('databricks/governance', 2::smallint)");
    assert.equal(await xpOf(u), 60);
  });
});

describe("levels, streaks and badges", () => {
  test("level and title come from the data", async () => {
    const u = await newUser("lvl@example.com");
    const ids = (await q1("select id from topics where min_level = 1 order by id limit 6")).map(r => r.id);
    for (const id of ids) await run(u, "select public.set_topic_status($1, 2::smallint)", [id]);
    const g = await game(u); // 180 XP
    assert.equal(g.xp, 180); assert.equal(g.level, 3); assert.equal(g.title, "Lakehouse Engineer");
    assert.equal(g.level_floor_xp, 160); assert.equal(g.next_level_xp, 360); assert.equal(g.next_title, "Spark Tamer");
  });

  test("streaks count consecutive local days; today is optional until it ends", async () => {
    const u = await newUser("streak@example.com"); // Asia/Kolkata
    const today = (await q1("select (now() at time zone 'Asia/Kolkata')::date d"))[0].d;
    const add = n => db.query("insert into activity_days (user_id, day, events) values ($1, $2::date - $3::int, 1) on conflict do nothing", [u, today, n]);
    for (const n of [1, 2, 3]) await add(n);   // yesterday and the two days before
    let g = await game(u);
    assert.equal(g.streak, 3, "still alive without activity today"); assert.equal(g.active_today, false);
    await add(0);
    g = await game(u);
    assert.equal(g.streak, 4); assert.equal(g.active_today, true);
    assert.ok(g.badges.find(b => b.id === "3-day-streak").earned_at, "3-day streak badge awarded");
    await db.query("delete from activity_days where user_id = $1 and day >= $2::date - 1", [u, today]);
    g = await game(u);
    assert.equal(g.streak, 0, "a missed day ends the current streak"); assert.equal(g.longest_streak, 4, "longest is remembered");
    assert.ok(g.badges.find(b => b.id === "3-day-streak").earned_at, "badges are never taken away");
  });

  test("first topic, night owl and Pareto Pro badges", async () => {
    const u = await newUser("badges@example.com");
    await run(u, "select public.set_topic_status($1, 2::smallint)", [T]);
    let g = await game(u);
    assert.ok(g.badges.find(b => b.id === "first-topic").earned_at);
    assert.ok(!g.badges.find(b => b.id === "night-owl").earned_at);
    // A 30-minute session starting 23:00 Kolkata (17:30 UTC).
    await db.query(`insert into study_sessions (user_id, started_at, last_seen_at, status) values ($1, date_trunc('day', now()) - interval '1 day' + interval '17 hours 30 minutes', now(), 'running')`, [u]);
    await db.query("select private.close_session(id, started_at + interval '30 minutes') from study_sessions where user_id = $1 and status = 'running'", [u]);
    g = await game(u);
    assert.ok(g.badges.find(b => b.id === "night-owl").earned_at, "night owl from a 23:00 local session");
    assert.ok(!g.badges.find(b => b.id === "early-bird").earned_at);
    const core = (await as(db, u, d => d.query("select topic_id from public.pareto_topics(1::smallint)"))).rows.map(r => r.topic_id);
    for (const id of core) await run(u, "select public.set_topic_status($1, 2::smallint)", [id]);
    g = await game(u);
    assert.ok(g.badges.find(b => b.id === "pareto-pro").earned_at, "all 15 level-1 core topics done");
  });
});

describe("backfill of activity from before XP existed", () => {
  test("the migration's backfill awards XP once for past work and is safe to re-run", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../supabase/migrations/20261109000006_gamification.sql", import.meta.url), "utf8");
    const block = sql.slice(sql.indexOf("do $$\ndeclare u record; r record;"), sql.indexOf("end $$;", sql.indexOf("do $$\ndeclare u record; r record;")) + 7);
    assert.ok(block.startsWith("do $$") && block.includes("award_xp"), "found the backfill block");
    const u = await newUser("legacy@example.com");
    const triggers = [["topic_progress", "game_topic_progress"], ["notes", "game_note"], ["study_sessions", "game_session"]];
    for (const [t, g] of triggers) await db.query(`alter table ${t} disable trigger ${g}`);
    await run(u, "select public.set_topic_status($1, 2::smallint)", [T]);
    await run(u, "select public.save_note($1, 'Old note written before XP existed, long enough')", [T]);
    await db.query(`insert into study_sessions (user_id, started_at, ended_at, last_seen_at, minutes, status) values ($1, now() - interval '2 days', now() - interval '2 days' + interval '40 minutes', now(), 40, 'closed')`, [u]);
    for (const [t, g] of triggers) await db.query(`alter table ${t} enable trigger ${g}`);
    assert.equal(Number((await q1("select count(*) from xp_events where user_id = $1", [u]))[0].count), 0, "nothing awarded yet");
    await db.query(block);
    await db.query(block);
    const g = await game(u);
    assert.equal(g.xp, 30 + 5 + 40, "topic + note + 40 study minutes, once each");
    assert.ok(g.badges.find(b => b.id === "first-topic").earned_at);
  });
});
