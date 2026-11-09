import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { setJoinPolicy } from "../actions";

type Policy = { mode: "open" | "invite_only"; allowed_domains: string[]; updated_at: string; waiting: number };

export default async function AdminAccess() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_join_policy");
  const p = data as Policy | null;
  if (!p) return <p className="error">Couldn&apos;t load the access settings.</p>;

  return (
    <>
      <section className="card" aria-labelledby="who-h">
        <h2 id="who-h" style={{ marginTop: 0 }}>Who can join</h2>
        <p style={{ marginTop: 0 }}>
          Right now: <strong>{p.mode === "open" ? "Open. Anyone with a Google account can join." : "Invite-only."}</strong>
          <span className="muted"> · changed {fmtDateTime(p.updated_at)} UTC</span>
        </p>
        <ActionForm action={setJoinPolicy} submit="Save">
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sr-only">Joining mode</legend>
            <label className="choice">
              <span className="row"><input type="radio" name="mode" value="open" defaultChecked={p.mode === "open"} /><strong>Open</strong></span>
              <span className="muted">Anyone who signs in with Google picks a level and starts.</span>
            </label>
            <label className="choice">
              <span className="row"><input type="radio" name="mode" value="invite_only" defaultChecked={p.mode === "invite_only"} /><strong>Invite-only</strong></span>
              <span className="muted">
                Only people you&apos;ve <Link href="/admin/import">invited</Link>, people with an email on an allowed domain, and people whose
                access request you <Link href="/admin/requests">approve</Link>. Everyone else sees a waiting page and can ask for access.
              </span>
            </label>
          </fieldset>
          <label>Allowed email domains (invite-only mode, one per line)
            <textarea name="domains" rows={4} defaultValue={p.allowed_domains.join("\n")} placeholder={"yourcompany.com\npartner.org"} spellCheck={false} />
            <span className="muted" style={{ fontWeight: 400 }}>Exact domains only (subdomains aren&apos;t included). gmail.com isn&apos;t allowed here; that would let anyone in.</span>
          </label>
        </ActionForm>
        <p className="muted" style={{ marginBottom: 0 }}>Changing this never affects people who have already joined. To remove someone, disable their account under <Link href="/admin/users">Users</Link>.</p>
      </section>

      <section className="card">
        <p style={{ margin: 0 }}>
          <strong>{p.waiting}</strong> {p.waiting === 1 ? "person has" : "people have"} signed in but haven&apos;t joined yet.
          {p.waiting > 0 && <> Their access requests are in <Link href="/admin/requests">Requests</Link>, tagged “new person”.</>}
        </p>
      </section>
    </>
  );
}
