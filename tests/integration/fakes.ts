import type Stripe from "stripe";
import { setStripeClient } from "@/server/stripe";
import { setStorageProvider, type StorageProvider } from "@/server/storage";
import { setQueueDriver, type JobName } from "@/server/queue";
import { setEmailProvider } from "@/server/email/provider";

/** Double de Stripe : reproduit les états PaymentIntent utilisés par la plateforme. */
export class FakeStripe {
  sessions = new Map<string, { id: string; status: string; url: string; payment_intent: string; metadata: Record<string, string> }>();
  intents = new Map<string, { id: string; status: string; amount: number; capture_method: string; metadata: Record<string, string>; last_payment_error: null | { code: string; message: string } }>();
  refundsList: { id: string; amount: number; payment_intent: string; status: string; reason: string | null }[] = [];
  seq = 0;
  calls: string[] = [];
  failCheckout = false;
  client = {
    checkout: {
      sessions: {
        create: async (p: Stripe.Checkout.SessionCreateParams) => {
          this.calls.push("session.create");
          if (this.failCheckout) throw new Error("stripe down");
          const id = `cs_${++this.seq}`;
          const pi = `pi_${this.seq}`;
          this.intents.set(pi, { id: pi, status: "requires_payment_method", amount: p.line_items![0].price_data!.unit_amount!, capture_method: p.payment_intent_data?.capture_method ?? "automatic", metadata: (p.payment_intent_data?.metadata ?? {}) as Record<string, string>, last_payment_error: null });
          const s = { id, status: "open", url: `https://checkout.stripe.test/${id}`, payment_intent: pi, metadata: (p.metadata ?? {}) as Record<string, string> };
          this.sessions.set(id, s);
          return s;
        },
        retrieve: async (id: string) => this.sessions.get(id)!,
        expire: async (id: string) => { const s = this.sessions.get(id)!; s.status = "expired"; return s; },
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => ({ ...this.intents.get(id)!, latest_charge: { payment_method_details: { card: { capture_before: Math.floor(Date.now() / 1000) + 6 * 86400 } } } }),
      capture: async (id: string) => { this.calls.push("pi.capture"); const pi = this.intents.get(id)!; if (pi.status !== "requires_capture") throw new Error("not capturable"); pi.status = "succeeded"; return pi; },
      cancel: async (id: string) => { this.calls.push("pi.cancel"); const pi = this.intents.get(id)!; pi.status = "canceled"; return pi; },
    },
    refunds: {
      create: async (p: { payment_intent: string; amount: number }, o?: { idempotencyKey?: string }) => {
        this.calls.push(`refund:${o?.idempotencyKey}`);
        const existing = this.refundsList.find((r) => (r as unknown as { key?: string }).key === o?.idempotencyKey);
        if (existing) return existing;
        const r = { id: `re_${++this.seq}`, amount: p.amount, payment_intent: p.payment_intent, status: "succeeded", reason: null, key: o?.idempotencyKey };
        this.refundsList.push(r);
        return r;
      },
      list: async (p: { payment_intent: string }) => ({ data: this.refundsList.filter((r) => r.payment_intent === p.payment_intent) }),
    },
  };
  /** Le client paie sur la page Stripe : renvoie l'événement webhook correspondant. */
  pay(sessionId: string, outcome: "succeeded" | "requires_capture" | "failed"): Stripe.Event {
    const s = this.sessions.get(sessionId)!;
    const pi = this.intents.get(s.payment_intent)!;
    if (outcome === "failed") { pi.status = "requires_payment_method"; pi.last_payment_error = { code: "card_declined", message: "Carte refusée" }; }
    else pi.status = outcome;
    s.status = "complete";
    return { id: `evt_${++this.seq}`, type: outcome === "failed" ? "payment_intent.payment_failed" : "checkout.session.completed", data: { object: outcome === "failed" ? pi : { ...s, payment_status: outcome === "succeeded" ? "paid" : "unpaid" } } } as unknown as Stripe.Event;
  }
}

export class MemoryStorage implements StorageProvider {
  objects = new Map<string, Buffer>();
  async put(b: string, k: string, body: Buffer) { this.objects.set(`${b}/${k}`, body); }
  async get(b: string, k: string) { const v = this.objects.get(`${b}/${k}`); if (!v) throw new Error("NoSuchKey"); return v; }
  async remove(b: string, k: string) { this.objects.delete(`${b}/${k}`); }
  async copy(b: string, from: string, to: string) { this.objects.set(`${b}/${to}`, await this.get(b, from)); }
  async signedDownloadUrl(k: string) { return `https://storage.test/${k}?sig=1`; }
  async ping() {}
}

export const jobs: { name: JobName; data: unknown }[] = [];
export const sentEmails: { to: string; subject: string; key: string }[] = [];

export function installFakes() {
  const fake = new FakeStripe();
  setStripeClient(fake.client as unknown as Stripe);
  const store = new MemoryStorage();
  setStorageProvider(store);
  setQueueDriver({ add: async (name, data) => { jobs.push({ name, data }); } });
  setEmailProvider({ send: async (m) => { sentEmails.push({ to: m.to, subject: m.subject, key: m.idempotencyKey }); return { id: `em_${sentEmails.length}` }; } });
  return { fake, store };
}
