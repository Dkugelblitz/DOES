"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error?: string };

export async function completeOnboarding(_: OnboardingState, form: FormData): Promise<OnboardingState> {
  const level = Number(form.get("level"));
  if (![1, 2, 3].includes(level)) return { error: "Choose one prep level to continue." };
  const timezone = String(form.get("timezone") || "UTC").slice(0, 64);
  const name = String(form.get("display_name") ?? "").trim().slice(0, 80) || null;
  const supabase = await createClient();
  // The database enforces "one level, once"; this action just relays the choice.
  const { error } = await supabase.rpc("complete_onboarding", { p_level: level, p_timezone: timezone, p_display_name: name });
  if (error) {
    if (error.message.includes("already onboarded")) redirect("/");
    if (error.message.includes("timezone")) {
      const retry = await supabase.rpc("complete_onboarding", { p_level: level, p_timezone: "UTC", p_display_name: name });
      if (!retry.error) redirect("/");
    }
    return { error: "Something went wrong saving your choice. Please try again." };
  }
  redirect("/");
}
