import Link from "next/link";
import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { viewLevel } from "@/lib/levels";
import { fmtDate } from "@/lib/format";

type HR = { title: string; disclaimer: string; last_reviewed: string | null; sections: { id: string; title: string; body: string }[]; related_topics: string[] };

export default async function SprintHackerRank({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const access = await requireOnboarded();
  await viewLevel(access, (await searchParams).level);
  const supabase = await createClient();
  const [{ data: doc }, { data: topics }] = await Promise.all([
    supabase.from("content_documents").select("data, updated_at").eq("key", "hackerrank").maybeSingle(),
    supabase.from("topics").select("id, name").eq("domain_slug", "hackerrank-ai-era").order("sort_order"),
  ]);
  const hr = doc?.data as HR | undefined;
  if (!hr) return <p className="card muted">This guide isn&apos;t available yet.</p>;

  return (
    <>
      <h2>{hr.title}</h2>
      {hr.sections.map((s) => (
        <section key={s.id} className="card" aria-labelledby={`hr-${s.id}`}>
          <h3 id={`hr-${s.id}`} style={{ marginTop: 0 }}>{s.title}</h3>
          <p style={{ marginBottom: 0 }}>{s.body}</p>
        </section>
      ))}
      {!!topics?.length && (
        <section className="card" aria-labelledby="hr-topics">
          <h3 id="hr-topics" style={{ marginTop: 0 }}>Practise these topics</h3>
          <ul className="mini">{topics.map((t) => <li key={t.id}><Link href={`/topics/${t.id}`}>{t.name}</Link></li>)}</ul>
        </section>
      )}
      <p className="muted">{hr.disclaimer} {hr.last_reviewed ? `Last reviewed ${fmtDate(hr.last_reviewed)}.` : `Content updated ${fmtDate(doc?.updated_at)}.`} The format changes often, so admins can update this page without a code change.</p>
    </>
  );
}
