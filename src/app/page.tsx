import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { LevelSwitch } from "@/components/LevelSwitch";

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
  const [{ data: levels }, { data: profile }, { count: unread }] = await Promise.all([
    supabase.from("levels").select("level, name, icon").order("level"),
    supabase.from("profiles").select("display_name").eq("id", access.user_id).single(),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", access.user_id).is("read_at", null),
  ]);
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
        <div className="row"><Link className="btn primary" href="/roadmap">Open your roadmap</Link><Link className="btn" href="/pareto">⚡ Pareto core</Link><Link className="btn" href="/sprint/plan">2-day sprint</Link></div>
      </div>
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
