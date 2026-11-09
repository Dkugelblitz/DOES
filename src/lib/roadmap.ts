import "server-only";
import { createClient } from "@/lib/supabase/server";
import { readiness, type Readiness, type Status } from "@/lib/progress";
import { revisionState, type RevisionState } from "@/lib/revision";

export type Domain = { slug: string; name: string; icon: string; sort_order: number };
export type Module = { domain_slug: string; slug: string; name: string; sort_order: number };
export type Topic = { id: string; domain_slug: string; module_slug: string; slug: string; name: string; sort_order: number; min_level: number };
export type TopicRow = Topic & { status: Status; subDone: number; subTotal: number; core: boolean; revision: RevisionState; bookmarked: boolean };
export type Profile = { display_name: string | null; timezone: string; hours_per_topic: number; hours_per_day: number; interview_date: string | null };

/**
 * Everything the roadmap needs for one level's view. RLS already limits rows to the caller's
 * held levels; this narrows the view to `level` (min_level <= level).
 */
export async function loadRoadmap(userId: string, level: number) {
  const supabase = await createClient();
  const [domains, modules, topics, subtopics, progress, subProgress, flags, profile, settings, bookmarks, game] = await Promise.all([
    supabase.from("domains").select("slug, name, icon, sort_order").order("sort_order"),
    supabase.from("modules").select("domain_slug, slug, name, sort_order").order("sort_order"),
    supabase.from("topics").select("id, domain_slug, module_slug, slug, name, sort_order, min_level")
      .is("owner_id", null).lte("min_level", level).order("sort_order"),
    supabase.from("subtopics").select("id, topic_id").range(0, 4999),
    supabase.from("topic_progress").select("topic_id, status, done_at, last_revised_at").eq("user_id", userId),
    supabase.from("subtopic_progress").select("subtopic_id").eq("user_id", userId).eq("done", true).range(0, 4999),
    supabase.rpc("my_topic_flags"),
    supabase.from("profiles").select("display_name, timezone, hours_per_topic, hours_per_day, interview_date").eq("id", userId).single(),
    supabase.from("content_documents").select("data").eq("key", "settings").single(),
    supabase.from("bookmarks").select("topic_id").eq("user_id", userId),
    supabase.from("content_documents").select("data").eq("key", "gamification").single(),
  ]);
  const err = [domains, modules, topics, subtopics, progress, subProgress, flags, profile].find((r) => r.error)?.error;
  if (err) throw new Error(`Could not load roadmap: ${err.message}`);

  const statusOf = new Map<string, Status>((progress.data ?? []).map((p) => [p.topic_id, p.status as Status]));
  const progOf = new Map((progress.data ?? []).map((p) => [p.topic_id as string, p]));
  const starred = new Set((bookmarks.data ?? []).map((b) => b.topic_id as string));
  const rev = game.data?.data?.revision ?? {};
  const now = new Date();
  const doneSubs = new Set((subProgress.data ?? []).map((s) => s.subtopic_id as string));
  const subCounts = new Map<string, { done: number; total: number }>();
  for (const s of subtopics.data ?? []) {
    const c = subCounts.get(s.topic_id) ?? { done: 0, total: 0 };
    c.total++; if (doneSubs.has(s.id)) c.done++;
    subCounts.set(s.topic_id, c);
  }
  const coreFor = new Map<string, number[]>((flags.data ?? []).map((f: { topic_id: string; pareto_levels: number[] }) => [f.topic_id, f.pareto_levels]));
  const rows: TopicRow[] = (topics.data ?? []).map((t) => ({
    ...(t as Topic),
    status: statusOf.get(t.id) ?? 0,
    subDone: subCounts.get(t.id)?.done ?? 0,
    subTotal: subCounts.get(t.id)?.total ?? 0,
    core: (coreFor.get(t.id) ?? []).includes(level),
    revision: revisionState({ status: statusOf.get(t.id) ?? 0, doneAt: progOf.get(t.id)?.done_at ?? null, lastRevisedAt: progOf.get(t.id)?.last_revised_at ?? null,
      now, due: rev.due_after_days, overdue: rev.overdue_after_days }).state,
    bookmarked: starred.has(t.id),
  }));

  const weight = Number(settings.data?.data?.progress?.in_progress_weight ?? 0.4);
  const domainList = (domains.data ?? []) as Domain[];
  const byDomain = new Map<string, Readiness>(domainList.map((d) => [d.slug, readiness(rows.filter((r) => r.domain_slug === d.slug).map((r) => r.status), weight)]));
  return {
    domains: domainList.filter((d) => (byDomain.get(d.slug)?.total ?? 0) > 0),
    modules: (modules.data ?? []) as Module[],
    topics: rows,
    overall: readiness(rows.map((r) => r.status), weight),
    byDomain,
    weight,
    profile: profile.data as Profile,
  };
}
