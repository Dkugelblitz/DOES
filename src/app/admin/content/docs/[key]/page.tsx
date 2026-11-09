import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ActionForm";
import { saveDocument } from "../../actions";
import { VersionHistory } from "../../VersionHistory";

const HELP: Record<string, string> = {
  hackerrank: "The HackerRank AI guide. Edit \"sections\" (each has an id, title and body), \"disclaimer\" and \"last_reviewed\" (YYYY-MM-DD). Update this whenever the interview format changes.",
  messages: "All encouragement wording: the greeting, topic_done_cheers, the closing messages and toasts. Placeholders in {braces} are filled in automatically. Keep the tone warm and never guilt-inducing.",
  gamification: "XP points per action, level divisor, titles, revision timing and badge rules. Changes apply to new actions; XP already earned stays. Badges can be added or changed here but not removed.",
  settings: "Progress defaults, upload limits (bytes) and the summary settings.",
  design_framework: "The system design answer framework steps and minutes.",
  sprint_intro: "The sentence shown at the top of the sprint plan.",
};

export default async function EditDocument({ params }: { params: Promise<{ key: string }> }) {
  await requireAdmin();
  const { key } = await params;
  if (!HELP[key]) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_content", { p_kind: "document", p_id: key });
  if (!data) notFound();
  const doc = data as { key: string; data: unknown; version: number };

  return (
    <>
      <p className="muted"><Link href="/admin/content?tab=docs">← Guides & settings</Link></p>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>{key} <span className="muted" style={{ fontWeight: 400 }}>v{doc.version}</span></h2>
        <p className="muted">{HELP[key]}</p>
        <ActionForm action={saveDocument} submit="Save">
          <input type="hidden" name="key" value={key} />
          <label className="sr-only" htmlFor="doc-json">{key} as JSON</label>
          <textarea id="doc-json" name="json" rows={24} spellCheck={false} className="json" defaultValue={JSON.stringify(doc.data, null, 2)} />
          <span className="muted">JSON. It&apos;s checked before saving, so a mistake can&apos;t break the app.</span>
        </ActionForm>
      </section>
      <VersionHistory type="document" id={key} />
    </>
  );
}
