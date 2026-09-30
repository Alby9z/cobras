import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

/** Contexte de corrélation : requête HTTP (en-têtes Next) ou tâche de fond (worker). */
export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  source: "http" | "worker" | "webhook" | "system";
}

const als = new AsyncLocalStorage<RequestContext>();

/** Exécute fn dans un contexte explicite (worker, webhook, tests). */
export function runWithContext<T>(ctx: Partial<RequestContext>, fn: () => Promise<T>): Promise<T> {
  return als.run({ requestId: ctx.requestId ?? crypto.randomUUID(), ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null, source: ctx.source ?? "system" }, fn);
}

export async function getContext(): Promise<RequestContext> {
  const stored = als.getStore();
  if (stored) return stored;
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return {
      requestId: h.get("x-request-id") ?? crypto.randomUUID(),
      // Derrière le reverse proxy : X-Forwarded-For est réécrit par le proxy (première valeur = client).
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      source: "http",
    };
  } catch {
    return { requestId: crypto.randomUUID(), ip: null, userAgent: null, source: "system" };
  }
}
