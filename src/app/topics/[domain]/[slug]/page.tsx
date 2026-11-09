import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_UPLOADS, signPaths, type UploadSettings } from "@/lib/storage";
import { summarize } from "@/lib/summary";
import { fmtDate } from "@/lib/format";
import { Nav } from "@/components/Nav";
import { ActionForm } from "@/components/ActionForm";
import { CopyButton } from "@/components/CopyButton";
import { StudyTimer } from "@/components/StudyTimer";
import type { StudyState } from "@/app/study/actions";
import { addLink, deleteAttachment, deleteCustomTopic, deleteLink, setShared } from "@/app/material/actions";
import { TopicControls } from "./TopicControls";
import { NotesEditor } from "./NotesEditor";
import { UploadBox } from "./UploadBox";
import { BookmarkStar } from "@/components/BookmarkStar";
import { RevisedButton } from "@/components/RevisedButton";
import { revisionState } from "@/lib/revision";

const SLUG = /^[a-z0-9-]+$/;

export default async function TopicPage({ params }: { params: Promise<{ domain: string; slug: string }> }) {
  const access = await requireOnboarded();
  const { domain, slug } = await params;
  if (!SLUG.test(domain) || !SLUG.test(slug)) notFound();
  const id = `${domain}/${slug}`;
  const supabase = await createClient();

  // RLS returns nothing for topics above the caller's levels, so they get a plain 404.
  const { data: topic } = await supabase.from("topics")
    .select("id, name, domain_slug, module_slug, min_level, owner_id").eq("id", id).maybeSingle();
  if (!topic) notFound();

  const uid = access.user_id;
  const [{ data: dom }, { data: mod }, { data: subs }, { data: prog }, { data: subProg }, { data: flags }, { data: levels }, { data: study },
    { data: note }, { data: links }, { data: files }, { data: allFiles }, { data: share }, { data: settings }, { data: star }, { data: game }] = await Promise.all([
    supabase.from("domains").select("name, icon").eq("slug", topic.domain_slug).single(),
    supabase.from("modules").select("name").eq("domain_slug", topic.domain_slug).eq("slug", topic.module_slug).single(),
    supabase.from("subtopics").select("id, name, sort_order").eq("topic_id", id).order("sort_order"),
    supabase.from("topic_progress").select("status, done_at, last_revised_at").eq("user_id", uid).eq("topic_id", id).maybeSingle(),
    supabase.from("subtopic_progress").select("subtopic_id").eq("user_id", uid).eq("done", true).like("subtopic_id", `${id}#%`),
    supabase.rpc("my_topic_flags"),
    supabase.from("levels").select("level, name"),
    supabase.rpc("study_state"),
    supabase.from("notes").select("body_md, updated_at").eq("user_id", uid).eq("topic_id", id).maybeSingle(),
    supabase.from("links").select("id, kind, title, url, excerpt, created_at").eq("user_id", uid).eq("topic_id", id).order("created_at"),
    supabase.from("attachments").select("id, storage_path, thumb_path, mime_type, bytes, original_name, created_at").eq("user_id", uid).eq("topic_id", id).order("created_at"),
    supabase.from("attachments").select("bytes").eq("user_id", uid),
    supabase.from("topic_shares").select("shared_at").eq("user_id", uid).eq("topic_id", id).maybeSingle(),
    supabase.from("content_documents").select("data").eq("key", "settings").single(),
    supabase.from("bookmarks").select("topic_id").eq("user_id", uid).eq("topic_id", id).maybeSingle(),
    supabase.from("content_documents").select("data").eq("key", "gamification").single(),
  ]);
  const rv = game?.data?.revision ?? {};
  const revision = revisionState({ status: prog?.status ?? 0, doneAt: prog?.done_at ?? null, lastRevisedAt: prog?.last_revised_at ?? null, due: rv.due_after_days, overdue: rv.overdue_after_days });
  const done = new Set((subProg ?? []).map((s) => s.subtopic_id));
  const core: number[] = (flags ?? []).find((f: { topic_id: string }) => f.topic_id === id)?.pareto_levels ?? [];
  const levelName = (n: number) => levels?.find((l) => l.level === n)?.name ?? `Level ${n}`;
  const up: UploadSettings = { ...DEFAULT_UPLOADS, ...(settings?.data?.uploads ?? {}) };
  const sumCfg = settings?.data?.summary ?? {};
  const urls = await signPaths((files ?? []).flatMap((f) => [f.storage_path, f.thumb_path].filter(Boolean) as string[]), up.signed_url_ttl_seconds);
  const used = (allFiles ?? []).reduce((a, f) => a + (f.bytes as number), 0);
  const summary = await summarize(
    { title: topic.name, notes: note?.body_md ?? "", excerpts: (links ?? []).filter((l) => l.excerpt).map((l) => ({ title: l.title, text: l.excerpt! })) },
    { maxPoints: Number(sumCfg.max_points ?? 4), minSentenceChars: Number(sumCfg.min_sentence_chars ?? 25) },
  );
  const status = ["Not started", "In progress", "Done"][prog?.status ?? 0];
  const summaryText = [`${topic.name} (${status})`, ...(summary.points.length ? ["Key points:", ...summary.points.map((p) => `• ${p}`)] : []),
    ...((links ?? []).length ? ["Sources:", ...(links ?? []).map((l) => `• [${l.kind}] ${l.title || l.url || "Untitled"}${l.url ? ` (${l.url})` : ""}`)] : [])].join("\n");

  return (
    <main>
      <Nav current="roadmap" isAdmin={access.is_admin} />
      <p className="muted"><Link href={`/roadmap?domain=${topic.domain_slug}`}>← {dom?.icon} {dom?.name}</Link> · {mod?.name}</p>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <h1>{topic.name}</h1>
        <BookmarkStar topicId={id} topicName={topic.name} on={!!star} />
      </div>
      <div className="row">
        {topic.owner_id ? <span className="tag">Your own topic · only you can see it</span> : <span className="tag">{levelName(topic.min_level)} and up</span>}
        {core.map((l) => <span key={l} className="tag core">Core for {levelName(l)}</span>)}
      </div>
      <div className="card">
        <TopicControls topicId={id} status={prog?.status ?? 0}
          subtopics={(subs ?? []).map((s) => ({ id: s.id, name: s.name, done: done.has(s.id) }))} />
      </div>
      {revision.state !== "not_done" && (
        <section className="card row" aria-label="Revision" style={{ justifyContent: "space-between" }}>
          <span>🔁 {revision.state === "fresh"
            ? `Reviewed ${revision.days === 0 ? "today" : `${revision.days} day${revision.days === 1 ? "" : "s"} ago`}. Due for a quick review in ${revision.dueInDays} day${revision.dueInDays === 1 ? "" : "s"}.`
            : `${revision.days} days since your last review. ${revision.state === "overdue" ? "A quick review now will lock it in." : "Good time for a quick review."}`}</span>
          <RevisedButton topicId={id} topicName={topic.name} />
        </section>
      )}
      {study && <StudyTimer initial={study as StudyState} topicId={id} topicName={topic.name} />}

      <section className="card" aria-labelledby="notes-h">
        <h2 id="notes-h" style={{ marginTop: 0 }}>📝 Notes</h2>
        <NotesEditor topicId={id} initial={note?.body_md ?? ""} />
      </section>

      <section className="card" aria-labelledby="files-h">
        <h2 id="files-h" style={{ marginTop: 0 }}>📎 Photos &amp; handwritten PDFs</h2>
        {!!files?.length && (
          <ul className="files">
            {files.map((f) => {
              const href = urls.get(f.storage_path), thumb = f.thumb_path ? urls.get(f.thumb_path) : undefined;
              return (
                <li key={f.id}>
                  <a href={href} target="_blank" rel="noopener noreferrer" className="file-link">
                    {thumb ? <img src={thumb} alt={`Preview of ${f.original_name}`} width={96} height={96} loading="lazy" />
                      : <span className="file-icon" aria-hidden="true">{f.mime_type === "application/pdf" ? "📄" : "🖼️"}</span>}
                    <span>{f.original_name}<br /><span className="muted">{(f.bytes / 1048576).toFixed(1)} MB · {fmtDate(f.created_at)}</span></span>
                  </a>
                  <ActionForm action={deleteAttachment} submit="Remove" confirm="Confirm: remove file" danger inline>
                    <input type="hidden" name="id" value={f.id} />
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
        <UploadBox topicId={id} usedBytes={used} quotaBytes={up.per_user_quota_bytes} />
      </section>

      <section className="card" aria-labelledby="links-h">
        <h2 id="links-h" style={{ marginTop: 0 }}>🔗 Saved links &amp; articles</h2>
        {!!links?.length && (
          <ul className="mini">
            {links.map((l) => (
              <li key={l.id}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="tag">{l.kind}</span>{" "}
                  {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer nofollow">{l.title || l.url}</a> : <strong>{l.title || "Excerpt"}</strong>}
                  {l.excerpt && <span className="muted excerpt">{l.excerpt.length > 160 ? `${l.excerpt.slice(0, 160)}…` : l.excerpt}</span>}
                </span>
                <ActionForm action={deleteLink} submit="Remove" confirm="Confirm: remove" danger inline>
                  <input type="hidden" name="id" value={l.id} /><input type="hidden" name="topic_id" value={id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <details className="add-link" open={!links?.length}>
          <summary>Save a link or article excerpt</summary>
          <ActionForm action={addLink} submit="Save">
            <input type="hidden" name="topic_id" value={id} />
            <div className="row">
              <label style={{ flex: "0 0 120px" }}>Type
                <select name="kind" defaultValue="Link"><option>Link</option><option>Article</option><option>Video</option><option>Doc</option></select>
              </label>
              <label style={{ flex: 1, minWidth: 180 }}>Title<input name="title" maxLength={300} /></label>
            </div>
            <label>URL (optional)<input name="url" type="url" inputMode="url" placeholder="https://" maxLength={2000} /></label>
            <label>Key excerpt (optional, used in the summary)<textarea name="excerpt" rows={3} maxLength={20000} /></label>
          </ActionForm>
        </details>
      </section>

      <section className="card" aria-labelledby="sum-h">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 id="sum-h" style={{ margin: 0 }}>✨ Auto summary</h2>
          {summary.points.length > 0 && <CopyButton text={summaryText} />}
        </div>
        {summary.points.length ? (
          <ul>{summary.points.map((p) => <li key={p}>{p}</li>)}</ul>
        ) : <p className="muted">Add notes or paste article excerpts and the key points appear here.</p>}
        <p className="muted" style={{ marginBottom: 0, fontSize: "0.8rem" }}>Picked from your own notes and excerpts. <Link href="/notes">See the summary across all topics</Link>.</p>
      </section>

      {topic.owner_id && (
        <section className="card" aria-label="Delete topic">
          <ActionForm action={deleteCustomTopic} submit="Delete this topic" confirm="Confirm: delete topic, its progress and notes" danger inline>
            <input type="hidden" name="topic_id" value={id} />
          </ActionForm>
        </section>
      )}
      <section className="card" aria-labelledby="share-h">
        <h2 id="share-h" style={{ marginTop: 0 }}>🔒 Privacy</h2>
        <p style={{ marginTop: 0 }}>{share ? "Admins can see your notes, links and files for this topic." : "Your notes, links and files are private. Admins see only your progress."}</p>
        <ActionForm action={setShared} submit={share ? "Stop sharing with admins" : "Share this topic with admins"} inline>
          <input type="hidden" name="topic_id" value={id} /><input type="hidden" name="shared" value={String(!share)} />
        </ActionForm>
      </section>
    </main>
  );
}
