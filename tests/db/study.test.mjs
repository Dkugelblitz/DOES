// Study timer and insights (real Postgres 16 + Supabase shim).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startCluster, createUser, as, onboard } from "./harness.mjs";

let cluster, db, u, other;
before(async () => {
  cluster = await startCluster();
  db = await cluster.freshDb();
  u = await createUser(db, "studier@example.com"); await onboard(db, u, 1); // timezone Asia/Kolkata
  other = await createUser(db, "other@example.com"); await onboard(db, other, 1);
});
after(async () => { await db?.end(); await cluster?.stop(); });

const q1 = async (sql, args) => (await db.query(sql, args)).rows;
const call = (uid, sql, args) => as(db, uid, d => d.query(sql, args)).then(r => Object.values(r.rows[0])[0]);
const running = uid => q1("select * from study_sessions where user_id = $1 and status = 'running'", [uid]).then(r => r[0]);
// Move the running session back in time, as if it started `mins` minutes ago with a heartbeat `seen` minutes ago.
const age = (uid, mins, seen = 0) => db.query(
  "update study_sessions set started_at = now() - make_interval(mins => $2), last_seen_at = now() - make_interval(mins => $3) where user_id = $1 and status = 'running'",
  [uid, mins, seen]);

describe("timer", () => {
  test("start is idempotent and stop credits whole minutes to today and totals", async () => {
    const s1 = await call(u, "select public.start_study_session(null)");
    const s2 = await call(u, "select public.start_study_session(null)");
    assert.equal(s1.running.id, s2.running.id, "a second start returns the same running session");
    await age(u, 25);
    const r = await call(u, "select public.stop_study_session()");
    assert.equal(r.saved_minutes, 25); assert.equal(r.running, null); assert.equal(r.today_minutes, 25);
    const [st] = await q1("select study_minutes from user_stats where user_id = $1", [u]);
    assert.equal(st.study_minutes, 25);
  });

  test("sessions under a minute are discarded", async () => {
    await call(u, "select public.start_study_session(null)");
    const r = await call(u, "select public.stop_study_session()");
    assert.equal(r.saved_minutes, 0);
    assert.equal((await q1("select count(*)::int n from study_sessions where user_id = $1", [u]))[0].n, 1);
  });

  test("a session that goes quiet is saved up to its last heartbeat", async () => {
    await call(u, "select public.start_study_session('databricks/acid')");
    await age(u, 50, 20); // started 50 min ago, last heartbeat 20 min ago (tab closed)
    const s = await call(u, "select public.study_state()");
    assert.equal(s.running, null, "closed automatically");
    const [last] = await q1("select minutes, topic_id from study_sessions where user_id = $1 and topic_id = 'databricks/acid'", [u]);
    assert.equal(last.minutes, 30, "only the 30 minutes before the tab closed count");
    assert.equal(last.topic_id, "databricks/acid");
  });

  test("a heartbeat keeps a session alive and reports auto-saved time", async () => {
    await call(u, "select public.start_study_session(null)");
    await age(u, 10, 3);
    const h = await call(u, "select public.heartbeat_study_session()");
    assert.ok(h.running, "still running after a 3-minute gap"); assert.equal(h.auto_saved_minutes, 0);
    await age(u, 30, 12);
    const h2 = await call(u, "select public.heartbeat_study_session()");
    assert.equal(h2.running, null); assert.equal(h2.auto_saved_minutes, 18);
  });

  test("long sessions roll over every 240 minutes so nothing is lost", async () => {
    await call(u, "select public.start_study_session(null)");
    await age(u, 250, 0);
    const h = await call(u, "select public.heartbeat_study_session()");
    assert.ok(h.running);
    const [banked] = await q1("select count(*)::int n from study_sessions where user_id = $1 and status = 'closed' and minutes = 240", [u]);
    assert.equal(banked.n, 1, "240 minutes banked in a closed session");
    const r = await call(u, "select public.stop_study_session()");
    assert.equal(r.saved_minutes, 10);
  });

  test("you can't time a topic above your level, and nobody can stop someone else's session", async () => {
    await assert.rejects(as(db, u, d => d.query("select public.start_study_session('databricks/governance')")), /not available/);
    await call(other, "select public.start_study_session(null)");
    await age(other, 15);
    await call(u, "select public.stop_study_session()");
    assert.ok(await running(other), "the other user's session is untouched");
    await assert.rejects(as(db, u, d => d.query("update study_sessions set minutes = 999")), /permission denied/);
  });
});

describe("insights", () => {
  test("minutes per local day, time-of-day buckets and averages", async () => {
    const fresh = await createUser(db, "insight@example.com"); await onboard(db, fresh, 1); // Asia/Kolkata
    // 20:00 UTC is 01:30 the next morning in Kolkata: that's "night" and counts on the Kolkata day.
    await db.query(`insert into study_sessions (user_id, started_at, ended_at, last_seen_at, minutes, status) values
      ($1, date_trunc('day', now()) - interval '1 day' + interval '20 hours', date_trunc('day', now()) - interval '1 day' + interval '20 hours 40 minutes', now(), 40, 'closed'),
      ($1, date_trunc('day', now()) - interval '3 days' + interval '4 hours', date_trunc('day', now()) - interval '3 days' + interval '4 hours 20 minutes', now(), 20, 'closed')`, [fresh]);
    const i = await call(fresh, "select public.my_insights()");
    assert.equal(i.timezone, "Asia/Kolkata");
    assert.equal(i.days.length, 7);
    assert.equal(i.sessions, 2); assert.equal(i.total_minutes, 60); assert.equal(i.avg_minutes, 30); assert.equal(i.longest_minutes, 40);
    assert.equal(i.buckets.night, 40, "01:30 Kolkata is night"); assert.equal(i.buckets.morning, 20, "09:30 Kolkata is morning");
    assert.equal(i.recent.length, 2);
  });
});
