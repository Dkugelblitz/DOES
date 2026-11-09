import "server-only";
import { createClient } from "@/lib/supabase/server";
import { levelInfo, type LevelCfg } from "@/lib/game";
import { fill, pick, type Messages } from "@/lib/messages";

export type GameDelta = { xp_before: number; xp_after: number; new_badges: { id: string; name: string; icon: string }[] };

/**
 * Short, warm lines to show after an action: an optional cheer, XP gained, a level-up and any
 * new badges. Wording comes from the "messages" document; levels from "gamification".
 */
export async function celebrate(delta: GameDelta | undefined, opts: { cheer?: boolean; lead?: string } = {}): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("content_documents").select("key, data").in("key", ["messages", "gamification"]);
  const m = data?.find((d) => d.key === "messages")?.data as Messages | undefined;
  const g = data?.find((d) => d.key === "gamification")?.data as { levels?: LevelCfg } | undefined;
  const out: string[] = [];
  const gained = delta ? delta.xp_after - delta.xp_before : 0;
  const head = [opts.lead, opts.cheer ? pick(m?.topic_done_cheers) : undefined].filter(Boolean).join(" ");
  if (head || gained > 0) out.push([head, gained > 0 ? fill(m?.toasts?.xp_gain ?? "+{points} XP", { points: gained }) : ""].filter(Boolean).join(" "));
  if (delta && g?.levels) {
    const before = levelInfo(delta.xp_before, g.levels), after = levelInfo(delta.xp_after, g.levels);
    if (after.level > before.level) out.push(`🎉 ${fill(m?.toasts?.level_up ?? "Level up! {title}", { title: after.title })}`);
  }
  for (const b of delta?.new_badges ?? []) out.push(fill(m?.toasts?.badge_unlocked ?? "{icon} Badge unlocked: {name}", { icon: b.icon, name: b.name }));
  return out;
}
