import { test } from "node:test";
import assert from "node:assert/strict";
import { readiness, eta, daysUntil, localDate } from "../src/lib/progress.ts";

test("readiness weights in-progress topics at 0.4", () => {
  const r = readiness([2, 2, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(r, { total: 10, done: 2, inProgress: 1, notStarted: 7, pct: 24 });
  assert.equal(readiness([]).pct, 0);
  assert.equal(readiness([2, 2]).pct, 100);
});

test("days to interview use the user's calendar day, not UTC", () => {
  // 20:00 UTC on 7 Nov is already 8 Nov in Kolkata (UTC+5:30).
  const now = new Date("2026-11-07T20:00:00Z");
  assert.equal(localDate(now, "Asia/Kolkata"), "2026-11-08");
  assert.equal(localDate(now, "UTC"), "2026-11-07");
  assert.equal(daysUntil("2026-11-10", now, "Asia/Kolkata"), 2);
  assert.equal(daysUntil("2026-11-10", now, "UTC"), 3);
  assert.equal(localDate(now, "Not/AZone"), "2026-11-07", "unknown zones fall back to UTC");
});

test("ETA and pace", () => {
  const now = new Date("2026-11-07T06:00:00Z");
  const r = readiness([...Array(8).fill(2), ...Array(2).fill(1), ...Array(10).fill(0)]); // 20 topics
  const base = { readiness: r, hoursPerTopic: 3, hoursPerDay: 2, now, timeZone: "Asia/Kolkata" };
  const noDate = eta(base);
  assert.equal(noDate.remainingTopics, 20 - 8 - 0.8);
  assert.ok(Math.abs(noDate.hoursRemaining - 33.6) < 1e-9);
  assert.equal(noDate.daysAtCurrentPace, 17);
  assert.equal(noDate.status, "no_date");

  const onTrack = eta({ ...base, interviewDate: "2026-11-27" }); // 20 days
  assert.equal(onTrack.daysToInterview, 20);
  assert.equal(onTrack.hoursPerDayNeeded, 1.7);
  assert.equal(onTrack.status, "on_track");

  const behind = eta({ ...base, interviewDate: "2026-11-12" }); // 5 days
  assert.equal(behind.hoursPerDayNeeded, 6.7);
  assert.equal(behind.status, "behind");

  assert.equal(eta({ ...base, interviewDate: "2026-11-07" }).status, "today");
  assert.equal(eta({ ...base, interviewDate: "2026-11-01" }).status, "passed");
  assert.equal(eta({ ...base, readiness: readiness([2, 2]) }).status, "complete");
});

test("hours per day can't drop below half an hour", () => {
  const r = readiness([0, 0]);
  assert.equal(eta({ readiness: r, hoursPerTopic: 1, hoursPerDay: 0 }).daysAtCurrentPace, 4);
});
