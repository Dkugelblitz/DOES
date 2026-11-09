import { redirect } from "next/navigation";

export default async function SprintIndex({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const level = (await searchParams).level;
  redirect(level && /^[123]$/.test(level) ? `/sprint/plan?level=${level}` : "/sprint/plan");
}
