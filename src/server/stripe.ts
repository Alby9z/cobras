import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

let client: Stripe | null = null;
export function stripe(): Stripe {
  return (client ??= new Stripe(env().STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "reptile-shop" } }));
}
/** Tests d'intégration : remplace le client (le comportement réel est couvert en environnement de test Stripe). */
export function setStripeClient(c: Stripe) {
  client = c;
}
