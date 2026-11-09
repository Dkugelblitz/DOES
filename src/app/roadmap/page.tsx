import Link from "next/link";
import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadRoadmap } from "@/lib/roadmap";
import { eta } from "@/lib/progress";
import { Nav } from "@/components/Nav";
import { Bar } from "@/components/Bar";
import { StatusDot } from "@/components/StatusDot";
import { BookmarkStar } from "@/components/BookmarkStar";
import { LevelSwitch } from "@/components/LevelSwitch";
import { StudySettings } from "./StudySettings";

export default async function RoadmapPage({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  const access = await requireOnboarded();
  const supabase = await createClient();
  const { data: levels } = await supabase.from("levels").select("level, name, icon").order("level");
  const held = (levels ?? []).filter((l) => access.levels.includes(l.level));
  const active = held.find((l) => l.level === access.active_level) ?? held[0];
  const r = await loadRoadmap(access.user_id, active.level);
  const { domain } = await searchParams;
  const cur = r.domains.find((d) => d.slug === domain) ?? r.domains[0];

  const p = r.profile;
  const e = eta({
    readiness: r.overall, hoursPerTopic: Number(p.hours_per_topic), hoursPerDay: Number(p.hours_per_day),
    inProgressWeight: r.weight, interviewDate: p.interview_date, timeZone: p.timezone,
  });
  const curTopics = r.topics.filter((t) => t.domain_slug === cur?.slug);
  const curModules = r.modules.filter((m) => m.domain_slug === cur?.slug && curTopics.some((t) => t.module_slug === m.slug));

  return (
    <main>
      <Nav current="roadmap" isAdmin={access.is_admin} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{active.icon} {active.name} roadmap</h1>
        <Link className="btn" href={`/notes?level=${active.level}`}>📚 Study summary</Link>
        <LevelSwitch held={held} active={active.level} />
      </div>

      <section className="card hero" aria-label="Overall readiness">
        <div>
          <div className="big">{r.overall.pct}%</div>
          <div className="muted">overall readiness</div>
        </div>
        <dl className="stats">
          <div><dt>topics done</dt><dd>{r.overall.done}/{r.overall.total}</dd></div>
          <div><dt>in progress</dt><dd>{r.overall.inProgress}</dd></div>
          <div><dt>not started</dt><dd>{r.overall.notStarted}</dd></div>
        </dl>
        <div style={{ flexBasis: "100%" }}><Bar done={r.overall.done} inProgress={r.overall.inProgress} total={r.overall.total} /></div>
      </section>

      <section className="card" aria-labelledby="plan-h">
        <h2 id="plan-h" style={{ marginTop: 0 }}>Your plan</h2>
        <p aria-live="polite">{etaText(e, Number(p.hours_per_day))}</p>
        <StudySettings hoursPerTopic={Number(p.hours_per_topic)} hoursPerDay={Number(p.hours_per_day)} interviewDate={p.interview_date} />
      </section>

      <h2>Domains</h2>
      <nav className="domains" aria-label="Domains">
        {r.domains.map((d) => {
          const k = r.byDomain.get(d.slug)!;
          return (
            <Link key={d.slug} href={`/roadmap?domain=${d.slug}`} className={`domain${d.slug === cur?.slug ? " on" : ""}`}
              aria-current={d.slug === cur?.slug ? "true" : undefined}>
              <span>{d.icon} <strong>{d.name}</strong></span>
              <span className="muted">{k.done}/{k.total} done · {k.pct}%</span>
              <Bar done={k.done} inProgress={k.inProgress} total={k.total} />
            </Link>
          );
        })}
      </nav>

      {cur && (
        <section className="card" aria-labelledby="dom-h">
          <h2 id="dom-h" style={{ marginTop: 0 }}>{cur.icon} {cur.name}</h2>
          {curModules.map((m) => {
            const ts = curTopics.filter((t) => t.module_slug === m.slug);
            return (
              <div key={m.slug}>
                <h3 className="mod"><span>{m.name}</span><span className="muted">{ts.filter((t) => t.status === 2).length}/{ts.length}</span></h3>
                <ul className="topics">
                  {ts.map((t) => (
                    <li key={t.id} className={`topic${t.status === 2 ? " done" : ""}`}>
                      <StatusDot topicId={t.id} topicName={t.name} status={t.status} />
                      <Link href={`/topics/${t.id}`} className="topic-name">{t.name}</Link>
                      <span className="meta">
                        {t.revision === "due" && <span className="tag">revise soon</span>}
                        {t.revision === "overdue" && <span className="tag core">revise now</span>}
                        {t.core && <span className="tag" title="Pareto core for this level">core</span>}
                        {t.subTotal > 0 && <span>{t.subDone}/{t.subTotal}</span>}
                      </span>
                      <BookmarkStar topicId={t.id} topicName={t.name} on={t.bookmarked} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}

function etaText(e: ReturnType<typeof eta>, hpd: number): string {
  const hrs = Math.round(e.hoursRemaining);
  if (e.status === "complete") return "Every topic on this roadmap is done. Now it's all revision and mock practice. 🎉";
  const base = `About ${hrs} study hours left, roughly ${e.daysAtCurrentPace} days at ${hpd}h a day.`;
  switch (e.status) {
    case "no_date": return `${base} Add your interview date to see if you're on pace.`;
    case "today": return `${base} Your interview is today. Focus on the Pareto core and your strongest stories. You've got this.`;
    case "passed": return `${base} Your interview date has passed. Set a new one when you know it.`;
    case "on_track": return `${base} ${e.daysToInterview} days to your interview, needing ${e.hoursPerDayNeeded}h a day. You're on track.`;
    case "behind": return `${base} ${e.daysToInterview} days to your interview would need ${e.hoursPerDayNeeded}h a day. Lean on the Pareto core topics to close the gap.`;
  }
}
