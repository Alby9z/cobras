import { NextResponse } from "next/server";
import { dependencyHealth } from "@/server/readiness";

export const dynamic = "force-dynamic";

/** Disponibilité (readiness) : base de données et Redis joignables. */
export async function GET() {
  const deps = await dependencyHealth();
  const ok = Object.values(deps).every((d) => d.ok);
  return NextResponse.json({ status: ok ? "ready" : "degraded", deps: Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, v.ok])) }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
