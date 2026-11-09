import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { viewLevel } from "@/lib/levels";
import { LevelTabs } from "@/components/LevelTabs";
import { PlanView, type PlanDay } from "./PlanView";

export default async function SprintPlan({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const access = await requireOnboarded();
  const { held, level } = await viewLevel(access, (await searchParams).level);
  const supabase = await createClient();
  // RLS already hides blocks/items above the caller's highest level; this narrows to the viewed level.
  const [{ data: blocks }, { data: items }, { data: progress }, { data: intro }] = await Promise.all([
    supabase.from("sprint_blocks").select("id, day, day_title, title, minutes, min_level, sort_order").lte("min_level", level.level).order("day").order("sort_order"),
    supabase.from("sprint_items").select("id, block_id, text, min_level, sort_order").lte("min_level", level.level).order("sort_order"),
    supabase.from("sprint_progress").select("item_id").eq("user_id", access.user_id).eq("done", true),
    supabase.from("content_documents").select("data").eq("key", "sprint_intro").single(),
  ]);
  const days: PlanDay[] = [];
  for (const b of blocks ?? []) {
    let d = days.find((x) => x.day === b.day);
    if (!d) days.push((d = { day: b.day, title: b.day_title, blocks: [] }));
    const its = (items ?? []).filter((i) => i.block_id === b.id).map((i) => ({ id: i.id, text: i.text }));
    if (its.length) d.blocks.push({ id: b.id, title: b.title, minutes: b.minutes, items: its });
  }
  const hours = days.flatMap((d) => d.blocks).reduce((m, b) => m + b.minutes, 0) / 60;

  return (
    <>
      <LevelTabs held={held} current={level.level} base="/sprint/plan" label="Sprint level" />
      <p className="muted">{intro?.data?.intro} This is the {level.name} version: {hours.toFixed(1)} hours across two days.</p>
      <PlanView days={days} initialDone={(progress ?? []).map((p) => p.item_id)} />
    </>
  );
}
