import Link from "next/link";
import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { Nav } from "@/components/Nav";
import { BarList, ColumnChart } from "@/components/charts";
import { StudyTimer } from "@/components/StudyTimer";
import type { StudyState } from "@/app/study/actions";

type Insights = {
  timezone: string; days: { day: string; minutes: number }[]; buckets: Record<"morning" | "afternoon" | "evening" | "night", number>;
  sessions: number; total_minutes: number; avg_minutes: number; longest_minutes: number; topics_done: number; topics_studied: number;
  recent: { started_at: string; minutes: number; topic_id: string | null; topic_name: string | null }[];
};

const BUCKETS = [
  ["morning", "Morning", "Morning (5am–noon)"], ["afternoon", "Afternoon", "Afternoon (noon–5pm)"],
  ["evening", "Evening", "Evening (5–10pm)"], ["night", "Night", "Night (10pm–5am)"],
] as const;

export default async function InsightsPage() {
  const access = await requireOnboarded();
  const supabase = await createClient();
  const [{ data, error }, { data: state }] = await Promise.all([supabase.rpc("my_insights"), supabase.rpc("study_state")]);
  if (error || !data) return <main><Nav current="insights" isAdmin={access.is_admin} /><p className="error">Couldn&apos;t load your insights.</p></main>;
  const i = data as Insights;
  const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const week = i.days.reduce((s, d) => s + d.minutes, 0);
  const best = [...BUCKETS].sort((a, b) => i.buckets[b[0]] - i.buckets[a[0]])[0];
  const hrs = (m: number) => (m / 60).toFixed(1);

  return (
    <main>
      <Nav current="insights" isAdmin={access.is_admin} />
      <h1>📈 Study insights</h1>
      <StudyTimer initial={state as StudyState} />

      <div className="grid-tiles">
        <div className="tile"><b>{hrs(i.total_minutes)}h</b><span>total study time</span></div>
        <div className="tile"><b>{hrs(week)}h</b><span>last 7 days</span></div>
        <div className="tile"><b>{i.sessions}</b><span>sessions</span></div>
        <div className="tile"><b>{i.avg_minutes}m</b><span>average session</span></div>
        <div className="tile"><b>{i.topics_done}</b><span>topics done</span></div>
        <div className="tile"><b>{i.topics_studied}</b><span>topics timed</span></div>
      </div>

      <section className="card" aria-labelledby="wk-h">
        <h2 id="wk-h" style={{ marginTop: 0 }}>Minutes studied, last 7 days</h2>
        <ColumnChart title="Minutes studied per day, last 7 days" unit="min"
          points={i.days.map((d) => ({ label: day(d.day, { weekday: "short" }), full: day(d.day, { weekday: "short", day: "numeric", month: "short" }), value: d.minutes }))} />
        <p className="muted" style={{ marginBottom: 0 }}>{week ? `${week} minutes this week. Small, steady sessions beat last-minute cramming.` : "Start a session and your week fills in here."}</p>
      </section>

      <section className="card" aria-labelledby="tod-h">
        <h2 id="tod-h" style={{ marginTop: 0 }}>When you study</h2>
        <BarList title="Minutes studied by time of day" unit="min" points={BUCKETS.map(([k, label, full]) => ({ label, full, value: i.buckets[k] }))} />
        <p className="muted" style={{ marginBottom: 0 }}>
          {i.total_minutes ? `Your peak window is the ${best[1].toLowerCase()}. Try to protect that time for the hardest topics.` : "Log a session to see your pattern."} Times are in {i.timezone}.
        </p>
      </section>

      <section className="card" aria-labelledby="rc-h">
        <h2 id="rc-h" style={{ marginTop: 0 }}>Recent sessions</h2>
        {i.recent.length ? (
          <ul className="mini">
            {i.recent.map((s) => (
              <li key={s.started_at}>
                <span>{fmtDateTime(s.started_at, i.timezone)} · {s.topic_id ? <Link href={`/topics/${s.topic_id}`}>{s.topic_name}</Link> : "general study"}</span>
                <span className="muted">{s.minutes} min</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ margin: 0 }}>No sessions yet.</p>}
      </section>
    </main>
  );
}
