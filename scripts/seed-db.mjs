#!/usr/bin/env node
// Loads content/*.yaml into the database.
//   --mode=init  (default) insert rows that don't exist yet; never overwrite admin edits
//   --mode=force overwrite changed rows from YAML (bumps version, keeps history)
// Usage: DATABASE_URL=postgres://... node scripts/seed-db.mjs [--mode=init|force]
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
import { loadContent, validate } from "./validate-seed.mjs";

const json = v => JSON.stringify(v);
// jsonb reorders object keys, so compare snapshots with sorted keys.
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
  : JSON.stringify(v);

async function upsertPlain(db, table, keys, row, mode) {
  const cols = Object.keys(row), vals = cols.map(c => row[c]);
  const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
  const nonKey = cols.filter(c => !keys.includes(c));
  const onConflict = mode === "force" && nonKey.length
    ? `do update set ${nonKey.map(c => `${c} = excluded.${c}`).join(", ")}` : "do nothing";
  await db.query(`insert into public.${table} (${cols.join(", ")}) values (${ph}) on conflict (${keys.join(", ")}) ${onConflict}`, vals);
}

// Versioned entities: row + snapshot in content_versions. Returns "inserted" | "updated" | "unchanged" | "kept".
async function upsertVersioned(db, table, entityType, row, snapshot, mode, after) {
  const { rows } = await db.query(`select version from public.${table} where ${table === "content_documents" ? "key" : "id"} = $1`, [row.key ?? row.id]);
  const id = row.key ?? row.id;
  if (!rows.length) {
    await upsertPlain(db, table, [table === "content_documents" ? "key" : "id"], { ...row, version: 1 }, "init");
    await db.query(`insert into public.content_versions (entity_type, entity_id, version, data) values ($1, $2, 1, $3)`, [entityType, id, json(snapshot)]);
    if (after) await after();
    return "inserted";
  }
  if (mode !== "force") return "kept";
  const last = await db.query(`select data from public.content_versions where entity_type = $1 and entity_id = $2 order by version desc limit 1`, [entityType, id]);
  if (last.rows[0] && canonical(last.rows[0].data) === canonical(JSON.parse(json(snapshot)))) return "unchanged";
  const version = rows[0].version + 1;
  await upsertPlain(db, table, [table === "content_documents" ? "key" : "id"], { ...row, version }, "force");
  await db.query(`insert into public.content_versions (entity_type, entity_id, version, data) values ($1, $2, $3, $4)`, [entityType, id, version, json(snapshot)]);
  if (after) await after();
  return "updated";
}

export async function seed(db, { mode = "init", log = () => {} } = {}) {
  const c = loadContent();
  const { errors } = validate(c);
  if (errors.length) throw new Error("content invalid:\n" + errors.join("\n"));
  const tally = {};
  const count = (k, r) => { tally[k] ??= {}; tally[k][r] = (tally[k][r] || 0) + 1; };

  await db.query("begin");
  try {
    for (const l of c.levels.levels) await upsertPlain(db, "levels", ["level"], { level: l.level, key: l.key, name: l.name, icon: l.icon, description: l.description }, mode);
    for (const d of c.domains.domains) {
      await upsertPlain(db, "domains", ["slug"], { slug: d.slug, name: d.name, icon: d.icon, sort_order: d.order }, mode);
      for (const m of d.modules) await upsertPlain(db, "modules", ["domain_slug", "slug"], { domain_slug: d.slug, slug: m.slug, name: m.name, sort_order: m.order }, mode);
    }
    log("seeding topics…");
    for (const t of c.topics) {
      const row = { id: t.id, domain_slug: t.domain, module_slug: t.module, slug: t.slug, name: t.name, sort_order: t.order,
        min_level: t.min_level, pareto_levels: t.pareto_levels, provenance: json(t.provenance) };
      const subs = async () => { for (const [i, s] of t.subtopics.entries())
        await upsertPlain(db, "subtopics", ["id"], { id: `${t.id}#${s.slug}`, topic_id: t.id, slug: s.slug, name: s.name, sort_order: i + 1 }, "force"); };
      count("topics", await upsertVersioned(db, "topics", "topic", row, { ...row, provenance: t.provenance, subtopics: t.subtopics }, mode, subs));
    }
    log("seeding cards…");
    for (const x of c.cards.cards) {
      const row = { id: x.id, deck: x.deck, question: x.question, answer: x.answer, topic_id: x.topic,
        min_level_override: x.min_level === "inherit" ? null : x.min_level, sort_order: x.order };
      count("cards", await upsertVersioned(db, "cards", "card", row, row, mode));
    }
    log("seeding designs…");
    for (const x of c.designs.designs) {
      const row = { id: x.id, title: x.title, min_level: x.min_level, points: x.points, topic_ids: x.topics, sort_order: x.order };
      count("designs", await upsertVersioned(db, "designs", "design", row, row, mode));
    }
    log("seeding sprint…");
    for (const day of c.sprint.days) for (const b of day.blocks) {
      const row = { id: b.id, day: day.day, day_title: day.title, title: b.title, minutes: b.minutes, min_level: b.min_level, topic_ids: b.topics, sort_order: b.order };
      const items = async () => { for (const [i, it] of b.items.entries())
        await upsertPlain(db, "sprint_items", ["id"], { id: it.id, block_id: b.id, text: it.text, min_level: it.min_level, sort_order: i + 1 }, "force"); };
      count("sprint_blocks", await upsertVersioned(db, "sprint_blocks", "sprint_block", row, { ...row, items: b.items }, mode, items));
    }
    log("seeding documents and badges…");
    const docs = [
      ["design_framework", c.designs.answer_framework, c.designs.answer_framework.min_level],
      ["sprint_intro", { intro: c.sprint.intro }, 1],
      ["hackerrank", c.hackerrank, c.hackerrank.min_level],
      ["gamification", c.gamification, 1],
      ["messages", c.messages, 1],
      ["settings", c.settings, 1],
    ];
    for (const [key, data, min_level] of docs)
      count("documents", await upsertVersioned(db, "content_documents", "document", { key, data: json(data), min_level }, { data, min_level }, mode));
    for (const b of c.gamification.badges)
      await upsertPlain(db, "badges", ["id"], { id: b.id, name: b.name, icon: b.icon, rule: json(b.rule), sort_order: b.order }, mode);
    log("committing…");
    await db.query("commit");
  } catch (e) { await db.query("rollback"); throw e; }
  return tally;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = (process.argv.find(a => a.startsWith("--mode=")) || "--mode=init").split("=")[1];
  if (!["init", "force"].includes(mode)) { console.error("mode must be init or force"); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL (Supabase: Project Settings > Database > Connection string)"); process.exit(2); }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { console.log(JSON.stringify(await seed(db, { mode, log: m => console.log(m) }), null, 2)); console.log("Seed complete."); } finally { await db.end(); }
}
