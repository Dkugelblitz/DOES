import { test } from "node:test";
import assert from "node:assert/strict";
import { revisionState } from "../src/lib/revision.ts";
import { buildReminder } from "../src/lib/reminders/email.ts";
import { unsubscribeToken, unsubscribeUrl, verifyUnsubscribe } from "../src/lib/reminders/token.ts";

const now = new Date("2026-11-09T12:00:00Z");
const daysAgo = (d) => new Date(now.getTime() - d * 86_400_000).toISOString();

test("revision state: fresh, due at 5, overdue at 7, reset by revising", () => {
  assert.equal(revisionState({ status: 1, doneAt: null, lastRevisedAt: null, now }).state, "not_done");
  assert.deepEqual(revisionState({ status: 2, doneAt: daysAgo(2), lastRevisedAt: null, now }), { state: "fresh", days: 2, dueInDays: 3 });
  assert.equal(revisionState({ status: 2, doneAt: daysAgo(5), lastRevisedAt: null, now }).state, "due");
  assert.equal(revisionState({ status: 2, doneAt: daysAgo(6.9), lastRevisedAt: null, now }).state, "due");
  assert.equal(revisionState({ status: 2, doneAt: daysAgo(7), lastRevisedAt: null, now }).state, "overdue");
  assert.equal(revisionState({ status: 2, doneAt: daysAgo(20), lastRevisedAt: daysAgo(1), now }).state, "fresh", "clock restarts at the last revision");
  assert.equal(revisionState({ status: 2, doneAt: daysAgo(4), lastRevisedAt: null, now, due: 3, overdue: 4 }).state, "overdue", "thresholds are configurable");
});

test("reminder email is warm, specific, escaped and has an unsubscribe link", () => {
  const r = buildReminder({
    name: "Asha <b>Rao</b>", dueCount: 7, siteUrl: "https://deosin.netlify.app/", unsubscribeUrl: "https://deosin.netlify.app/unsubscribe?u=x&t=y",
    topics: [{ topic_id: "databricks/vacuum", name: "VACUUM & <script>", days: 6, state: "due" }, { topic_id: "sql-coding/sessionization", name: "Sessionization", days: 9, state: "overdue" }],
  });
  assert.equal(r.subject, "7 topics are ready for a quick review");
  assert.match(r.text, /^Hi Asha,/);
  assert.match(r.text, /…and 5 more/);
  assert.match(r.text, /Turn them off: https:\/\/deosin\.netlify\.app\/unsubscribe/);
  assert.ok(!r.html.includes("<script>") && r.html.includes("VACUUM &amp; &lt;script&gt;"), "names are escaped");
  assert.ok(r.html.includes('href="https://deosin.netlify.app/topics/databricks/vacuum"'));
  assert.ok(!/missed|behind|lazy|failed|overdue/i.test(r.text), "no guilt-inducing words");
  assert.equal(buildReminder({ name: null, dueCount: 1, topics: [], siteUrl: "x", unsubscribeUrl: "y" }).subject, "1 topic is ready for a quick review");
});

test("unsubscribe tokens verify only for the right user and secret", () => {
  const u = "0f8b6c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f", other = "1f8b6c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f";
  const t = unsubscribeToken(u, "s3cret");
  assert.equal(verifyUnsubscribe(u, t, "s3cret"), true);
  assert.equal(verifyUnsubscribe(other, t, "s3cret"), false);
  assert.equal(verifyUnsubscribe(u, t, "other-secret"), false);
  assert.equal(verifyUnsubscribe(u, "short", "s3cret"), false);
  assert.equal(verifyUnsubscribe(u, t, ""), false);
  assert.equal(unsubscribeUrl("https://x.app/", u, "s3cret"), `https://x.app/unsubscribe?u=${u}&t=${t}`);
});
