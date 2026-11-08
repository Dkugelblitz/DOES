"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Only switches the view among levels the user already holds (enforced in the database).
export async function setActiveLevel(form: FormData): Promise<void> {
  const level = Number(form.get("level"));
  if (![1, 2, 3].includes(level)) return;
  const supabase = await createClient();
  await supabase.rpc("set_active_level", { p_level: level });
  revalidatePath("/", "layout");
}
