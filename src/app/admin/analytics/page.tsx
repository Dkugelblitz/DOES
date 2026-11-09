import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { BarList, ColumnChart } from "@/components/charts";

type A = {
  weeks: { week: string; active_users: number; study_minutes: number }[];
  avg_session_minutes: number; avg_weekly_minutes_per_active_user: number;
  level_distribution: { level: number; name: string; granted: number; active: number }[];
  most_bookmarked: { topic_id: string; name: string; n: number }[];
  least_completed: { topic_id: string; name: string; min_level: number; done: number }[];
  revision: { done_on_time_30d: number; currently_due: number; rate: number | null };
};

export default async function AdminAnalytics() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_analytics");
  if (error || !data) return <p className="error">Couldn&apos;t load analytics.</p>;
  const a = data as A;
  const wk = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const points = (k: "active_users" | "study_minutes") => a.weeks.map((w) => ({ label: wk(w.week), full: `Week of ${wk(w.week)}`, value: w[k] }));
  const pct = a.revision.rate === null ? "–" : `${Math.round(a.revision.rate * 100)}%`;

  return (
    <>
      <p className="muted">Aggregates across all users. Private notes, links and files are never included.</p>
      <div className="grid-tiles">
        <div className="tile"><b>{a.weeks.at(-1)?.active_users ?? 0}</b><span>active this week</span></div>
        <div className="tile"><b>{a.avg_session_minutes}m</b><span>average study session</span></div>
        <div className="tile"><b>{a.avg_weekly_minutes_per_active_user}m</b><span>weekly study per active user (last 4 weeks)</span></div>
        <div className="tile"><b>{pct}</b><span>revisions done on time (30 days)</span></div>
      </div>

      <section className="card" aria-labelledby="au-h">
        <h2 id="au-h" style={{ marginTop: 0 }}>Active users per week</h2>
        <ColumnChart title="Active users per week, last 8 weeks" unit="users" points={points("active_users")} />
      </section>
      <section className="card" aria-labelledby="sm-h">
        <h2 id="sm-h" style={{ marginTop: 0 }}>Study minutes per week</h2>
        <ColumnChart title="Total study minutes per week, last 8 weeks" unit="min" points={points("study_minutes")} />
      </section>
      <section className="card" aria-labelledby="ld-h">
        <h2 id="ld-h" style={{ marginTop: 0 }}>Users by level</h2>
        <BarList title="Users holding each level" unit="users" points={a.level_distribution.map((l) => ({ label: l.name.replace(" Data Engineer", " DE").replace("Data ", ""), full: l.name, value: l.granted }))} />
        <p className="muted" style={{ marginBottom: 0 }}>Holding the level (granted). Admins hold every level automatically and are counted only where granted.</p>
      </section>
      <section className="card" aria-labelledby="rv-h">
        <h2 id="rv-h" style={{ marginTop: 0 }}>Revision</h2>
        <p style={{ margin: 0 }}>{a.revision.done_on_time_30d} due revisions done in the last 30 days; {a.revision.currently_due} topics are due right now across all users.
          The on-time rate is done ÷ (done + currently due).</p>
      </section>
      <div className="progress-grid">
        <section className="card" aria-labelledby="mb-h">
          <h2 id="mb-h" style={{ marginTop: 0 }}>Most bookmarked topics</h2>
          {a.most_bookmarked.length ? (
            <ol className="mini">{a.most_bookmarked.map((t) => <li key={t.topic_id}><Link href={`/topics/${t.topic_id}`}>{t.name}</Link><span className="muted">{t.n}</span></li>)}</ol>
          ) : <p className="muted">No bookmarks yet.</p>}
        </section>
        <section className="card" aria-labelledby="lc-h">
          <h2 id="lc-h" style={{ marginTop: 0 }}>Least completed topics</h2>
          <ol className="mini">{a.least_completed.map((t) => <li key={t.topic_id}><Link href={`/topics/${t.topic_id}`}>{t.name}</Link><span className="muted">{t.done} done</span></li>)}</ol>
        </section>
      </div>
    </>
  );
}
