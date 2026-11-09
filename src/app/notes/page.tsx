import Link from "next/link";
import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { viewLevel } from "@/lib/levels";
import { summarize } from "@/lib/summary";
import { Nav } from "@/components/Nav";
import { CopyButton } from "@/components/CopyButton";
import { LevelTabs } from "@/components/LevelTabs";

export default async function NotesOverview({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const access = await requireOnboarded();
  const { held, level } = await viewLevel(access, (await searchParams).level);
  const supabase = await createClient();
  const uid = access.user_id;
  const [{ data: domains }, { data: topics }, { data: progress }, { data: notes }, { data: links }, { data: files }, { data: settings }] = await Promise.all([
    supabase.from("domains").select("slug, name, icon").order("sort_order"),
    supabase.from("topics").select("id, name, domain_slug, sort_order").is("owner_id", null).lte("min_level", level.level).order("sort_order"),
    supabase.from("topic_progress").select("topic_id, status").eq("user_id", uid),
    supabase.from("notes").select("topic_id, body_md").eq("user_id", uid),
    supabase.from("links").select("topic_id, kind, title, url, excerpt").eq("user_id", uid),
    supabase.from("attachments").select("topic_id").eq("user_id", uid),
    supabase.from("content_documents").select("data").eq("key", "settings").single(),
  ]);
  const cfg = { maxPoints: Number(settings?.data?.summary?.max_points ?? 4), minSentenceChars: Number(settings?.data?.summary?.min_sentence_chars ?? 25) };
  const status = new Map((progress ?? []).map((p) => [p.topic_id, p.status as number]));
  const noteOf = new Map((notes ?? []).map((n) => [n.topic_id, n.body_md as string]));
  const linksOf = (t: string) => (links ?? []).filter((l) => l.topic_id === t);
  const fileCount = (t: string) => (files ?? []).filter((f) => f.topic_id === t).length;

  const sections = await Promise.all((domains ?? []).map(async (d) => {
    const ts = (topics ?? []).filter((t) => t.domain_slug === d.slug);
    const withMaterial = ts.filter((t) => noteOf.get(t.id)?.trim() || linksOf(t.id).length || fileCount(t.id));
    const summaries = await Promise.all(withMaterial.map(async (t) => ({
      t, s: await summarize({ title: t.name, notes: noteOf.get(t.id) ?? "", excerpts: linksOf(t.id).filter((l) => l.excerpt).map((l) => ({ title: l.title, text: l.excerpt! })) }, cfg),
    })));
    return {
      d, total: ts.length, done: ts.filter((t) => status.get(t.id) === 2).length, wip: ts.filter((t) => status.get(t.id) === 1).length,
      next: ts.filter((t) => !status.get(t.id)).slice(0, 3), summaries,
    };
  }));
  const visible = sections.filter((s) => s.total > 0);
  const text = visible.map((s) => [
    `${s.d.icon} ${s.d.name}: ${s.done}/${s.total} done, ${s.wip} in progress`,
    ...(s.next.length ? [`  Up next: ${s.next.map((t) => t.name).join("; ")}`] : []),
    ...s.summaries.flatMap(({ t, s: sum }) => [`  ${t.name}`, ...sum.points.map((p) => `    • ${p}`)]),
  ].join("\n")).join("\n\n");
  const anyMaterial = visible.some((s) => s.summaries.length);

  return (
    <main>
      <Nav current="roadmap" isAdmin={access.is_admin} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>📚 Your study summary</h1>
        <div className="row"><CopyButton text={text} label="Copy summary" /><a className="btn" href="/api/export" download>Download my data</a></div>
      </div>
      <LevelTabs held={held} current={level.level} base="/notes" label="Summary level" />
      <p className="muted">Progress for the {level.name} roadmap, what to do next, and key points pulled from your own notes and excerpts.</p>
      {!anyMaterial && <p className="card muted">No notes yet. Open any topic and add notes or article excerpts; their key points will collect here.</p>}
      {visible.map((s) => (
        <section key={s.d.slug} className="card" aria-labelledby={`sum-${s.d.slug}`}>
          <h2 id={`sum-${s.d.slug}`} className="mod" style={{ marginTop: 0 }}><span>{s.d.icon} {s.d.name}</span><span className="muted">{s.done}/{s.total} done{s.wip ? `, ${s.wip} in progress` : ""}</span></h2>
          {!!s.next.length && <p className="muted" style={{ marginTop: 0 }}>Up next: {s.next.map((t, i) => <span key={t.id}>{i > 0 && " · "}<Link href={`/topics/${t.id}`}>{t.name}</Link></span>)}</p>}
          {s.summaries.map(({ t, s: sum }) => (
            <div key={t.id} className="topic-summary">
              <h3><Link href={`/topics/${t.id}`}>{t.name}</Link> <span className="muted" style={{ fontWeight: 400, fontSize: "0.85rem" }}>
                {[noteOf.get(t.id)?.trim() && "notes", linksOf(t.id).length && `${linksOf(t.id).length} link(s)`, fileCount(t.id) && `${fileCount(t.id)} file(s)`].filter(Boolean).join(" · ")}</span></h3>
              {sum.points.length ? <ul>{sum.points.map((p) => <li key={p}>{p}</li>)}</ul> : <p className="muted">Nothing to summarise yet (files aren&apos;t read, only notes and excerpts).</p>}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
