"use server";
import { createClient } from "@/lib/supabase/server";

// Both database functions refuse items and cards above the caller's levels.
const ITEM = /^d\d+b\d+i\d+$/;
const CARD = /^[a-z0-9-]{1,80}$/;

export async function setSprintItem(itemId: string, done: boolean): Promise<{ ok: boolean }> {
  if (!ITEM.test(itemId)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sprint_item", { p_item_id: itemId, p_done: done });
  return { ok: !error };
}

export async function setCardMastered(cardId: string, mastered: boolean): Promise<{ ok: boolean }> {
  if (!CARD.test(cardId)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_card_mastered", { p_card_id: cardId, p_mastered: mastered });
  return { ok: !error };
}
