import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { restoreVersion } from "./actions";

/** Every saved version of one item, newest first, each restorable (restoring adds a new version). */
export async function VersionHistory({ type, id }: { type: "topic" | "card" | "design" | "document"; id: string }) {
  const supabase = await createClient();
  const { data: versions } = await supabase.from("content_versions").select("version, data, edited_by, created_at")
    .eq("entity_type", type).eq("entity_id", id).order("version", { ascending: false }).limit(50);
  const editors = [...new Set((versions ?? []).map((v) => v.edited_by).filter(Boolean))] as string[];
  const { data: people } = editors.length ? await supabase.from("profiles").select("id, email").in("id", editors) : { data: [] };
  const who = (uid: string | null) => (uid ? people?.find((p) => p.id === uid)?.email ?? "an admin" : "initial seed");
  const latest = versions?.[0]?.version;

  return (
    <section className="card" aria-labelledby="vh-h">
      <h2 id="vh-h" style={{ marginTop: 0 }}>Version history</h2>
      {versions?.length ? (
        <ul className="mini">
          {versions.map((v) => (
            <li key={v.version} style={{ alignItems: "flex-start" }}>
              <details style={{ flex: 1, minWidth: 0 }}>
                <summary>Version {v.version}{v.version === latest ? " (current)" : ""} · {fmtDateTime(v.created_at)} UTC · {who(v.edited_by)}</summary>
                <pre className="json">{JSON.stringify(v.data, null, 2)}</pre>
              </details>
              {v.version !== latest && (
                <ActionForm action={restoreVersion} submit="Restore" confirm={`Confirm: restore version ${v.version}`} inline>
                  <input type="hidden" name="type" value={type} /><input type="hidden" name="entity_id" value={id} />
                  <input type="hidden" name="version" value={v.version} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="muted" style={{ margin: 0 }}>No versions yet.</p>}
    </section>
  );
}
