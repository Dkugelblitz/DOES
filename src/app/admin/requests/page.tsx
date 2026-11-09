import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ago, fmtDate } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { decideRequest } from "../actions";

type Req = { id: number; user_id: string; requested_level: number; status: string; note: string | null; created_at: string; decided_at: string | null; decision_note: string | null };

export default async function AdminRequests() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: pending }, { data: recent }, { data: levels }] = await Promise.all([
    supabase.from("level_requests").select("*").eq("status", "pending").order("created_at"),
    supabase.from("level_requests").select("*").neq("status", "pending").order("decided_at", { ascending: false }).limit(20),
    supabase.from("levels").select("level, name"),
  ]);
  const ids = [...new Set([...(pending ?? []), ...(recent ?? [])].map((r) => r.user_id))];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, email, display_name, onboarded_at").in("id", ids) : { data: [] };
  const who = (uid: string) => people?.find((p) => p.id === uid);
  const name = (n: number) => levels?.find((l) => l.level === n)?.name ?? `Level ${n}`;

  return (
    <>
      <h2>Pending ({pending?.length ?? 0})</h2>
      {(pending as Req[] | null)?.length ? (pending as Req[]).map((r) => {
        const p = who(r.user_id);
        return (
          <section key={r.id} className="card">
            <p style={{ marginTop: 0 }}>
              <Link href={`/admin/users/${r.user_id}`}><strong>{p?.display_name || p?.email}</strong></Link>
              <span className="muted"> ({p?.email})</span>{!p?.onboarded_at && <span className="tag core" style={{ marginLeft: 6 }}>new person</span>} asked {p?.onboarded_at ? "for" : "to join with"} <strong>{name(r.requested_level)}</strong>
              <span className="muted"> · {ago(r.created_at)}</span>
            </p>
            {r.note && <blockquote className="quote">{r.note}</blockquote>}
            <div className="row" style={{ alignItems: "flex-start" }}>
              <ActionForm action={decideRequest} submit="Approve" inline>
                <input type="hidden" name="request_id" value={r.id} /><input type="hidden" name="decision" value="approve" />
                <label className="sr-only" htmlFor={`an-${r.id}`}>Note to the user (optional)</label>
                <input id={`an-${r.id}`} name="note" placeholder="Note to the user (optional)" maxLength={500} style={{ minWidth: 220 }} />
              </ActionForm>
              <ActionForm action={decideRequest} submit="Deny" confirm="Confirm: deny" danger inline>
                <input type="hidden" name="request_id" value={r.id} /><input type="hidden" name="decision" value="deny" />
                <label className="sr-only" htmlFor={`dn-${r.id}`}>Reason (optional)</label>
                <input id={`dn-${r.id}`} name="note" placeholder="Reason (optional)" maxLength={500} style={{ minWidth: 220 }} />
              </ActionForm>
            </div>
          </section>
        );
      }) : <p className="card muted">No pending requests. When a user asks for another level, it appears here.</p>}

      <h2>Recently decided</h2>
      <div className="card">
        {(recent as Req[] | null)?.length ? (
          <ul className="mini">
            {(recent as Req[]).map((r) => (
              <li key={r.id}>
                <span>{who(r.user_id)?.email} · {name(r.requested_level)}{r.decision_note ? ` · “${r.decision_note}”` : ""}</span>
                <span className="muted">{r.status} {fmtDate(r.decided_at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ margin: 0 }}>Nothing yet.</p>}
      </div>
    </>
  );
}
