import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Target for navigator.sendBeacon when a tab is hidden or closed. Records a heartbeat so the
// running session is saved right up to this moment. Only accepts same-origin requests.
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return new NextResponse(null, { status: 403 });
  const supabase = await createClient();
  const { error } = await supabase.rpc("heartbeat_study_session");
  return new NextResponse(null, { status: error ? 400 : 204 });
}
