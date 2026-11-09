import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, LEVEL_SHORT } from "@/lib/format";

type T = { id: string; name: string; domain_slug: string; module_slug: string; min_level: number; pareto_levels: number[]; archived: boolean; subtopics: number };
type C = { id: string; deck: string; question: string; topic_name: string; archived_at: string | null };
type D = { id: string; title: string; min_level: number; archived_at: string | null };
type Doc = { key: string; version: number; updated_at: string };

const DOC_LABEL: Record<string, string> = {
  hackerrank: "HackerRank AI guide", messages: "Messages (greeting, cheers, closing, toasts)", gamification: "Gamification (XP, levels, badges, revision timing)",
  settings: "Settings (progress, uploads, summary)", design_framework: "Design answer framework", sprint_intro: "Sprint intro",
};

export default async function ContentHome({ searchParams }: { searchParams: Promise<{ domain?: string; tab?: string }> }) {
  await requireAdmin();
  const { domain: dq, tab = "topics" } = await searchParams;
  const supabase = await createClient();
  const { data: domains } = await supabase.from("domains").select("slug, name, icon").order("sort_order");
  const domain = domains?.find((d) => d.slug === dq)?.slug ?? domains?.[0]?.slug ?? "";
  const [{ data: topics }, { data: cards }, { data: designs }, { data: docs }, { data: recent }] = await Promise.all([
    supabase.rpc("admin_content", { p_kind: "topics", p_id: domain }),
    tab === "cards" ? supabase.rpc("admin_content", { p_kind: "cards" }) : Promise.resolve({ data: null }),
    tab === "designs" ? supabase.rpc("admin_content", { p_kind: "designs" }) : Promise.resolve({ data: null }),
    supabase.rpc("admin_content", { p_kind: "documents" }),
    supabase.from("content_versions").select("entity_type, entity_id, version, created_at").not("edited_by", "is", null).order("id", { ascending: false }).limit(8),
  ]);
  const tabs = [["topics", "Topics"], ["cards", "Flip cards"], ["designs", "System designs"], ["docs", "Guides & settings"]] as const;
  const editHref = (type: string, id: string) => type === "topic" ? `/admin/content/topics/${id}` : type === "document" ? `/admin/content/docs/${id}` : `/admin/content/${type}s/${id}`;

  return (
    <>
      <p className="muted">Edit learning content without a code change. Every save is versioned and recorded in the audit log, and any version can be restored.</p>
      <nav className="tabs" aria-label="Content type">
        {tabs.map(([k, label]) => <Link key={k} href={`/admin/content?tab=${k}`} className={`tab${tab === k ? " on" : ""}`} aria-current={tab === k ? "page" : undefined}>{label}</Link>)}
      </nav>

      {tab === "topics" && (
        <>
          <nav className="tabs" aria-label="Domain">
            {(domains ?? []).map((d) => <Link key={d.slug} href={`/admin/content?tab=topics&domain=${d.slug}`} className={`tab${d.slug === domain ? " on" : ""}`}>{d.icon} {d.name}</Link>)}
          </nav>
          <p><Link className="btn primary" href={`/admin/content/topics/new?domain=${domain}`}>+ New topic in this domain</Link></p>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Topic</th><th scope="col">Module</th><th scope="col">Min level</th><th scope="col">Pareto core for</th><th scope="col" className="num">Subtopics</th></tr></thead>
              <tbody>
                {((topics ?? []) as T[]).map((t) => (
                  <tr key={t.id} className={t.archived ? "dim" : undefined}>
                    <td><Link href={`/admin/content/topics/${t.id}`}>{t.name}</Link>{t.archived && <span className="tag"> archived</span>}</td>
                    <td className="muted">{t.module_slug}</td>
                    <td>{LEVEL_SHORT[t.min_level]}</td>
                    <td>{t.pareto_levels.map((l) => LEVEL_SHORT[l]).join(", ") || "–"}</td>
                    <td className="num">{t.subtopics}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "cards" && (
        <>
          <p><Link className="btn primary" href="/admin/content/cards/new">+ New flip card</Link></p>
          <ul className="mini card">
            {((cards ?? []) as C[]).map((c) => (
              <li key={c.id} className={c.archived_at ? "dim" : undefined}>
                <span><span className="tag">{c.deck}</span> <Link href={`/admin/content/cards/${c.id}`}>{c.question}</Link>{c.archived_at && " (archived)"}</span>
                <span className="muted">{c.topic_name}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "designs" && (
        <>
          <p><Link className="btn primary" href="/admin/content/designs/new">+ New system design</Link></p>
          <ul className="mini card">
            {((designs ?? []) as D[]).map((d) => (
              <li key={d.id}><Link href={`/admin/content/designs/${d.id}`}>{d.title}</Link><span className="muted">{LEVEL_SHORT[d.min_level]}+{d.archived_at ? " · archived" : ""}</span></li>
            ))}
          </ul>
        </>
      )}

      {tab === "docs" && (
        <ul className="mini card">
          {((docs ?? []) as Doc[]).map((d) => (
            <li key={d.key}><Link href={`/admin/content/docs/${d.key}`}>{DOC_LABEL[d.key] ?? d.key}</Link><span className="muted">v{d.version} · {fmtDateTime(d.updated_at)}</span></li>
          ))}
        </ul>
      )}

      <section className="card" aria-labelledby="re-h">
        <h2 id="re-h" style={{ marginTop: 0 }}>Recent edits</h2>
        {recent?.length ? (
          <ul className="mini">{recent.map((r) => <li key={`${r.entity_type}${r.entity_id}${r.version}`}><Link href={editHref(r.entity_type, r.entity_id)}>{r.entity_type}: {r.entity_id}</Link><span className="muted">v{r.version} · {fmtDateTime(r.created_at)}</span></li>)}</ul>
        ) : <p className="muted" style={{ margin: 0 }}>No edits yet. The audit log also records every change.</p>}
      </section>
    </>
  );
}
