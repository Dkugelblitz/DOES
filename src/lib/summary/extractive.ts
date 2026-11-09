// Extractive summariser (same idea as the prototype dashboard): score each sentence by how often
// its words appear across all the material, normalised by length, keep the top N, and return
// them in their original order. Pure: no imports, so it runs anywhere and is unit-tested.

export type SummaryInput = {
  title: string;
  notes: string;                                 // Markdown
  excerpts: { title?: string | null; text: string }[];
};
export type SummaryResult = { points: string[]; engine: string };

const STOP = new Set("about above after again against also among because been before being below between both could does doing down during each from further have having here into itself just more most must only other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your youre".split(" "));

/** Markdown to plain sentences: drop code, links' URLs, images, headings marks, list bullets. */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, "$1.")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/gm, "$1.")
    .replace(/[*_~>|]/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSentences(text: string, minChars: number): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= minChars);
}

const words = (s: string) => s.toLowerCase().match(/[a-z][a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];

export function extractiveSummary(input: SummaryInput, maxPoints = 4, minSentenceChars = 25): SummaryResult {
  const text = [plainText(input.notes), ...input.excerpts.map((e) => plainText(e.text))].filter(Boolean).join(" ");
  const sentences = [...new Set(splitSentences(text, minSentenceChars))];
  if (!sentences.length) return { points: [], engine: "extractive" };
  const freq = new Map<string, number>();
  for (const w of words(text)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const scored = sentences.map((s, i) => ({ s, i, v: words(s).reduce((a, w) => a + (freq.get(w) ?? 0), 0) / Math.sqrt(s.length) }));
  const top = scored.sort((a, b) => b.v - a.v || a.i - b.i).slice(0, maxPoints).sort((a, b) => a.i - b.i);
  return { points: top.map((t) => t.s), engine: "extractive" };
}
