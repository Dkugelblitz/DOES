import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ActionForm";
import { saveDesign } from "../../actions";
import { VersionHistory } from "../../VersionHistory";

type Design = { id: string; title: string; min_level: number; points: string[]; topic_ids: string[]; archived_at: string | null };

export default async function EditDesign({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const isNew = id === "new";
  if (!isNew && !/^[a-z0-9-]{1,80}$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data }, { data: levels }] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : supabase.rpc("admin_content", { p_kind: "design", p_id: id }),
    supabase.from("levels").select("level, name").order("level"),
  ]);
  const d = data as Design | null;
  if (!isNew && !d) notFound();

  return (
    <>
      <p className="muted"><Link href="/admin/content?tab=designs">← System designs</Link></p>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>{isNew ? "New system design" : "Edit system design"}</h2>
        <ActionForm action={saveDesign} submit="Save design">
          {d && <input type="hidden" name="id" value={d.id} />}
          <label>Title<input name="title" defaultValue={d?.title} required maxLength={200} /></label>
          <label>Minimum level
            <select name="min_level" defaultValue={d?.min_level ?? 3}>{(levels ?? []).map((l) => <option key={l.level} value={l.level}>{l.name}</option>)}</select>
          </label>
          <label>Points (one per line)<textarea name="points" rows={7} defaultValue={d?.points.join("\n")} required /></label>
          <label>Related topic IDs (optional, one per line, e.g. architecture/medallion-lakehouse)<textarea name="topic_ids" rows={3} defaultValue={d?.topic_ids.join("\n")} /></label>
          {d && <label className="row inline-label"><input type="checkbox" name="archived" defaultChecked={!!d.archived_at} style={{ width: 20, height: 20 }} /> Archived (hidden)</label>}
        </ActionForm>
      </section>
      {d && <VersionHistory type="design" id={d.id} />}
    </>
  );
}
