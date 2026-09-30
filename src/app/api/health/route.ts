import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Vivacité du processus (liveness) : ne dépend d'aucun service externe. */
export function GET() {
  return NextResponse.json({ status: "ok", uptime: Math.round(process.uptime()) });
}
