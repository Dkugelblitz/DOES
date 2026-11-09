import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ago, fmtDate, fmtDateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { Bar } from "@/components/Bar";
import { grantLevel, revokeLevel, setActiveLevelFor, setAdmin, setDisabled } from "../../actions";

type Grant = { id: number; level: number; granted_at: string; expires_at: string | null; revoked_at: string | null; source: string; granted_by: string | null; revoked_by: string | null; active: boolean };
type Detail = {
  access: { user_id: string; email: string; is_admin: boolean; disabled: boolean; granted: number[]; levels: number[]; active_level: number | null };
  profile: { display_name: string | null; timezone: string; created_at: string; last_active_at: string | null; onboarded_at: string | null; interview_date: string | null };
  stats: { xp: number; current_streak: number; longest_streak: number; study_minutes: number; topics_done: number } | null;
  grants: Grant[];
  requests: { id: number; requested_level: number; status: string; note: string | null; created_at: string; decision_note: string | null }[];
  progress: { level: number; domains: { domain: string; icon: string; total: number; done: number; in_progress: number }[] }[];
  sessions: { started_at: string; minutes: number | null; topic_id: string | null }[];
  revision_backlog: { topic_id: string; name: string; days: number }[];
  shared_topics: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminUserDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [{ data, error }, { data: levels }] = await Promise.all([
    supabase.rpc("admin_user_detail", { p_user: id }),
    supabase.from("levels").select("level, name, icon").order("level"),
  ]);
  if (error?.message.includes("not found")) notFound();
  if (error || !data) return <p className="error">Couldn&apos;t load this user.</p>;
  const d = data as Detail, a = d.access, self = a.user_id === me.user_id;
  const name = (n: number) => levels?.find((l) => l.level === n)?.name ?? `Level ${n}`;
  const here = `/admin/users/${id}`;
  const openGrant = (l: number) => d.grants.find((g) => g.level === l && g.active);

  return (
    <>
      <p className="muted"><Link href="/admin/users">← All users</Link></p>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>{d.profile.display_name || a.email}</h2>
        <p className="muted" style={{ margin: 0 }}>{a.email}</p>
        <div className="row" style={{ marginTop: 8 }}>
          {a.is_admin && <span className="tag core">Admin</span>}
          {a.disabled && <span className="tag">Disabled</span>}
          {self && <span className="tag">You</span>}
        </div>
        <dl className="facts">
          <div><dt>Signed up</dt><dd>{fmtDate(d.profile.created_at)}</dd></div>
          <div><dt>Last active</dt><dd>{ago(d.profile.last_active_at)}</dd></div>
          <div><dt>Timezone</dt><dd>{d.profile.timezone}</dd></div>
          <div><dt>Interview date</dt><dd>{fmtDate(d.profile.interview_date)}</dd></div>
          <div><dt>XP</dt><dd>{d.stats?.xp ?? 0}</dd></div>
          <div><dt>Streak</dt><dd>{d.stats?.current_streak ?? 0} days</dd></div>
        </dl>
      </section>

      <section className="card" aria-labelledby="levels-h">
        <h2 id="levels-h" style={{ marginTop: 0 }}>Levels</h2>
        {a.is_admin && <p className="muted">Admins can see every level whatever is granted here. Grants still matter if they stop being an admin.</p>}
        <div className="stack">
          {(levels ?? []).map((l) => {
            const g = openGrant(l.level);
            return (
              <div key={l.level} className="level-row">
                <div>
                  <strong>{l.icon} {l.name}</strong>
                  <div className="muted">{g ? <>Granted {fmtDate(g.granted_at)}{g.expires_at ? <> · expires {fmtDate(g.expires_at)}</> : " · no expiry"}</> : "Not granted"}</div>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  <ActionForm action={grantLevel} submit={g ? "Update expiry" : "Grant"} inline>
                    <input type="hidden" name="user_id" value={id} /><input type="hidden" name="level" value={l.level} />
                    <label className="row inline-label">Expires
                      <input type="date" name="expires_on" defaultValue={g?.expires_at?.slice(0, 10) ?? ""} style={{ width: "auto" }} />
                    </label>
                  </ActionForm>
                  {g && (
                    <ActionForm action={revokeLevel} submit="Revoke" confirm={`Confirm: revoke ${l.name}`} danger inline>
                      <input type="hidden" name="user_id" value={id} /><input type="hidden" name="level" value={l.level} />
                    </ActionForm>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="muted">Revoking hides that level&apos;s content but keeps all progress, notes and files. Granting it again brings everything back.</p>
        {a.levels.length > 1 && (
          <ActionForm action={setActiveLevelFor} submit="Set default level" inline>
            <input type="hidden" name="user_id" value={id} />
            <label className="row inline-label">Default level
              <select name="level" defaultValue={a.active_level ?? undefined} style={{ width: "auto" }}>
                {a.levels.map((l) => <option key={l} value={l}>{name(l)}</option>)}
              </select>
            </label>
          </ActionForm>
        )}
      </section>

      <section className="card" aria-labelledby="acct-h">
        <h2 id="acct-h" style={{ marginTop: 0 }}>Account</h2>
        <div className="stack">
          <ActionForm action={setAdmin} next={here} submit={a.is_admin ? "Remove admin access" : "Make admin"}
            confirm={a.is_admin ? "Confirm: remove admin access" : "Confirm: make admin"} danger={a.is_admin}>
            <input type="hidden" name="user_id" value={id} /><input type="hidden" name="is_admin" value={String(!a.is_admin)} />
            <p className="muted" style={{ margin: 0 }}>
              Needs a sign-in within the last 10 minutes. The last admin can&apos;t be removed.
              Anyone listed in ADMIN_EMAILS becomes an admin again at their next sign-in.
            </p>
          </ActionForm>
          {!self && (
            <ActionForm action={setDisabled} submit={a.disabled ? "Enable account" : "Disable account"}
              confirm={a.disabled ? undefined : "Confirm: disable account"} danger={!a.disabled}>
              <input type="hidden" name="user_id" value={id} /><input type="hidden" name="disabled" value={String(!a.disabled)} />
              <p className="muted" style={{ margin: 0 }}>A disabled user can&apos;t see or change anything. Nothing is deleted.</p>
            </ActionForm>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="prog-h">
        <h2 id="prog-h" style={{ marginTop: 0 }}>Progress by level</h2>
        <div className="progress-grid">
          {d.progress.map((lv) => {
            const t = lv.domains.reduce((s, x) => ({ total: s.total + x.total, done: s.done + x.done, wip: s.wip + x.in_progress }), { total: 0, done: 0, wip: 0 });
            return (
              <div key={lv.level}>
                <h3 className="mod"><span>{name(lv.level)}</span><span className="muted">{t.done}/{t.total}</span></h3>
                <Bar done={t.done} inProgress={t.wip} total={t.total} />
                <ul className="mini">
                  {lv.domains.filter((x) => x.total > 0).map((x) => <li key={x.domain}><span>{x.icon} {x.domain}</span><span className="muted">{x.done}/{x.total}</span></li>)}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="muted">Progress is shared across levels: the same topic counts wherever it appears. {d.shared_topics > 0 ? `${d.shared_topics} topic(s) shared with admins.` : "No topics shared with admins; their notes and files stay private."}</p>
      </section>

      <section className="card" aria-labelledby="rev-h">
        <h2 id="rev-h" style={{ marginTop: 0 }}>Revision backlog</h2>
        {d.revision_backlog.length ? (
          <ul className="mini">{d.revision_backlog.map((r) => <li key={r.topic_id}><span>{r.name}</span><span className={r.days >= 7 ? "error" : "muted"}>{r.days} days</span></li>)}</ul>
        ) : <p className="muted">Nothing due.</p>}
      </section>

      <section className="card" aria-labelledby="ses-h">
        <h2 id="ses-h" style={{ marginTop: 0 }}>Recent study sessions</h2>
        {d.sessions.length ? (
          <ul className="mini">{d.sessions.map((s, i) => <li key={i}><span>{fmtDateTime(s.started_at, d.profile.timezone)}</span><span className="muted">{s.minutes ?? "running"} min</span></li>)}</ul>
        ) : <p className="muted">No sessions yet. (The study timer arrives in Milestone 6.)</p>}
      </section>

      <details className="card">
        <summary><strong>Grant history and requests</strong></summary>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th scope="col">Level</th><th scope="col">Granted</th><th scope="col">By</th><th scope="col">Source</th><th scope="col">Expires</th><th scope="col">Ended</th></tr></thead>
            <tbody>
              {d.grants.map((g) => (
                <tr key={g.id}>
                  <td>{name(g.level)}</td><td>{fmtDate(g.granted_at)}</td><td>{g.granted_by ?? "self / system"}</td><td>{g.source}</td>
                  <td>{fmtDate(g.expires_at)}</td><td>{g.revoked_at ? `${fmtDate(g.revoked_at)}${g.revoked_by ? ` by ${g.revoked_by}` : ""}` : g.active ? "active" : "expired"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.requests.length > 0 && (
          <ul className="mini">{d.requests.map((r) => <li key={r.id}><span>Asked for {name(r.requested_level)} on {fmtDate(r.created_at)}{r.note ? `: “${r.note}”` : ""}</span><span className="muted">{r.status}</span></li>)}</ul>
        )}
      </details>
    </>
  );
}
