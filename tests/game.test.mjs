import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { describeRule, levelInfo } from "../src/lib/game.ts";

const g = YAML.parse(readFileSync(new URL("../content/gamification.yaml", import.meta.url), "utf8"));
const cfg = g.levels;

test("levels follow floor(sqrt(xp/40)) + 1, capped at 7, with titles", () => {
  const at = (xp) => levelInfo(xp, cfg);
  assert.deepEqual([0, 39, 40, 159, 160, 359, 360, 639, 640, 999, 1000, 1439, 1440, 99999].map((x) => at(x).level), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
  assert.equal(at(0).title, "Rookie");
  assert.equal(at(1440).title, "Architect Legend");
  assert.deepEqual([at(100).floorXp, at(100).nextXp, at(100).nextTitle], [40, 160, "Lakehouse Engineer"]);
  assert.equal(at(100).progress, 0.5);
  assert.equal(at(5000).nextXp, null); assert.equal(at(5000).progress, 1);
  assert.equal(at(-5).level, 1, "negative XP is treated as zero");
});

test("XP values in the content match the spec", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(g.xp).map(([k, v]) => [k, v.points])),
    { topic_done: 30, revision: 10, note: 5, attachment: 5, study_minute: 1 });
});

test("every badge rule has a readable description", () => {
  assert.equal(g.badges.length, 13);
  for (const b of g.badges) assert.notEqual(describeRule(b.rule), "A special achievement", b.id);
  assert.equal(describeRule({ type: "session_start_local_hour", from: 22, to: 4 }), "Start a study session between 10 pm and 4 am");
  assert.equal(describeRule({ type: "study_minutes", gte: 600 }), "Study for 10 hours in total");
});
