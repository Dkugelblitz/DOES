import { requireOnboarded } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { viewLevel } from "@/lib/levels";
import { LevelTabs } from "@/components/LevelTabs";
import { CardsView, type Card } from "./CardsView";

type Row = Card & { min_level_override: number | null; topics: { min_level: number } | null };

export default async function SprintCards({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const access = await requireOnboarded();
  const { held, level } = await viewLevel(access, (await searchParams).level);
  const supabase = await createClient();
  const [{ data }, { data: mastery }] = await Promise.all([
    supabase.from("cards").select("id, deck, question, answer, topic_id, min_level_override, sort_order, topics(min_level)").order("sort_order"),
    supabase.from("card_mastery").select("card_id").eq("user_id", access.user_id).eq("mastered", true),
  ]);
  // A card's level is its own override, or its topic's level.
  const cards = ((data ?? []) as unknown as Row[])
    .filter((c) => (c.min_level_override ?? c.topics?.min_level ?? 9) <= level.level)
    .map(({ id, deck, question, answer, topic_id }) => ({ id, deck, question, answer, topic_id }));

  return (
    <>
      <LevelTabs held={held} current={level.level} base="/sprint/cards" label="Card level" />
      <p className="muted">{cards.length} cards for {level.name}.</p>
      <CardsView cards={cards} initialMastered={(mastery ?? []).map((m) => m.card_id)} />
    </>
  );
}
