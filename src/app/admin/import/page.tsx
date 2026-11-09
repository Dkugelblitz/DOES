import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, LEVEL_SHORT } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { deleteInvite } from "../actions";
import { ImportForm } from "./ImportForm";

export default async function AdminImport() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: invites } = await supabase.from("level_invites").select("email, levels, created_at").is("claimed_at", null).order("created_at", { ascending: false });

  return (
    <>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Import users from CSV</h2>
        <p>One user per line: <code>email,levels</code>. Levels can be numbers (<code>1;2</code>) or names (<code>Data Engineer; Data Architect</code>), up to 500 rows.</p>
        <ul className="muted">
          <li>People who already have an account get the levels straight away.</li>
          <li>Everyone else gets an invite. When they sign up with that email and verify it, they start with those levels instead of choosing one.</li>
          <li>No emails are sent. Share the site link with them yourself.</li>
        </ul>
        <ImportForm />
      </section>

      <section className="card" aria-labelledby="inv-h">
        <h2 id="inv-h" style={{ marginTop: 0 }}>Waiting invites ({invites?.length ?? 0})</h2>
        {invites?.length ? (
          <ul className="mini">
            {invites.map((i) => (
              <li key={i.email}>
                <span>{i.email} · {(i.levels as number[]).map((l) => LEVEL_SHORT[l]).join(", ")} <span className="muted">· {fmtDate(i.created_at)}</span></span>
                <ActionForm action={deleteInvite} submit="Remove" confirm="Confirm: remove" danger inline>
                  <input type="hidden" name="email" value={i.email} />
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ margin: 0 }}>No invites waiting.</p>}
      </section>
    </>
  );
}
