#!/usr/bin/env node
// Validates content/*.yaml: JSON-schema shape checks + cross-reference and level rules.
// Exit code 1 on any error. Warnings (e.g. Pareto share outside 10–35%) don't fail.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import Ajv from "ajv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEVEL = { type: "integer", minimum: 1, maximum: 3 };
const SLUG = { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" };
const STR = { type: "string", minLength: 1 };
const obj = (props, req = Object.keys(props), extra = false) => ({ type: "object", properties: props, required: req, additionalProperties: extra });
const arr = (items, minItems = 0) => ({ type: "array", items, minItems });

const SCHEMAS = {
  levels: obj({ levels: arr(obj({ level: LEVEL, key: STR, name: STR, icon: STR, description: STR }), 3) }),
  domains: obj({ domains: arr(obj({ slug: SLUG, name: STR, icon: STR, order: { type: "integer" }, modules: arr(obj({ slug: SLUG, name: STR, order: { type: "integer" } }), 1) }), 1) }),
  topics: obj({ domain: SLUG, topics: arr(obj({
    id: { type: "string", pattern: "^[a-z0-9-]+/[a-z0-9-]+$" }, slug: SLUG, name: STR, module: SLUG, order: { type: "integer" },
    min_level: LEVEL, pareto_levels: { ...arr(LEVEL), uniqueItems: true },
    subtopics: arr(obj({ slug: SLUG, name: STR })),
    provenance: obj({ basis: { enum: ["academy", "proposed"] }, note: STR, added_from_academy: { type: "boolean" } }, ["basis", "note"]),
  }), 1) }),
  cards: obj({ cards: arr(obj({ id: SLUG, deck: STR, question: STR, answer: STR, topic: STR, min_level: { anyOf: [LEVEL, { const: "inherit" }] }, order: { type: "integer" } }), 1) }),
  designs: obj({
    answer_framework: obj({ min_level: LEVEL, total_minutes: { type: "integer" }, steps: arr(obj({ step: STR, minutes: { type: "integer", minimum: 1 } }), 1) }),
    designs: arr(obj({ id: SLUG, title: STR, min_level: LEVEL, topics: arr(STR), points: arr(STR, 1), order: { type: "integer" } }), 1),
  }),
  sprint: obj({ intro: STR, days: arr(obj({ day: { type: "integer" }, title: STR, blocks: arr(obj({
    id: SLUG, title: STR, minutes: { type: "integer", minimum: 1 }, min_level: LEVEL, topics: arr(STR), order: { type: "integer" },
    items: arr(obj({ id: STR, text: STR, min_level: LEVEL }), 1),
  }), 1) }), 1) }),
  hackerrank: obj({ title: STR, min_level: LEVEL, review_every_days: { type: "integer" }, last_reviewed: { type: ["string", "null"] }, disclaimer: STR,
    sections: arr(obj({ id: SLUG, title: STR, body: STR, order: { type: "integer" } }), 1), related_topics: arr(STR) }),
  gamification: obj({
    xp: { type: "object", required: ["topic_done", "revision", "note", "attachment", "study_minute"],
      additionalProperties: { type: "object", required: ["points", "idempotency_key"], properties: { points: { type: "integer", minimum: 0 }, idempotency_key: STR } } },
    levels: obj({ formula: STR, divisor: { type: "number", exclusiveMinimum: 0 }, max_level: { type: "integer" }, titles: arr(obj({ level: { type: "integer" }, title: STR, min_xp: { type: "integer" } }), 1) }),
    streak: { type: "object" }, revision: obj({ due_after_days: { type: "integer" }, overdue_after_days: { type: "integer" }, clock_starts: STR }),
    badges: arr(obj({ id: SLUG, name: STR, icon: STR, order: { type: "integer" }, rule: { type: "object", required: ["type"],
      properties: { type: { enum: ["topics_done", "streak_days", "study_minutes", "notes_count", "revisions_count", "pareto_complete", "session_start_local_hour"] } } } }), 1),
  }),
  messages: { type: "object", required: ["tone", "time_of_day", "greeting", "topic_done_cheers", "closing", "toasts"] },
  settings: { type: "object", required: ["progress", "resources", "uploads", "summary"] },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const load = rel => YAML.parse(readFileSync(join(ROOT, "content", rel), "utf8"));

export function loadContent() {
  const c = {};
  for (const k of ["levels", "domains", "cards", "designs", "sprint", "hackerrank", "gamification", "messages", "settings"]) c[k] = load(`${k}.yaml`);
  c.topicFiles = readdirSync(join(ROOT, "content/topics")).filter(f => f.endsWith(".yaml")).sort().map(f => load(`topics/${f}`));
  c.topics = c.topicFiles.flatMap(f => f.topics.map(t => ({ ...t, domain: f.domain })));
  return c;
}

// Level rules shared by the validator, report and tests (mirrors the future server rule).
export const visibleTopics = (topics, level) => topics.filter(t => t.min_level <= level);
export const paretoTopics = (topics, level) => visibleTopics(topics, level).filter(t => t.pareto_levels.includes(level));
export const effectiveCardLevel = (card, topicById) => card.min_level === "inherit" ? topicById.get(card.topic).min_level : card.min_level;

export function validate(c = loadContent()) {
  const errors = [], warnings = [];
  const check = (name, data, label = name) => { if (!ajv.validate(SCHEMAS[name], data)) ajv.errors.forEach(e => errors.push(`${label}${e.instancePath}: ${e.message}`)); };
  for (const k of Object.keys(SCHEMAS)) if (k !== "topics") check(k, c[k]);
  c.topicFiles.forEach(f => check("topics", f, `topics/${f.domain}`));
  if (errors.length) return { errors, warnings, stats: null };

  const dup = (list, label) => { const s = new Set(); list.forEach(x => { if (s.has(x)) errors.push(`duplicate ${label}: ${x}`); s.add(x); }); };
  const domains = new Map(c.domains.domains.map(d => [d.slug, d]));
  const topicById = new Map(c.topics.map(t => [t.id, t]));
  dup(c.topics.map(t => t.id), "topic id");
  c.topicFiles.forEach(f => { if (!domains.has(f.domain)) errors.push(`topics file for unknown domain ${f.domain}`); });
  domains.forEach((_, s) => { if (!c.topicFiles.find(f => f.domain === s)) errors.push(`domain ${s} has no topics file`); });
  c.topics.forEach(t => {
    if (!t.id.startsWith(t.domain + "/")) errors.push(`${t.id}: id prefix doesn't match domain`);
    if (!domains.get(t.domain)?.modules.find(m => m.slug === t.module)) errors.push(`${t.id}: unknown module ${t.module}`);
    t.pareto_levels.forEach(l => { if (l < t.min_level) errors.push(`${t.id}: pareto level ${l} is below min_level ${t.min_level} (users at that level can't see it)`); });
    dup(t.subtopics.map(s => s.slug), `subtopic slug in ${t.id}`);
  });
  const ref = (id, where) => { if (!topicById.has(id)) errors.push(`${where}: unknown topic ${id}`); };
  dup(c.cards.cards.map(x => x.id), "card id");
  c.cards.cards.forEach(x => ref(x.topic, `card ${x.id}`));
  dup(c.designs.designs.map(x => x.id), "design id");
  c.designs.designs.forEach(x => x.topics.forEach(t => ref(t, `design ${x.id}`)));
  const blocks = c.sprint.days.flatMap(d => d.blocks);
  dup(blocks.map(b => b.id), "sprint block id"); dup(blocks.flatMap(b => b.items.map(i => i.id)), "sprint item id");
  blocks.forEach(b => { b.topics.forEach(t => ref(t, `sprint ${b.id}`)); b.items.forEach(i => { if (i.min_level < b.min_level) errors.push(`sprint item ${i.id} level below its block`); }); });
  c.hackerrank.related_topics.forEach(t => ref(t, "hackerrank"));
  const g = c.gamification;
  dup(g.badges.map(b => b.id), "badge id");
  if (g.levels.titles.length !== g.levels.max_level) errors.push(`expected ${g.levels.max_level} level titles, got ${g.levels.titles.length}`);
  g.levels.titles.forEach((t, i) => { const want = g.levels.divisor * i * i; if (t.min_xp !== want) errors.push(`level ${t.level} min_xp ${t.min_xp} != formula ${want}`); });
  if (g.revision.overdue_after_days <= g.revision.due_after_days) errors.push("revision overdue must be after due");

  if (errors.length) return { errors, warnings, stats: null };
  const perLevel = [1, 2, 3].map(l => {
    const v = visibleTopics(c.topics, l), p = paretoTopics(c.topics, l);
    const share = p.length / v.length;
    if (share < 0.10 || share > 0.35) warnings.push(`level ${l}: Pareto is ${(share * 100).toFixed(0)}% of roadmap (target ~20%)`);
    return { level: l, visible: v.length, pareto: p.length, share: +(share * 100).toFixed(1),
      cards: c.cards.cards.filter(x => effectiveCardLevel(x, topicById) <= l).length,
      designs: c.designs.designs.filter(x => x.min_level <= l).length,
      sprint_items: blocks.filter(b => b.min_level <= l).flatMap(b => b.items).filter(i => i.min_level <= l).length };
  });
  const stats = { domains: domains.size, topics: c.topics.length, subtopics: c.topics.reduce((a, t) => a + t.subtopics.length, 0),
    cards: c.cards.cards.length, designs: c.designs.designs.length, sprint_blocks: blocks.length, badges: g.badges.length,
    proposed_flags: c.topics.filter(t => t.provenance.basis === "proposed").length,
    added_topics: c.topics.filter(t => t.provenance.added_from_academy).length, perLevel };
  return { errors, warnings, stats };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { errors, warnings, stats } = validate();
  warnings.forEach(w => console.warn("WARN  " + w));
  if (errors.length) { errors.forEach(e => console.error("ERROR " + e)); process.exit(1); }
  console.log(JSON.stringify(stats, null, 2)); console.log("Content valid.");
}
