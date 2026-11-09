import Link from "next/link";

export type Game = {
  xp: number; level: number; max_level: number; title: string; level_floor_xp: number; next_level_xp: number | null; next_title: string | null;
  streak: number; longest_streak: number; active_today: boolean;
  stats: { topics_done: number; notes: number; revisions: number; study_minutes: number };
  badges: { id: string; name: string; icon: string; rule: { type: string; gte?: number; from?: number; to?: number }; earned_at: string | null }[];
  recent: { kind: string; points: number; ref: Record<string, unknown>; at: string }[];
};

/** Level, XP to the next level, streak and badge count. Encouraging, never guilt-inducing. */
export function GameCard({ g }: { g: Game }) {
  const span = g.next_level_xp === null ? 1 : g.next_level_xp - g.level_floor_xp;
  const pct = g.next_level_xp === null ? 100 : Math.round(((g.xp - g.level_floor_xp) / span) * 100);
  const earned = g.badges.filter((b) => b.earned_at);
  const streakText = g.streak === 0
    ? "Today is a great day to start a streak."
    : g.active_today ? `${g.streak}-day streak. Nicely kept going.` : `${g.streak}-day streak. Any study today keeps it going.`;
  return (
    <section className="card" aria-labelledby="game-h">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="game-h" style={{ margin: 0 }}>Level {g.level} · {g.title}</h2>
        <span className="streak" aria-label={`${g.streak} day streak`}>🔥 {g.streak}</span>
      </div>
      <div className="xpbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-label={g.next_level_xp === null ? "Top level reached" : `${pct}% of the way to level ${g.level + 1}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="muted" style={{ margin: "6px 0 0" }}>
        {g.xp} XP{g.next_level_xp !== null ? ` · ${g.next_level_xp - g.xp} XP to ${g.next_title}` : " · top level reached 🏆"}
      </p>
      <p style={{ margin: "8px 0 0" }}>{streakText}</p>
      <p style={{ margin: "8px 0 0" }}>
        <span aria-hidden="true">{earned.slice(-6).map((b) => b.icon).join(" ")}</span>{" "}
        <Link href="/achievements">{earned.length} of {g.badges.length} badges</Link>
      </p>
    </section>
  );
}
