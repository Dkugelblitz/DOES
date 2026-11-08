import { test } from "node:test";
import assert from "node:assert/strict";
import { loadContent, validate, visibleTopics, paretoTopics, effectiveCardLevel } from "../scripts/validate-seed.mjs";
import { D } from "../scripts/legacy/dashboard.mjs";
import { CARDS, DES, PLAN, HR } from "../scripts/legacy/sprint.mjs";
import { ADDITIONS } from "../scripts/legacy/flags.mjs";

const c = loadContent();
const clone = x => structuredClone(x);

test("seed content passes validation", () => {
  const { errors } = validate(c);
  assert.deepEqual(errors, []);
});

test("every dashboard topic and subtopic is preserved verbatim", () => {
  const byName = new Map(c.topics.map(t => [`${t.domain}|${t.name}`, t]));
  let n = 0;
  for (const [dName, dv] of Object.entries(D)) for (const list of Object.values(dv.m)) for (const raw of list) {
    const [name, subs] = raw.split("|"); n++;
    const dSlug = c.domains.domains.find(d => d.name === dName).slug;
    const t = byName.get(`${dSlug}|${name}`);
    assert.ok(t, `missing ${dName}|${name}`);
    assert.deepEqual(t.subtopics.map(s => s.name), subs ? subs.split(";") : []);
  }
  assert.equal(n, 145);
  assert.equal(c.topics.length, 145 + ADDITIONS.length);
});

test("Databricks keeps the user's original four modules", () => {
  const db = c.domains.domains.find(d => d.slug === "databricks");
  assert.deepEqual(db.modules.map(m => m.name), ["Delta Lake", "Unity Catalog", "Ingestion", "Databricks Platform"]);
  assert.ok(!c.topics.some(t => t.domain === "databricks" && t.provenance.added_from_academy));
});

test("cards, designs, sprint and HackerRank text is preserved", () => {
  assert.deepEqual(c.cards.cards.map(x => [x.deck, x.question, x.answer]), CARDS);
  assert.deepEqual(c.designs.designs.map(x => [x.title, x.points]), DES);
  assert.deepEqual(c.sprint.days.map(d => d.blocks.map(b => b.items.map(i => i.text))), PLAN.map(d => d.b.map(b => b[2])));
  assert.deepEqual(c.hackerrank.sections.map(s => [s.title, s.body]), HR);
});

test("roadmaps nest and Pareto is a subset of each roadmap", () => {
  const v = [1, 2, 3].map(l => new Set(visibleTopics(c.topics, l).map(t => t.id)));
  for (const id of v[0]) assert.ok(v[1].has(id));
  for (const id of v[1]) assert.ok(v[2].has(id));
  for (const l of [1, 2, 3]) {
    const p = paretoTopics(c.topics, l);
    p.forEach(t => assert.ok(v[l - 1].has(t.id)));
    const share = p.length / v[l - 1].size;
    assert.ok(share >= 0.15 && share <= 0.25, `level ${l} Pareto share ${share}`);
  }
});

test("a level-1 user sees no level-2/3 topics, cards, designs or sprint items", () => {
  const byId = new Map(c.topics.map(t => [t.id, t]));
  assert.ok(visibleTopics(c.topics, 1).every(t => t.min_level === 1));
  assert.ok(c.cards.cards.filter(x => effectiveCardLevel(x, byId) <= 1).every(x => byId.get(x.topic).min_level === 1));
  assert.deepEqual(c.designs.designs.filter(d => d.min_level <= 1).map(d => d.id), ["medallion-lakehouse"]);
  const items = c.sprint.days.flatMap(d => d.blocks).filter(b => b.min_level <= 1).flatMap(b => b.items).filter(i => i.min_level <= 1);
  assert.ok(!items.some(i => /Real-time fraud|RAG copilot|multi-tenant/i.test(i.text)));
});

test("level titles follow floor(sqrt(xp/40))+1, capped at 7", () => {
  const lv = c.gamification.levels;
  assert.deepEqual(lv.titles.map(t => t.min_xp), [0, 40, 160, 360, 640, 1000, 1440]);
  assert.equal(lv.titles[6].title, "Architect Legend");
});

test("validator rejects a Pareto level below min_level", () => {
  const bad = clone(c); bad.topicFiles[0].topics[0].min_level = 3; bad.topicFiles[0].topics[0].pareto_levels = [1];
  bad.topics = bad.topicFiles.flatMap(f => f.topics.map(t => ({ ...t, domain: f.domain })));
  assert.ok(validate(bad).errors.some(e => e.includes("below min_level")));
});

test("validator rejects a card linked to an unknown topic", () => {
  const bad = clone(c); bad.cards.cards[0].topic = "databricks/does-not-exist";
  assert.ok(validate(bad).errors.some(e => e.includes("unknown topic")));
});

test("validator rejects duplicate topic ids", () => {
  const bad = clone(c); bad.topicFiles[0].topics.push(clone(bad.topicFiles[0].topics[0]));
  bad.topics = bad.topicFiles.flatMap(f => f.topics.map(t => ({ ...t, domain: f.domain })));
  assert.ok(validate(bad).errors.some(e => e.includes("duplicate topic id")));
});
