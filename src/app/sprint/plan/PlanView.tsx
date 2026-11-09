"use client";
import { useState, useTransition } from "react";
import { setSprintItem } from "../actions";

export type PlanDay = { day: number; title: string; blocks: { id: string; title: string; minutes: number; items: { id: string; text: string }[] }[] };

/** The time-blocked plan with checklists. Progress and hours left update as items are ticked. */
export function PlanView({ days, initialDone }: { days: PlanDay[]; initialDone: string[] }) {
  const [done, setDone] = useState(() => new Set(initialDone));
  const [error, setError] = useState(false);
  const [, start] = useTransition();

  const all = days.flatMap((d) => d.blocks.flatMap((b) => b.items));
  const doneCount = all.filter((i) => done.has(i.id)).length;
  const minutesLeft = days.flatMap((d) => d.blocks).reduce((m, b) => m + b.minutes * (1 - b.items.filter((i) => done.has(i.id)).length / Math.max(1, b.items.length)), 0);
  const pct = all.length ? Math.round((doneCount / all.length) * 100) : 0;

  const toggle = (id: string, on: boolean) => {
    setDone((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
    start(async () => {
      const r = await setSprintItem(id, on);
      if (!r.ok) { setError(true); setDone((s) => { const n = new Set(s); if (on) n.delete(id); else n.add(id); return n; }); }
      else setError(false);
    });
  };

  return (
    <>
      <section className="card" aria-label="Sprint progress">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{pct}% of the sprint done</strong>
          <span className="muted">≈ {(minutesLeft / 60).toFixed(1)} hours left</span>
        </div>
        <div className="bar" aria-hidden="true"><i className="bar-done" style={{ width: `${pct}%` }} /></div>
        <div role="status" aria-live="polite">{error && <p className="error">Couldn&apos;t save that tick. Please try again.</p>}</div>
      </section>
      {days.map((d) => (
        <section key={d.day} aria-labelledby={`day-${d.day}`}>
          <h2 id={`day-${d.day}`}>{d.title}</h2>
          {d.blocks.map((b) => {
            const n = b.items.filter((i) => done.has(i.id)).length;
            return (
              <div key={b.id} className="card">
                <h3 className="mod" style={{ marginTop: 0 }}>
                  <span>{b.title}</span>
                  <span className="muted">{b.minutes} min · {n}/{b.items.length}</span>
                </h3>
                {b.items.map((i) => (
                  <label key={i.id} className="sub">
                    <input type="checkbox" checked={done.has(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} />
                    <span className={done.has(i.id) ? "struck" : undefined}>{i.text}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
