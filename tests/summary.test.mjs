import { test } from "node:test";
import assert from "node:assert/strict";
import { extractiveSummary, plainText, splitSentences } from "../src/lib/summary/extractive.ts";

test("Markdown is flattened to plain sentences", () => {
  const md = "# Delta log\n- Commits are JSON files\n- See [docs](https://x.y/z)\n```sql\nSELECT 1;\n```\nUse `OPTIMIZE` often.";
  assert.equal(plainText(md), "Delta log. Commits are JSON files. See docs. Use OPTIMIZE often.");
  assert.deepEqual(splitSentences("Short. This sentence is long enough to keep.", 25), ["This sentence is long enough to keep."]);
});

test("picks the most representative sentences and keeps their original order", () => {
  const notes = [
    "The Delta transaction log records every commit as an ordered JSON file.",
    "I had coffee before studying today and it was nice.",
    "Checkpoints in the transaction log let readers skip replaying every JSON commit.",
    "Optimistic concurrency means writers check the transaction log for conflicting commits before committing.",
  ].join(" ");
  const r = extractiveSummary({ title: "Delta log", notes, excerpts: [] }, 2);
  assert.equal(r.engine, "extractive");
  assert.equal(r.points.length, 2);
  assert.ok(!r.points.some((p) => p.includes("coffee")), "off-topic sentence is dropped");
  const order = r.points.map((p) => notes.indexOf(p));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "original order kept");
});

test("uses saved excerpts as well as notes, and handles empty input", () => {
  const r = extractiveSummary({ title: "x", notes: "", excerpts: [{ title: "Blog", text: "Liquid clustering replaces partitioning and Z-ORDER for most new Delta tables." }] });
  assert.equal(r.points.length, 1);
  assert.deepEqual(extractiveSummary({ title: "x", notes: "  ", excerpts: [] }).points, []);
});
