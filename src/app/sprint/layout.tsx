import { Suspense } from "react";
import { requireOnboarded } from "@/lib/access";
import { Nav } from "@/components/Nav";
import { SprintTabs } from "./SprintTabs";

export default async function SprintLayout({ children }: { children: React.ReactNode }) {
  const access = await requireOnboarded();
  return (
    <main>
      <Nav current="sprint" isAdmin={access.is_admin} />
      <h1>⚡ 2-day Pareto sprint</h1>
      <Suspense fallback={null}><SprintTabs /></Suspense>
      {children}
    </main>
  );
}
