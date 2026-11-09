import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { VersionHistory } from "../../../VersionHistory";
import { TopicForm, type Topic } from "../../../TopicForm";

const SLUG = /^[a-z0-9-]+$/;

// /admin/content/topics/new?domain=x creates; /admin/content/topics/<domain>/<slug> edits.
export default async function EditTopic({ params, searchParams }: { params: Promise<{ domain: string; slug: string }>; searchParams: Promise<{ domain?: string }> }) {
  await requireAdmin();
  const { domain, slug } = await params;
  if (!SLUG.test(domain) || !SLUG.test(slug)) notFound();
  const supabase = await createClient();
  const { data: levels } = await supabase.from("levels").select("level, name").order("level");
  const id = `${domain}/${slug}`;
  const { data } = await supabase.rpc("admin_content", { p_kind: "topic", p_id: id });
  const t = data as Topic | null;
  if (!t) notFound();

  return (
    <>
      <p className="muted"><Link href={`/admin/content?tab=topics&domain=${t.domain_slug}`}>← Topics</Link> · <Link href={`/topics/${t.id}`}>View as learner</Link></p>
      <TopicForm t={t} levels={levels ?? []} />
      <VersionHistory type="topic" id={t.id} />
    </>
  );
}
