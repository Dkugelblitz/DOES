import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { describeNotification } from "@/lib/notifications";
import { Nav } from "@/components/Nav";
import { ActionForm } from "@/components/ActionForm";
import { cancelRequest, markNotificationsRead, requestLevel } from "./actions";

export default async function AccountPage() {
  const access = await requireOnboarded();
  const supabase = await createClient();
  const [{ data: levels }, { data: grants }, { data: requests }, { data: notes }, { data: profile }] = await Promise.all([
    supabase.from("levels").select("level, name, icon, description").order("level"),
    supabase.from("level_grants").select("level, expires_at").eq("user_id", access.user_id).is("revoked_at", null),
    supabase.from("level_requests").select("id, requested_level, status, note, decision_note, created_at, decided_at").eq("user_id", access.user_id).order("created_at", { ascending: false }).limit(20),
    supabase.from("notifications").select("id, kind, payload, read_at, created_at").eq("user_id", access.user_id).order("created_at", { ascending: false }).limit(20),
    supabase.from("profiles").select("email, display_name, timezone").eq("id", access.user_id).single(),
  ]);
  const name = (n: number) => levels?.find((l) => l.level === n)?.name ?? `Level ${n}`;
  const held = new Set(access.levels);
  const pendingLevels = new Set((requests ?? []).filter((r) => r.status === "pending").map((r) => r.requested_level));
  const askable = (levels ?? []).filter((l) => !held.has(l.level) && !pendingLevels.has(l.level));
  const unread = (notes ?? []).filter((n) => !n.read_at).length;
  const expiry = (l: number) => grants?.find((g) => g.level === l && g.expires_at)?.expires_at;

  return (
    <main>
      <Nav current="account" isAdmin={access.is_admin} />
      <h1>Your account</h1>
      <p className="muted">{profile?.display_name ? `${profile.display_name} · ` : ""}{profile?.email} · timezone {profile?.timezone}</p>

      <section className="card" aria-labelledby="lv-h">
        <h2 id="lv-h" style={{ marginTop: 0 }}>Your levels</h2>
        <ul className="mini">
          {(levels ?? []).map((l) => (
            <li key={l.level}>
              <span>{l.icon} {l.name}</span>
              <span className={held.has(l.level) ? "ok" : "muted"}>
                {held.has(l.level) ? (access.is_admin ? "included (admin)" : `yes${expiry(l.level) ? `, until ${fmtDate(expiry(l.level))}` : ""}`) : pendingLevels.has(l.level) ? "requested" : "no"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {askable.length > 0 && (
        <section className="card" aria-labelledby="rq-h">
          <h2 id="rq-h" style={{ marginTop: 0 }}>Request another level</h2>
          <p className="muted">An admin reviews each request. Your progress carries over: topics you&apos;ve done already count on the new roadmap.</p>
          <ActionForm action={requestLevel} submit="Send request">
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="sr-only">Level</legend>
              {askable.map((l) => (
                <label key={l.level} className="choice">
                  <span className="row"><input type="radio" name="level" value={l.level} required /><strong>{l.icon} {l.name}</strong></span>
                  <span className="muted">{l.description}</span>
                </label>
              ))}
            </fieldset>
            <label>Why do you need it? (optional)
              <textarea name="note" rows={2} maxLength={500} placeholder="e.g. I have a Principal interview in March" />
            </label>
          </ActionForm>
        </section>
      )}

      {!!requests?.length && (
        <section className="card" aria-labelledby="my-h">
          <h2 id="my-h" style={{ marginTop: 0 }}>Your requests</h2>
          <ul className="mini">
            {requests.map((r) => (
              <li key={r.id}>
                <span>{name(r.requested_level)} · {fmtDate(r.created_at)}{r.decision_note ? ` · “${r.decision_note}”` : ""}</span>
                {r.status === "pending" ? (
                  <ActionForm action={cancelRequest} submit="Cancel request" confirm="Confirm: cancel" inline>
                    <input type="hidden" name="request_id" value={r.id} />
                  </ActionForm>
                ) : <span className={r.status === "approved" ? "ok" : "muted"}>{r.status}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="nt-h">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 id="nt-h" style={{ margin: 0 }}>Updates {unread > 0 && <span className="badge">{unread} new</span>}</h2>
          {unread > 0 && <form action={markNotificationsRead}><button className="btn" type="submit">Mark all as read</button></form>}
        </div>
        {notes?.length ? (
          <ul className="mini">
            {notes.map((n) => (
              <li key={n.id} className={n.read_at ? undefined : "unread"}>
                <span>{describeNotification(n.kind, (n.payload ?? {}) as Record<string, unknown>, name)}</span>
                <span className="muted">{fmtDateTime(n.created_at, profile?.timezone)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No updates yet.</p>}
      </section>
    </main>
  );
}
