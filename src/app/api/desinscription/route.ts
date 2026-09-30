import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/server/db";
import { unsubscribeToken } from "@/server/email/deliver";
import { audit } from "@/server/audit";
import { siteUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function unsubscribe(req: Request) {
  const url = new URL(req.url);
  const u = url.searchParams.get("u") ?? "";
  const t = url.searchParams.get("t") ?? "";
  const expected = unsubscribeToken(u);
  const valid = t.length === expected.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expected));
  if (valid) {
    const res = await db.user.updateMany({ where: { id: u, marketingOptIn: true }, data: { marketingOptIn: false } });
    if (res.count) await audit({ actor: null, action: "consent.marketing_withdrawn", entity: "user", entityId: u, data: { via: "email_link" } });
  }
  return valid;
}

/** Désinscription en un clic (RFC 8058) : POST sans interaction. */
export async function POST(req: Request) {
  await unsubscribe(req);
  return new NextResponse(null, { status: 204 });
}

export async function GET(req: Request) {
  const ok = await unsubscribe(req);
  return NextResponse.redirect(siteUrl(ok ? "/desinscription?ok=1" : "/desinscription?ok=0"), 303);
}
