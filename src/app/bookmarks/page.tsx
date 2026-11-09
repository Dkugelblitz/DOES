import Link from "next/link";
import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { revisionState } from "@/lib/revision";
import { Nav } from "@/components/Nav";
import { StatusDot } from "@/components/StatusDot";
import { BookmarkStar } from "@/components/BookmarkStar";
import { RevisedButton } from "@/components/RevisedButton";

export default async function BookmarksPage() {
  const access = await requireOnboarded();
  const supabase = await createClient();
  const uid = access.user_id;
  const [{ data: marks }, { data: game }] = await Promise.all([
    supabase.from("bookmarks").select("topic_id, created_at").eq("user_id", uid).order("created_at", { ascending: false }),
    supabase.from("content_documents").select("data").eq("key", "gamification").single(),
  ]);
  const ids = (marks ?? []).map((m) => m.topic_id);
  // Topics are read with RLS, so bookmarks on a revoked level's topics stay saved but are hidden.
  const [{ data: topics }, { data: progress }, { data: domains }] = ids.length ? await Promise.all([
    supabase.from("topics").select("id, name, domain_slug").in("id", ids),
    supabase.from("topic_progress").select("topic_id, status, done_at, last_revised_at").eq("user_id", uid).in("topic_id", ids),
    supabase.from("domains").select("slug, name, icon"),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const rv = game?.data?.revision ?? {};
  const rows = ids.map((id) => topics?.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t).map((t) => {
    const p = progress?.find((x) => x.topic_id === t.id);
    return { t, status: (p?.status ?? 0) as number, rev: revisionState({ status: p?.status ?? 0, doneAt: p?.done_at ?? null, lastRevisedAt: p?.last_revised_at ?? null, due: rv.due_after_days, overdue: rv.overdue_after_days }) };
  });
  const dom = (slug: string) => domains?.find((d) => d.slug === slug);

  return (
    <main>
      <Nav current="home" isAdmin={access.is_admin} />
      <h1>★ Bookmarks</h1>
      <p className="muted">Topics you&apos;ve starred for later revision. Tap ☆ on any topic to add it here.</p>
      {rows.length ? (
        <section className="card">
          <ul className="topics">
            {rows.map(({ t, status, rev }) => (
              <li key={t.id} className={`topic${status === 2 ? " done" : ""}`}>
                <StatusDot topicId={t.id} topicName={t.name} status={status} />
                <span className="topic-name">
                  <Link href={`/topics/${t.id}`}>{t.name}</Link>
                  <br /><span className="muted">{dom(t.domain_slug)?.icon} {dom(t.domain_slug)?.name}
                    {rev.state === "due" && " · revise soon"}{rev.state === "overdue" && " · revise now"}</span>
                </span>
                {(rev.state === "due" || rev.state === "overdue") && <RevisedButton topicId={t.id} topicName={t.name} />}
                <BookmarkStar topicId={t.id} topicName={t.name} on />
              </li>
            ))}
          </ul>
        </section>
      ) : <p className="card muted">No bookmarks yet. Open the <Link href="/roadmap">roadmap</Link> and tap ☆ next to any topic.</p>}
    </main>
  );
}
