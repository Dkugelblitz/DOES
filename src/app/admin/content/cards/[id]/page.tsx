import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ActionForm";
import { saveCard } from "../../actions";
import { VersionHistory } from "../../VersionHistory";

type Card = { id: string; deck: string; question: string; answer: string; topic_id: string; min_level_override: number | null; archived_at: string | null };

// /admin/content/cards/new creates; /admin/content/cards/<id> edits.
export default async function EditCard({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const isNew = id === "new";
  if (!isNew && !/^[a-z0-9-]{1,80}$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data }, { data: levels }, { data: topics }] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : supabase.rpc("admin_content", { p_kind: "card", p_id: id }),
    supabase.from("levels").select("level, name").order("level"),
    supabase.rpc("admin_content", { p_kind: "topics" }),
  ]);
  const c = data as Card | null;
  if (!isNew && !c) notFound();
  const decks = ["Databricks", "PySpark", "AWS", "Gen AI", "Python", "SQL"];

  return (
    <>
      <p className="muted"><Link href="/admin/content?tab=cards">← Flip cards</Link></p>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>{isNew ? "New flip card" : "Edit flip card"}</h2>
        <ActionForm action={saveCard} submit="Save card">
          {c && <input type="hidden" name="id" value={c.id} />}
          <label>Deck<input name="deck" list="decks" defaultValue={c?.deck} required maxLength={40} /></label>
          <datalist id="decks">{decks.map((d) => <option key={d} value={d} />)}</datalist>
          <label>Question<input name="question" defaultValue={c?.question} required maxLength={300} /></label>
          <label>Answer<textarea name="answer" rows={4} defaultValue={c?.answer} required /></label>
          <label>Topic (the card shows to anyone who can see this topic)
            <select name="topic_id" defaultValue={c?.topic_id} required>
              {((topics ?? []) as { id: string; name: string; domain_slug: string }[]).map((t) => <option key={t.id} value={t.id}>{t.domain_slug} · {t.name}</option>)}
            </select>
          </label>
          <label>Minimum level
            <select name="min_level_override" defaultValue={c?.min_level_override ?? ""}>
              <option value="">Same as its topic</option>
              {(levels ?? []).map((l) => <option key={l.level} value={l.level}>{l.name}</option>)}
            </select>
          </label>
          {c && <label className="row inline-label"><input type="checkbox" name="archived" defaultChecked={!!c.archived_at} style={{ width: 20, height: 20 }} /> Archived (hidden)</label>}
        </ActionForm>
      </section>
      {c && <VersionHistory type="card" id={c.id} />}
    </>
  );
}
