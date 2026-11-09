import "server-only";
import { extractiveSummary, type SummaryInput, type SummaryResult } from "./extractive";

export type { SummaryInput, SummaryResult };

/**
 * The summariser interface. Pages call `summarize()` and never know which engine ran.
 * To add an LLM-backed engine later: implement `Summarizer`, register it below, and set
 * SUMMARY_ENGINE=<name>. If it fails, the extractive engine is used as a fallback.
 */
export interface Summarizer {
  readonly name: string;
  summarize(input: SummaryInput, opts: { maxPoints: number; minSentenceChars: number }): Promise<SummaryResult>;
}

const extractive: Summarizer = {
  name: "extractive",
  summarize: async (input, o) => extractiveSummary(input, o.maxPoints, o.minSentenceChars),
};

const ENGINES: Record<string, Summarizer> = { extractive };

export async function summarize(input: SummaryInput, opts = { maxPoints: 4, minSentenceChars: 25 }): Promise<SummaryResult> {
  const engine = ENGINES[process.env.SUMMARY_ENGINE ?? "extractive"] ?? extractive;
  try {
    return await engine.summarize(input, opts);
  } catch {
    return extractive.summarize(input, opts);
  }
}
