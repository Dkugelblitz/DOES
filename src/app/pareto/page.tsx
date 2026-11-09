import Link from "next/link";
import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { viewLevel } from "@/lib/levels";
import { readiness, type Status } from "@/lib/progress";
import { Nav } from "@/components/Nav";
import { Bar } from "@/components/Bar";
import { StatusDot } from "@/components/StatusDot";
import { LevelTabs } from "@/components/LevelTabs";

type Core = { topic_id: string; domain_slug: string; module_slug: string; name: string; sort_order: number };

export default async function ParetoPage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const access = await requireOnboarded();
  const { held, level } = await viewLevel(access, (await searchParams).level);
  const supabase = await createClient();
  // pareto_topics refuses levels the caller doesn't hold.
  const [{ data: core, error }, { data: domains }, { data: progress }, { count: total }, { data: settings }] = await Promise.all([
    supabase.rpc("pareto_topics", { p_level: level.level }),
    supabase.from("domains").select("slug, name, icon, sort_order").order("sort_order"),
    supabase.from("topic_progress").select("topic_id, status").eq("user_id", access.user_id),
    supabase.from("topics").select("id", { count: "exact", head: true }).is("owner_id", null).lte("min_level", level.level),
    supabase.from("content_documents").select("data").eq("key", "settings").single(),
  ]);
  if (error) return <main><Nav current="pareto" isAdmin={access.is_admin} /><p className="error">Couldn&apos;t load the Pareto list.</p></main>;
  const topics = (core ?? []) as Core[];
  const status = new Map((progress ?? []).map((p) => [p.topic_id as string, p.status as Status]));
  const weight = Number(settings?.data?.progress?.in_progress_weight ?? 0.4);
  const r = readiness(topics.map((t) => status.get(t.topic_id) ?? 0), weight);
  const share = total ? Math.round((topics.length / total) * 100) : 0;

  return (
    <main>
      <Nav current="pareto" isAdmin={access.is_admin} />
      <h1>⚡ Pareto mode</h1>
      <LevelTabs held={held} current={level.level} base="/pareto" label="Pareto level" />

      <section className="card" aria-labelledby="core-h">
        <h2 id="core-h" style={{ marginTop: 0 }}>{level.icon} {level.name} core</h2>
        <p className="muted" style={{ marginTop: 0 }}>{level.description}</p>
        <p style={{ margin: "4px 0" }}><strong>{r.done}/{r.total}</strong> core topics done · <strong>{r.pct}%</strong> ready
          <span className="muted"> · {topics.length} of {total ?? 0} roadmap topics ({share}%)</span></p>
        <Bar done={r.done} inProgress={r.inProgress} total={r.total} />
        <p className="muted" style={{ marginBottom: 0 }}>These are the topics interviewers ask about most for this role. Get them solid first, then widen out on the roadmap.</p>
      </section>

      <section className="card sprint-cta" aria-labelledby="sprint-h">
        <h2 id="sprint-h" style={{ marginTop: 0 }}>Short on time? The 2-day sprint</h2>
        <p className="muted" style={{ marginTop: 0 }}>A time-blocked plan, rapid-fire flip cards, system design outlines and a guide to AI-assisted HackerRank rounds, all for {level.name}.</p>
        <div className="row">
          <Link className="btn primary" href={`/sprint/plan?level=${level.level}`}>Sprint plan</Link>
          <Link className="btn" href={`/sprint/cards?level=${level.level}`}>Flip cards</Link>
          <Link className="btn" href={`/sprint/designs?level=${level.level}`}>System designs</Link>
          <Link className="btn" href={`/sprint/hackerrank?level=${level.level}`}>HackerRank AI</Link>
        </div>
      </section>

      {(domains ?? []).map((d) => {
        const ts = topics.filter((t) => t.domain_slug === d.slug);
        if (!ts.length) return null;
        return (
          <section key={d.slug} className="card" aria-labelledby={`d-${d.slug}`}>
            <h3 id={`d-${d.slug}`} className="mod" style={{ marginTop: 0 }}>
              <span>{d.icon} {d.name}</span>
              <span className="muted">{ts.filter((t) => status.get(t.topic_id) === 2).length}/{ts.length}</span>
            </h3>
            <ul className="topics">
              {ts.map((t) => {
                const s = status.get(t.topic_id) ?? 0;
                return (
                  <li key={t.topic_id} className={`topic${s === 2 ? " done" : ""}`}>
                    <StatusDot topicId={t.topic_id} topicName={t.name} status={s} />
                    <Link href={`/topics/${t.topic_id}`} className="topic-name">{t.name}</Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
