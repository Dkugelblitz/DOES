import Link from "next/link";
import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { greeting, localHour, type Messages } from "@/lib/messages";
import { Nav } from "@/components/Nav";
import { LevelSwitch } from "@/components/LevelSwitch";
import { StudyTimer } from "@/components/StudyTimer";
import { RevisedButton } from "@/components/RevisedButton";
import { GameCard, type Game } from "@/components/GameCard";
import type { StudyState } from "@/app/study/actions";

type Due = { topic_id: string; name: string; days: number; state: string };
type Summary = { topics: number; pareto: number; cards: number; designs: number; sprint_items: number };

export default async function Home() {
  const access = await requireOnboarded();
  const supabase = await createClient();
  await supabase.rpc("touch_activity");
  const [{ data: levels }, { data: profile }, { count: unread }, { data: study }, { data: revision }, { data: game }, { data: msgs }] = await Promise.all([
    supabase.from("levels").select("level, name, icon").order("level"),
    supabase.from("profiles").select("display_name, timezone").eq("id", access.user_id).single(),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", access.user_id).is("read_at", null),
    supabase.rpc("study_state"),
    supabase.rpc("revision_due"),
    supabase.rpc("my_game"),
    supabase.from("content_documents").select("data").eq("key", "messages").single(),
  ]);
  const held = (levels ?? []).filter((l) => access.levels.includes(l.level));
  const active = held.find((l) => l.level === access.active_level) ?? held[0];
  const [{ data: next }, { data: summary }] = await Promise.all([
    supabase.rpc("my_next_topic", { p_level: active.level }),
    supabase.rpc("level_summary", { p_level: active.level }),
  ]);
  const due = ((revision as { topics: Due[] } | null)?.topics ?? []);
  const g = game as Game | null;
  const s = summary as Summary | null;
  const nextTopic = next as { topic_id: string; name: string; core: boolean } | null;
  const hello = msgs?.data
    ? greeting(msgs.data as Messages, {
        name: profile?.display_name ?? null, hour: localHour(new Date(), profile?.timezone ?? "UTC"),
        streak: g?.streak ?? 0, dueCount: due.length, nextTopic: nextTopic?.name ?? null, levelName: active.name,
      })
    : null;

  return (
    <main id="main">
      <Nav current="home" isAdmin={access.is_admin} />
      {hello && (
        <section className="card greeting" aria-labelledby="hello-h">
          <h1 id="hello-h" style={{ marginTop: 0 }}>{hello.headline}</h1>
          {hello.lines.map((l) => <p key={l} style={{ margin: "4px 0" }}>{l}</p>)}
          {nextTopic && (
            <p style={{ margin: "10px 0 0" }}>
              <Link className="btn primary" href={`/topics/${nextTopic.topic_id}`}>Start {nextTopic.name}</Link>
            </p>
          )}
          <p className="muted" style={{ margin: "10px 0 0" }}>{hello.footer}{access.is_admin && " · Admin"}</p>
        </section>
      )}
      {!!unread && (
        <p className="card" role="status">🔔 You have {unread} new update{unread === 1 ? "" : "s"}. <Link href="/account">See them on your account page</Link>.</p>
      )}
      {g && <GameCard g={g} />}

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

      <section className="card stack" aria-labelledby="go-h">
        <h2 id="go-h" style={{ margin: 0 }}>{active.icon} {active.name}</h2>
        {s && <p className="muted" style={{ margin: 0 }}>{s.topics} topics on your roadmap, {s.pareto} of them Pareto core · {s.cards} flip cards · {s.designs} system design{s.designs === 1 ? "" : "s"} · {s.sprint_items} sprint items</p>}
        <LevelSwitch held={held} active={active.level} />
        <div className="row">
          <Link className="btn primary" href="/roadmap">Roadmap</Link>
          <Link className="btn" href="/pareto">⚡ Pareto core</Link>
          <Link className="btn" href="/sprint/plan">2-day sprint</Link>
          <Link className="btn" href="/bookmarks">★ Bookmarks</Link>
          <Link className="btn" href="/notes">📚 Study summary</Link>
        </div>
      </section>
    </main>
  );
}
