import Link from "next/link";
import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { viewLevel } from "@/lib/levels";
import { LevelTabs } from "@/components/LevelTabs";

type Framework = { total_minutes: number; steps: { step: string; minutes: number }[] };

export default async function SprintDesigns({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const access = await requireOnboarded();
  const { held, level } = await viewLevel(access, (await searchParams).level);
  const supabase = await createClient();
  const [{ data: designs }, { data: fw }, { data: topics }] = await Promise.all([
    supabase.from("designs").select("id, title, min_level, points, topic_ids, sort_order").lte("min_level", level.level).order("sort_order"),
    supabase.from("content_documents").select("data").eq("key", "design_framework").maybeSingle(),
    supabase.from("topics").select("id, name").is("owner_id", null).lte("min_level", level.level),
  ]);
  const f = fw?.data as Framework | undefined;
  const topicName = new Map((topics ?? []).map((t) => [t.id, t.name]));

  return (
    <>
      <LevelTabs held={held} current={level.level} base="/sprint/designs" label="Design level" />
      {f && (
        <section className="card" aria-labelledby="fw-h">
          <h2 id="fw-h" style={{ marginTop: 0 }}>Answer framework ({f.total_minutes} min)</h2>
          <ol className="steps">
            {f.steps.map((s) => <li key={s.step}><span>{s.step}</span><span className="muted">{s.minutes} min</span></li>)}
          </ol>
        </section>
      )}
      {(designs ?? []).map((d) => (
        <section key={d.id} className="card" aria-labelledby={`ds-${d.id}`}>
          <h2 id={`ds-${d.id}`} style={{ marginTop: 0 }}>{d.title}</h2>
          <ul>{(d.points as string[]).map((p) => <li key={p}>{p}</li>)}</ul>
          {(d.topic_ids as string[]).some((t) => topicName.has(t)) && (
            <p className="muted" style={{ marginBottom: 0 }}>Related: {(d.topic_ids as string[]).filter((t) => topicName.has(t)).map((t, i) => (
              <span key={t}>{i > 0 && " · "}<Link href={`/topics/${t}`}>{topicName.get(t)}</Link></span>
            ))}</p>
          )}
        </section>
      ))}
      {held.some((l) => l.level > level.level) ? null : level.level < 3 && (
        <p className="muted">More architect-level designs (real-time platforms, enterprise RAG, multi-tenant governance) come with the Data Architect level. You can request it from your Account page.</p>
      )}
    </>
  );
}
