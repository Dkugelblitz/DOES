import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { TopicControls } from "./TopicControls";
import { StudyTimer } from "@/components/StudyTimer";
import type { StudyState } from "@/app/study/actions";

const SLUG = /^[a-z0-9-]+$/;

export default async function TopicPage({ params }: { params: Promise<{ domain: string; slug: string }> }) {
  const access = await requireOnboarded();
  const { domain, slug } = await params;
  if (!SLUG.test(domain) || !SLUG.test(slug)) notFound();
  const id = `${domain}/${slug}`;
  const supabase = await createClient();

  // RLS returns nothing for topics above the caller's levels, so they get a plain 404.
  const { data: topic } = await supabase.from("topics")
    .select("id, name, domain_slug, module_slug, min_level").eq("id", id).maybeSingle();
  if (!topic) notFound();

  const [{ data: dom }, { data: mod }, { data: subs }, { data: prog }, { data: subProg }, { data: flags }, { data: levels }, { data: study }] = await Promise.all([
    supabase.from("domains").select("name, icon").eq("slug", topic.domain_slug).single(),
    supabase.from("modules").select("name").eq("domain_slug", topic.domain_slug).eq("slug", topic.module_slug).single(),
    supabase.from("subtopics").select("id, name, sort_order").eq("topic_id", id).order("sort_order"),
    supabase.from("topic_progress").select("status").eq("user_id", access.user_id).eq("topic_id", id).maybeSingle(),
    supabase.from("subtopic_progress").select("subtopic_id").eq("user_id", access.user_id).eq("done", true).like("subtopic_id", `${id}#%`),
    supabase.rpc("my_topic_flags"),
    supabase.from("levels").select("level, name"),
    supabase.rpc("study_state"),
  ]);
  const done = new Set((subProg ?? []).map((s) => s.subtopic_id));
  const core: number[] = (flags ?? []).find((f: { topic_id: string }) => f.topic_id === id)?.pareto_levels ?? [];
  const levelName = (n: number) => levels?.find((l) => l.level === n)?.name ?? `Level ${n}`;

  return (
    <main>
      <Nav current="roadmap" isAdmin={access.is_admin} />
      <p className="muted"><Link href={`/roadmap?domain=${topic.domain_slug}`}>← {dom?.icon} {dom?.name}</Link> · {mod?.name}</p>
      <h1>{topic.name}</h1>
      <div className="row">
        <span className="tag">{levelName(topic.min_level)} and up</span>
        {core.map((l) => <span key={l} className="tag core">Core for {levelName(l)}</span>)}
      </div>
      <div className="card">
        <TopicControls topicId={id} status={prog?.status ?? 0}
          subtopics={(subs ?? []).map((s) => ({ id: s.id, name: s.name, done: done.has(s.id) }))} />
      </div>
      {study && <StudyTimer initial={study as StudyState} topicId={id} topicName={topic.name} />}
      <p className="muted">Notes, photos, saved links and the auto summary for this topic arrive in Milestone 7.</p>
    </main>
  );
}
