import { test } from "node:test";
import assert from "node:assert/strict";
import { parseImportCsv, parseLevels } from "../src/lib/csv-import.ts";

test("level cells accept numbers and names", () => {
  assert.deepEqual(parseLevels("1;2"), [1, 2]);
  assert.deepEqual(parseLevels("3 | 1"), [1, 3]);
  assert.deepEqual(parseLevels("Data Engineer; Data Architect"), [1, 3]);
  assert.deepEqual(parseLevels("PDE"), [2]);
  assert.deepEqual(parseLevels("data_architect"), [3]);
  assert.deepEqual(parseLevels("1 2"), [1, 2]);
  assert.equal(parseLevels("4"), null);
  assert.equal(parseLevels(""), null);
  assert.equal(parseLevels("manager"), null);
});

test("parses a CSV with header, quotes, duplicates and bad rows", () => {
  const csv = [
    "email,levels",
    "Priya@Example.com,1;2",
    '"ravi@example.com","Data Architect, Data Engineer"',
    "# a comment",
    "",
    "not-an-email,1",
    "sam@example.com,9",
    "priya@example.com,3",
  ].join("\r\n");
  const { rows, problems } = parseImportCsv(csv);
  assert.deepEqual(rows.map((r) => [r.email, r.levels]), [["priya@example.com", [1, 2, 3]], ["ravi@example.com", [1, 3]]]);
  assert.deepEqual(problems.map((p) => [p.line, p.reason]), [[6, "not a valid email"], [7, "levels must be 1, 2, 3 or level names"]]);
});

test("caps the number of rows", () => {
  const csv = Array.from({ length: 5 }, (_, i) => `u${i}@example.com,1`).join("\n");
  const { rows, problems } = parseImportCsv(csv, 3);
  assert.equal(rows.length, 3); assert.equal(problems.length, 2);
});
