// Spaced revision, bookmarks and reminder batches (real Postgres 16 + Supabase shim).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startCluster, createUser, as, asService, onboard } from "./harness.mjs";

let cluster, db, u;
before(async () => {
  cluster = await startCluster();
  db = await cluster.freshDb();
  u = await createUser(db, "reviser@example.com"); await onboard(db, u, 1); // Asia/Kolkata
});
after(async () => { await db?.end(); await cluster?.stop(); });

const q1 = async (sql, args) => (await db.query(sql, args)).rows;
const call = (uid, sql, args) => as(db, uid, d => d.query(sql, args)).then(r => Object.values(r.rows[0])[0]);
const done = async (uid, topic, daysAgo) => {
  await as(db, uid, d => d.query("select public.set_topic_status($1, 2::smallint)", [topic]));
  await db.query("update topic_progress set done_at = now() - make_interval(days => $3), first_done_at = now() - make_interval(days => $3) where user_id = $1 and topic_id = $2", [uid, topic, daysAgo]);
};

describe("revision", () => {
  test("due at 5+ days, overdue at 7+, nothing before", async () => {
    await done(u, "databricks/acid", 2);
    await done(u, "databricks/vacuum", 5);
    await done(u, "databricks/time-travel", 9);
    const r = await call(u, "select public.revision_due()");
    assert.deepEqual(r.config, { due: 5, overdue: 7 });
    assert.deepEqual(r.topics.map(t => [t.topic_id, t.state, t.days]), [["databricks/time-travel", "overdue", 9], ["databricks/vacuum", "due", 5]]);
  });

  test("Revised resets the clock and records whether it was due", async () => {
    const r = await call(u, "select public.mark_revised('databricks/time-travel')");
    assert.equal(r.was_due, true); assert.equal(r.cycle, 1);
    const early = await call(u, "select public.mark_revised('databricks/acid')");
    assert.equal(early.was_due, false, "revising early is allowed but not counted as due");
    const due = await call(u, "select public.revision_due()");
    assert.deepEqual(due.topics.map(t => t.topic_id), ["databricks/vacuum"]);
    const [s] = await q1("select revisions from user_stats where user_id = $1", [u]);
    assert.equal(s.revisions, 1, "only due revisions count towards the stat");
    // The clock restarts from the revision, not from done_at.
    await db.query("update topic_progress set last_revised_at = now() - interval '6 days' where user_id = $1 and topic_id = 'databricks/time-travel'", [u]);
    assert.ok((await call(u, "select public.revision_due()")).topics.some(t => t.topic_id === "databricks/time-travel" && t.state === "due"));
  });

  test("can't revise a topic that isn't done, or one above your level", async () => {
    await assert.rejects(as(db, u, d => d.query("select public.mark_revised('databricks/schemas')")), /mark the topic done/);
    await assert.rejects(as(db, u, d => d.query("select public.mark_revised('databricks/governance')")), /not available/);
  });

  test("revoking a level drops its topics from the due list; regranting brings them back", async () => {
    await db.query("insert into level_grants (user_id, level, source) values ($1, 2, 'admin')", [u]);
    await done(u, "databricks/liquid-clustering", 8);
    assert.ok((await call(u, "select public.revision_due()")).topics.some(t => t.topic_id === "databricks/liquid-clustering"));
    await db.query("update level_grants set revoked_at = now() where user_id = $1 and level = 2", [u]);
    assert.ok(!(await call(u, "select public.revision_due()")).topics.some(t => t.topic_id === "databricks/liquid-clustering"));
    await db.query("insert into level_grants (user_id, level, source) values ($1, 2, 'admin')", [u]);
    assert.ok((await call(u, "select public.revision_due()")).topics.some(t => t.topic_id === "databricks/liquid-clustering"));
  });
});

describe("bookmarks", () => {
  test("star and unstar visible topics only", async () => {
    await as(db, u, d => d.query("insert into bookmarks (user_id, topic_id) values ($1, 'databricks/acid')", [u]));
    assert.equal((await q1("select count(*)::int n from bookmarks where user_id = $1", [u]))[0].n, 1);
    await assert.rejects(as(db, u, d => d.query("insert into bookmarks (user_id, topic_id) values ($1, 'databricks/governance')", [u])), /row-level security/);
    await as(db, u, d => d.query("delete from bookmarks where user_id = $1 and topic_id = 'databricks/acid'", [u]));
    assert.equal((await q1("select count(*)::int n from bookmarks where user_id = $1", [u]))[0].n, 0);
  });
});

describe("reminder batches", () => {
  const batch = (from, to) => asService(db, d => d.query("select public.reminder_batch(10, $1, $2) b", [from, to])).then(r => r.rows[0].b);
  const localHour = async () => Number((await q1("select extract(hour from now() at time zone 'Asia/Kolkata')::int h"))[0].h);

  test("only service role can build batches, mark them sent or unsubscribe someone", async () => {
    for (const sql of ["select public.reminder_batch(10, 0, 24)", "select public.mark_reminder_sent($1)", "select public.set_email_reminders_for($1, false)"])
      await assert.rejects(as(db, u, d => d.query(sql, sql.includes("$1") ? [u] : [])), /permission denied|service role only/);
  });

  test("includes opted-in users in their morning window, once per 20 hours", async () => {
    const h = await localHour();
    const b = await batch(h, h + 1);
    assert.equal(b.length, 1); assert.equal(b[0].email, "reviser@example.com");
    assert.ok(b[0].due_count >= 1 && b[0].topics.length <= 5);
    assert.equal((await batch((h + 3) % 24, ((h + 3) % 24) + 1)).length, 0, "outside the user's local window");
    await asService(db, d => d.query("select public.mark_reminder_sent($1)", [u]));
    assert.equal((await batch(h, h + 1)).length, 0, "not again within 20 hours");
    await db.query("update profiles set last_reminder_at = now() - interval '21 hours' where id = $1", [u]);
    assert.equal((await batch(h, h + 1)).length, 1);
  });

  test("opted-out, disabled and unverified users are never emailed", async () => {
    const h = await localHour();
    await asService(db, d => d.query("select public.set_email_reminders_for($1, false)", [u]));
    assert.equal((await batch(h, h + 1)).length, 0);
    await db.query("update profiles set email_reminders = true, disabled_at = now() where id = $1", [u]);
    assert.equal((await batch(h, h + 1)).length, 0);
    await db.query("update profiles set disabled_at = null where id = $1", [u]);
    await db.query("update auth.users set email_confirmed_at = null where id = $1", [u]);
    assert.equal((await batch(h, h + 1)).length, 0);
    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [u]);
    assert.equal((await batch(h, h + 1)).length, 1);
  });
});
