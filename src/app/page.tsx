import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { LevelSwitch } from "@/components/LevelSwitch";
import { StudyTimer } from "@/components/StudyTimer";
import type { StudyState } from "@/app/study/actions";
import { RevisedButton } from "@/components/RevisedButton";

type Summary = {
  level: number; topics: number; pareto: number; subtopics: number; cards: number; designs: number; sprint_items: number;
  domains: { slug: string; name: string; icon: string; topics: number }[];
};

// Interim home: shows what the active level's view contains.
// The real dashboard (roadmap, progress, greeting) arrives in Milestones 4 and 10.
export default async function Home() {
  const access = await requireOnboarded();
  const supabase = await createClient();
  await supabase.rpc("touch_activity");
  const [{ data: levels }, { data: profile }, { count: unread }, { data: study }, { data: revision }] = await Promise.all([
    supabase.from("levels").select("level, name, icon").order("level"),
    supabase.from("profiles").select("display_name").eq("id", access.user_id).single(),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", access.user_id).is("read_at", null),
    supabase.rpc("study_state"),
    supabase.rpc("revision_due"),
  ]);
  const due = ((revision as { topics: { topic_id: string; name: string; days: number; state: string }[] } | null)?.topics ?? []);
  const held = (levels ?? []).filter((l) => access.levels.includes(l.level));
  const active = held.find((l) => l.level === access.active_level) ?? held[0];
  const { data: summary } = active
    ? await supabase.rpc("level_summary", { p_level: active.level })
    : { data: null };
  const s = summary as Summary | null;

  return (
    <main>
      <Nav current="home" isAdmin={access.is_admin} />
      <h1>Hi{profile?.display_name ? `, ${profile.display_name.split(" ")[0]}` : ""} 👋</h1>
      {!!unread && (
        <p className="card" role="status">🔔 You have {unread} new update{unread === 1 ? "" : "s"}. <Link href="/account">See them on your account page</Link>.</p>
      )}
      <div className="card stack">
        <p style={{ margin: 0 }}>You&apos;re preparing as <strong>{active?.icon} {active?.name}</strong>
          {access.is_admin && <> · <strong>Admin</strong></>}.</p>
        <LevelSwitch held={held} active={active?.level ?? 1} />
        <div className="row"><Link className="btn primary" href="/roadmap">Open your roadmap</Link><Link className="btn" href="/pareto">⚡ Pareto core</Link><Link className="btn" href="/sprint/plan">2-day sprint</Link><Link className="btn" href="/bookmarks">★ Bookmarks</Link></div>
      </div>
      <section className="card" aria-labelledby="rev-h">
        <h2 id="rev-h" style={{ marginTop: 0 }}>🔁 Revision due ({due.length})</h2>
        {due.length ? (
          <>
            <ul className="mini">
              {due.slice(0, 8).map((t) => (
                <li key={t.topic_id}>
                  <span><Link href={`/topics/${t.topic_id}`}>{t.name}</Link><br />
                    <span className={t.state === "overdue" ? "tag core" : "muted"}>{t.days} days since your last review{t.state === "overdue" ? " · revise now" : ""}</span></span>
                  <RevisedButton topicId={t.topic_id} topicName={t.name} />
                </li>
              ))}
            </ul>
            {due.length > 8 && <p className="muted" style={{ marginBottom: 0 }}>…and {due.length - 8} more. Start with the oldest ones.</p>}
          </>
        ) : <p className="muted" style={{ margin: 0 }}>Nothing due. Topics you finish come back here after 5 days for a quick review.</p>}
      </section>
      {study && <StudyTimer initial={study as StudyState} />}
      {s && (
        <>
          <h2>{active?.name} roadmap</h2>
          <div className="card">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li><strong>{s.topics}</strong> topics with <strong>{s.subtopics}</strong> subtopics</li>
              <li><strong>{s.pareto}</strong> Pareto core topics ({Math.round((s.pareto / Math.max(1, s.topics)) * 100)}% of the roadmap)</li>
              <li><strong>{s.cards}</strong> flip cards, <strong>{s.designs}</strong> system designs, <strong>{s.sprint_items}</strong> sprint checklist items</li>
            </ul>
          </div>
          <h2>By domain</h2>
          <div className="card">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {s.domains.map((d) => <li key={d.slug}>{d.icon} {d.name}: {d.topics} topics</li>)}
            </ul>
          </div>
          
        </>
      )}
    </main>
  );
}
