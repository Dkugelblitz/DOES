"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { heartbeatStudy, startStudy, stopStudy, type StudyState } from "@/app/study/actions";

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
};

/**
 * Study timer. The server records start time and duration; this only displays the elapsed
 * time and sends a heartbeat every minute (and when the tab is hidden or closed), so a closed
 * tab or a sleeping laptop is saved up to its last heartbeat.
 */
export function StudyTimer({ initial, topicId = null, topicName = null }: { initial: StudyState; topicId?: string | null; topicName?: string | null }) {
  const [state, setState] = useState(initial);
  const [skew, setSkew] = useState(() => Date.parse(initial.server_now) - Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<StudyState | null>(null);
  const [pending, start] = useTransition();
  const running = state.running;
  const runningRef = useRef(running);
  runningRef.current = running;

  const apply = (s: StudyState) => {
    if (s.error) { setNote(s.error); return; }
    setState(s); setSkew(Date.parse(s.server_now) - Date.now());
    if (s.auto_saved_minutes) setNote(`Your last session was saved automatically (${s.auto_saved_minutes} min).`);
  };

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!running) return;
    const beat = setInterval(() => { heartbeatStudy().then(apply); }, 60_000);
    const beacon = () => { if (runningRef.current) navigator.sendBeacon?.("/api/study/heartbeat"); };
    const onVis = () => { if (document.visibilityState === "hidden") beacon(); else heartbeatStudy().then(apply); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", beacon);
    return () => { clearInterval(beat); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", beacon); };
  }, [running?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const elapsed = running ? now + skew - Date.parse(running.started_at) : 0;
  const todayMin = state.today_minutes + (running ? Math.floor(elapsed / 60000) : 0);
  const otherTopic = running && topicId && running.topic_id !== topicId;

  const doStart = () => start(async () => { setNote(null); setSummary(null); apply(await startStudy(topicId)); });
  const doStop = (finish: boolean) => start(async () => {
    const r = await stopStudy();
    apply(r);
    if (!r.error) {
      if (finish) setSummary(r);
      else setNote(r.saved_minutes ? `Saved ${r.saved_minutes} min. Nice focus.` : "Paused. Sessions under a minute aren't counted.");
    }
  });
  const doSwitch = () => start(async () => { await stopStudy(); apply(await startStudy(topicId)); setNote(`Now timing ${topicName}.`); });

  return (
    <section className="card timer" aria-labelledby="timer-h">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="timer-h" style={{ margin: 0 }}>⏱️ Study timer</h2>
        <span className="muted">Today: {todayMin} min</span>
      </div>
      <p className="timer-clock" aria-hidden={!!running} suppressHydrationWarning>
        {running ? fmt(elapsed) : "0:00"}
        {running && <span className="muted timer-on"> {running.topic_name ? `· ${running.topic_name}` : "· general study"}</span>}
      </p>
      <span className="sr-only" aria-live="polite">{running ? `Timer running${running.topic_name ? ` for ${running.topic_name}` : ""}.` : "Timer stopped."}</span>
      <div className="row">
        {!running && <button className="btn primary" type="button" onClick={doStart} disabled={pending}>{topicName ? "Study this topic" : "Start session"}</button>}
        {running && otherTopic && <button className="btn primary" type="button" onClick={doSwitch} disabled={pending}>Switch to this topic</button>}
        {running && <button className="btn" type="button" onClick={() => doStop(false)} disabled={pending}>Pause &amp; save</button>}
        <button className="btn" type="button" onClick={() => doStop(true)} disabled={pending || (!running && !state.today_minutes)}>Finish for today</button>
      </div>
      <div role="status" aria-live="polite">{note && <p className="muted" style={{ marginBottom: 0 }}>{note}</p>}</div>
      {summary && (
        <div className="summary" role="status">
          <p style={{ marginTop: 0 }}><strong>Session complete ✅</strong></p>
          <p>{summary.saved_minutes ? `You studied for ${summary.saved_minutes} min this time.` : "Every visit counts."} Today: <strong>{summary.today_minutes} min</strong>. Topics done so far: <strong>{summary.topics_done ?? 0}</strong>.</p>
          <p className="muted" style={{ marginBottom: 0 }}>Rest well. Your brain keeps filing this away. <Link href="/insights">See your study patterns</Link>.</p>
        </div>
      )}
      <p className="muted" style={{ marginBottom: 0, fontSize: "0.8rem" }}>Closing the tab saves your time automatically. Idle time while the tab is closed or your computer sleeps isn&apos;t counted.</p>
    </section>
  );
}
