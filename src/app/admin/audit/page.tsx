import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";

type Entry = { id: number; actor_id: string | null; action: string; target_user_id: string | null; entity_type: string | null; entity_id: string | null; before: unknown; after: unknown; created_at: string };
const PAGE = 50;

const LABEL: Record<string, string> = {
  bootstrap_admin: "Made admin (ADMIN_EMAILS)", grant_level: "Granted level", revoke_level: "Revoked level", change_grant_expiry: "Changed expiry",
  set_active_level: "Set default level", promote_admin: "Promoted to admin", demote_admin: "Removed admin", disable_user: "Disabled account",
  enable_user: "Enabled account", approve_request: "Approved request", deny_request: "Denied request", import_invite: "Imported invite", delete_invite: "Deleted invite",
};

const compact = (v: unknown) => (v == null ? "–" : JSON.stringify(v).replace(/[{}"]/g, "").replace(/,/g, ", ").replace(/:/g, ": "));

export default async function AdminAudit({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const p = Math.max(1, parseInt((await searchParams).page ?? "1", 10) || 1);
  const supabase = await createClient();
  const { data, count, error } = await supabase.from("admin_audit_log").select("*", { count: "exact" })
    .order("id", { ascending: false }).range((p - 1) * PAGE, p * PAGE - 1);
  if (error) return <p className="error">Couldn&apos;t load the audit log.</p>;
  const rows = (data ?? []) as Entry[];
  const ids = [...new Set(rows.flatMap((r) => [r.actor_id, r.target_user_id]).filter((x): x is string => !!x))];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, email").in("id", ids) : { data: [] };
  const email = (uid: string | null) => (uid ? people?.find((x) => x.id === uid)?.email ?? "deleted user" : null);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <p className="muted">Every admin action, newest first. Entries can&apos;t be edited or deleted.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">When (UTC)</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Target</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.created_at)}</td>
                <td>{email(r.actor_id) ?? <span className="muted">system</span>}</td>
                <td>{LABEL[r.action] ?? r.action}</td>
                <td>{r.target_user_id ? <Link href={`/admin/users/${r.target_user_id}`}>{email(r.target_user_id)}</Link> : <span className="muted">{r.entity_id ?? "–"}</span>}</td>
                <td className="code">{compact(r.before)}</td>
                <td className="code">{compact(r.after)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="muted">No admin actions yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="row" aria-label="Pages" style={{ marginTop: 12 }}>
          {p > 1 && <Link className="btn" href={`/admin/audit?page=${p - 1}`}>← Newer</Link>}
          <span className="muted">Page {p} of {pages}</span>
          {p < pages && <Link className="btn" href={`/admin/audit?page=${p + 1}`}>Older →</Link>}
        </nav>
      )}
    </>
  );
}
