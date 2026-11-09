import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { TopicForm } from "../../TopicForm";

export default async function NewTopic({ searchParams }: { searchParams: Promise<{ domain?: string }> }) {
  await requireAdmin();
  const { domain = "" } = await searchParams;
  const supabase = await createClient();
  const [{ data: levels }, { data: modules }, { data: dom }] = await Promise.all([
    supabase.from("levels").select("level, name").order("level"),
    supabase.from("modules").select("slug, name").eq("domain_slug", domain).neq("slug", "my-topics").order("sort_order"),
    supabase.from("domains").select("name, icon").eq("slug", domain).maybeSingle(),
  ]);
  if (!dom || !modules?.length) return <p className="card">Choose a domain first. <Link href="/admin/content">Back to content</Link></p>;
  return (
    <>
      <p className="muted"><Link href={`/admin/content?tab=topics&domain=${domain}`}>← Topics</Link> · {dom.icon} {dom.name}</p>
      <TopicForm t={{ modules, pareto_levels: [], min_level: 1 }} levels={levels ?? []} domainSlug={domain} />
    </>
  );
}
