// Notes, saved links and sharing (real Postgres 16 + Supabase shim).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startCluster, createUser, as, asService, onboard } from "./harness.mjs";

let cluster, db, u, v, admin;
before(async () => {
  cluster = await startCluster();
  db = await cluster.freshDb();
  u = await createUser(db, "writer@example.com"); await onboard(db, u, 1);
  v = await createUser(db, "reader@example.com"); await onboard(db, v, 1);
  admin = await createUser(db, "root@example.com"); await onboard(db, admin, 3);
  await asService(db, d => d.query("select public.bootstrap_admins(array['root@example.com'])"));
});
after(async () => { await db?.end(); await cluster?.stop(); });

const q1 = async (sql, args) => (await db.query(sql, args)).rows;
const count = async (d, sql, args) => Number((await d.query(sql, args)).rows[0].count);
const T = "databricks/acid";

describe("notes", () => {
  test("save, overwrite and clear a note", async () => {
    await as(db, u, d => d.query("select public.save_note($1, $2)", [T, "# ACID\nAtomicity means all or nothing."]));
    await as(db, u, d => d.query("select public.save_note($1, $2)", [T, "Updated note about ACID guarantees."]));
    assert.equal((await q1("select body_md from notes where user_id = $1", [u]))[0].body_md, "Updated note about ACID guarantees.");
    const [r] = await as(db, u, d => d.query("select public.save_note($1, '   ') r", [T]).then(x => x.rows));
    assert.equal(r.r.empty, true);
    assert.equal(await count(db, "select count(*) from notes where user_id = $1", [u]), 0);
  });

  test("notes are refused on hidden topics and over the size limit", async () => {
    await assert.rejects(as(db, u, d => d.query("select public.save_note('databricks/governance', 'x')")), /not available/);
    await assert.rejects(as(db, u, d => d.query("select public.save_note($1, repeat('a', 100001))", [T])), /too long/);
  });
});

describe("links and sharing", () => {
  test("links need a title, URL or excerpt, and URLs must be http(s)", async () => {
    await as(db, u, d => d.query("insert into links (user_id, topic_id, kind, title, url, excerpt) values ($1, $2, 'Article', 'Delta ACID', 'https://example.com/acid', 'Delta Lake gives ACID transactions on cloud storage using a transaction log.')", [u, T]));
    await assert.rejects(as(db, u, d => d.query("insert into links (user_id, topic_id, kind, url) values ($1, $2, 'Link', 'javascript:alert(1)')", [u, T])), /check constraint/);
    await assert.rejects(as(db, u, d => d.query("insert into links (user_id, topic_id, kind) values ($1, $2, 'Link')", [u, T])), /check constraint/);
    await assert.rejects(as(db, u, d => d.query("insert into links (user_id, topic_id, kind, title) values ($1, $2, 'Podcast', 'x')", [u, T])), /check constraint/);
  });

  test("other users never see your notes, links or files; admins only after you share", async () => {
    await as(db, u, d => d.query("select public.save_note($1, 'my private ACID notes')", [T]));
    await as(db, u, d => d.query("insert into attachments (user_id, topic_id, storage_path, mime_type, bytes, original_name) values ($1, $2, $3, 'image/png', 1000, 'a.png')", [u, T, `${u}/a.png`]));
    for (const t of ["notes", "links", "attachments"]) {
      assert.equal(await as(db, v, d => count(d, `select count(*) from ${t}`)), 0, `peer can't read ${t}`);
      assert.equal(await as(db, admin, d => count(d, `select count(*) from ${t} where user_id = $1`, [u])), 0, `admin can't read unshared ${t}`);
    }
    await as(db, u, d => d.query("insert into topic_shares (user_id, topic_id) values ($1, $2)", [u, T]));
    for (const t of ["notes", "links", "attachments"])
      assert.equal(await as(db, admin, d => count(d, `select count(*) from ${t} where user_id = $1`, [u])), 1, `admin reads shared ${t}`);
    assert.equal(await as(db, v, d => count(d, "select count(*) from notes")), 0, "sharing is with admins only, not other users");
    await as(db, v, d => d.query("delete from topic_shares where user_id = $1", [u]));
    assert.equal(await count(db, "select count(*) from topic_shares where user_id = $1", [u]), 1, "another user can't unshare your topic");
  });
});
