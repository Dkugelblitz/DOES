import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Access } from "@/lib/access";

export type LevelInfo = { level: number; key: string; name: string; icon: string; description: string };

/**
 * The levels the caller holds, and which one this page shows: `?level=` if held, else the
 * active level, else the lowest held. Never a level the caller doesn't hold; the database
 * enforces the same rule, this just keeps the UI honest.
 */
export async function viewLevel(access: Access, param?: string): Promise<{ held: LevelInfo[]; level: LevelInfo }> {
  const supabase = await createClient();
  const { data } = await supabase.from("levels").select("level, key, name, icon, description").order("level");
  const held = ((data ?? []) as LevelInfo[]).filter((l) => access.levels.includes(l.level as 1 | 2 | 3));
  const want = Number(param);
  const level = held.find((l) => l.level === want) ?? held.find((l) => l.level === access.active_level) ?? held[0];
  return { held, level };
}
