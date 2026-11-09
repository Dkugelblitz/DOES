import { ActionForm } from "@/components/ActionForm";
import { saveTopic } from "./actions";

export type Topic = { id: string; name: string; domain_slug: string; module_slug: string; min_level: number; pareto_levels: number[]; sort_order: number;
  archived_at: string | null; subtopics: { slug: string; name: string }[]; modules: { slug: string; name: string }[] };

export function TopicForm({ t, levels, domainSlug }: { t: Partial<Topic> & { modules: { slug: string; name: string }[] }; levels: { level: number; name: string }[]; domainSlug?: string }) {
  return (
    <section className="card" aria-labelledby="tf-h">
      <h2 id="tf-h" style={{ marginTop: 0 }}>{t.id ? `Edit topic` : "New topic"}</h2>
      <ActionForm action={saveTopic} submit="Save topic">
        {t.id ? <input type="hidden" name="id" value={t.id} /> : <input type="hidden" name="domain_slug" value={domainSlug} />}
        <label>Name<input name="name" defaultValue={t.name} maxLength={160} required /></label>
        <div className="row">
          <label style={{ flex: 1, minWidth: 180 }}>Module
            <select name="module_slug" defaultValue={t.module_slug ?? t.modules[0]?.slug}>{t.modules.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}</select>
          </label>
          <label style={{ flex: 1, minWidth: 180 }}>Minimum level (shown from)
            <select name="min_level" defaultValue={t.min_level ?? 1}>{levels.map((l) => <option key={l.level} value={l.level}>{l.name}</option>)}</select>
          </label>
          <label style={{ flex: "0 0 110px" }}>Order<input name="sort_order" type="number" min={0} defaultValue={t.sort_order} /></label>
        </div>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
          <legend style={{ fontWeight: 600 }}>Pareto core for</legend>
          {levels.map((l) => (
            <label key={l.level} className="row inline-label">
              <input type="checkbox" name="pareto" value={l.level} defaultChecked={t.pareto_levels?.includes(l.level)} style={{ width: 20, height: 20 }} /> {l.name}
            </label>
          ))}
          <span className="muted">A topic can only be core for levels at or above its minimum level.</span>
        </fieldset>
        <label>Subtopics (one per line, in order)
          <textarea name="subtopics" rows={8} defaultValue={(t.subtopics ?? []).map((s) => s.name).join("\n")} />
          <span className="muted" style={{ fontWeight: 400 }}>Removing a line hides that subtopic but keeps people&apos;s ticks; adding it back restores them.</span>
        </label>
        {t.id && (
          <label className="row inline-label"><input type="checkbox" name="archived" defaultChecked={!!t.archived_at} style={{ width: 20, height: 20 }} /> Archived (hidden from everyone; progress kept)</label>
        )}
      </ActionForm>
    </section>
  );
}
