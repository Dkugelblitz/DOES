import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { describeRule } from "@/lib/game";
import { fmtDate } from "@/lib/format";
import { Nav } from "@/components/Nav";
import { GameCard, type Game } from "@/components/GameCard";

const KIND: Record<string, string> = { topic_done: "Finished a topic", revision: "Revised a topic", note: "Wrote notes", attachment: "Added a file", study_minute: "Study session" };

export default async function AchievementsPage() {
  const access = await requireOnboarded();
  const supabase = await createClient();
  const [{ data, error }, { data: doc }] = await Promise.all([
    supabase.rpc("my_game"),
    supabase.from("content_documents").select("data").eq("key", "gamification").single(),
  ]);
  if (error || !data) return <main><Nav current="insights" isAdmin={access.is_admin} /><p className="error">Couldn&apos;t load your achievements.</p></main>;
  const g = data as Game;
  const titles = (doc?.data?.levels?.titles ?? []) as { level: number; title: string; min_xp: number }[];
  const xp = doc?.data?.xp ?? {};
  const pts = (k: string) => xp[k]?.points ?? 0;

  return (
    <main>
      <Nav current="insights" isAdmin={access.is_admin} />
      <h1>🏆 Achievements</h1>
      <GameCard g={g} />

      <section className="card" aria-labelledby="badges-h">
        <h2 id="badges-h" style={{ marginTop: 0 }}>Badges</h2>
        <ul className="badges">
          {g.badges.map((b) => (
            <li key={b.id} className={b.earned_at ? "earned" : "locked"}>
              <span className="badge-icon" aria-hidden="true">{b.icon}</span>
              <strong>{b.name}</strong>
              <span className="muted">{describeRule(b.rule)}</span>
              <span className={b.earned_at ? "ok" : "muted"}>{b.earned_at ? `Earned ${fmtDate(b.earned_at)}` : "Not yet"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="ladder-h">
        <h2 id="ladder-h" style={{ marginTop: 0 }}>Levels</h2>
        <ol className="ladder">
          {titles.map((t) => (
            <li key={t.level} className={t.level === g.level ? "here" : t.level < g.level ? "past" : undefined} aria-current={t.level === g.level ? "step" : undefined}>
              <span>Level {t.level} · {t.title}</span><span className="muted">{t.min_xp} XP</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="earn-h">
        <h2 id="earn-h" style={{ marginTop: 0 }}>How you earn XP</h2>
        <ul className="mini">
          <li><span>Finish a topic (once per topic)</span><span>+{pts("topic_done")} XP</span></li>
          <li><span>Revise a topic when it&apos;s due</span><span>+{pts("revision")} XP</span></li>
          <li><span>Write notes on a topic (once per topic)</span><span>+{pts("note")} XP</span></li>
          <li><span>Add a photo or PDF to a topic (once per topic)</span><span>+{pts("attachment")} XP</span></li>
          <li><span>Each minute of a timed study session</span><span>+{pts("study_minute")} XP</span></li>
        </ul>
        <p className="muted" style={{ marginBottom: 0 }}>A streak counts any day you study, finish, revise or write notes. XP, levels and streaks are shared across all your prep levels.</p>
      </section>

      {!!g.recent.length && (
        <section className="card" aria-labelledby="recent-h">
          <h2 id="recent-h" style={{ marginTop: 0 }}>Recent XP</h2>
          <ul className="mini">
            {g.recent.map((r, i) => (
              <li key={i}><span>{KIND[r.kind] ?? r.kind}{r.ref?.minutes ? ` (${r.ref.minutes} min)` : ""}</span><span className="muted">+{r.points} XP · {fmtDate(r.at)}</span></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
