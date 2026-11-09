import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { fill, greeting, localHour, pick, timeOfDay } from "../src/lib/messages.ts";

const m = YAML.parse(readFileSync(new URL("../content/messages.yaml", import.meta.url), "utf8"));

test("templates fill and time of day follows the user's hour", () => {
  assert.equal(fill("Hi {name}, {n} left {missing}", { name: "Asha", n: 3 }), "Hi Asha, 3 left ");
  assert.equal(timeOfDay(m, 7), "Good morning"); assert.equal(timeOfDay(m, 13), "Good afternoon"); assert.equal(timeOfDay(m, 21), "Good evening");
  assert.equal(localHour(new Date("2026-11-09T20:00:00Z"), "Asia/Kolkata"), 1);
  assert.equal(localHour(new Date("2026-11-09T20:00:00Z"), "Bad/Zone"), 20);
  assert.equal(pick(["a", "b", "c"], 0.99), "c"); assert.equal(pick([], 0.5), undefined);
});

test("greeting is personal and never guilt-inducing", () => {
  const g = greeting(m, { name: "Asha Rao", hour: 8, streak: 4, dueCount: 2, nextTopic: "MERGE (SCD1/SCD2, CDC)", levelName: "Data Engineer" });
  assert.equal(g.headline, "Good morning, Asha! 👋");
  assert.deepEqual(g.lines, [
    "You’re on a 4-day streak. Let’s keep it going.",
    "🔁 2 topics are due for revision (5–7 day rule). A quick review locks them in.",
    "Suggested next: MERGE (SCD1/SCD2, CDC). One focused hour is plenty.",
  ]);
  assert.equal(g.footer, "You’re preparing as a Data Engineer. You’ve got this.");
  const fresh = greeting(m, { name: null, hour: 15, streak: 0, dueCount: 0, nextTopic: null, levelName: "Data Architect" });
  assert.equal(fresh.headline, "Good afternoon! 👋");
  assert.equal(fresh.lines[0], "Today is a great day to start a streak.");
  for (const line of [...g.lines, ...fresh.lines, ...m.topic_done_cheers, ...m.closing.farewells])
    assert.ok(!/\b(lazy|failed|behind|missed|shame|disappoint)/i.test(line), line);
});
