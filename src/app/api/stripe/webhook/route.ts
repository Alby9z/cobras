import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { stripe } from "@/server/stripe";
import { env } from "@/lib/env";
import { recordAndProcess } from "@/server/stripe-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ code: "AUTHENTICATION_ERROR", message: "missing signature" }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, env().STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ code: "AUTHENTICATION_ERROR", message: "invalid signature" }, { status: 400 });
  }
  const outcome = await recordAndProcess(event);
  // Échec : 500 → Stripe réessaie ; l'événement reste aussi rejouable depuis l'administration.
  return NextResponse.json({ received: true, outcome }, { status: outcome === "failed" ? 500 : 200 });
}
