import type { ZodError } from "zod";
import { isAppError } from "@/lib/domain/errors";

export type ActionState = { ok?: string; error?: string; code?: string; fieldErrors?: Record<string, string>; redirectTo?: string } | null;

export function zodErrors(e: ZodError): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const i of e.issues) {
    const k = i.path.join(".");
    if (!fieldErrors[k]) fieldErrors[k] = i.message;
  }
  return { error: "Merci de corriger les champs signalés.", code: "VALIDATION_ERROR", fieldErrors };
}

/** Convertit une erreur en état d'action : message métier si connu, message générique sinon. */
export function toActionError(e: unknown): ActionState {
  if (isAppError(e)) return { error: e.message, code: e.code };
  // Les redirections Next.js (redirect/notFound) doivent se propager.
  const digest = (e as { digest?: string })?.digest;
  if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR") || digest === "NEXT_NOT_FOUND")) throw e;
  console.error(JSON.stringify({ level: "error", msg: "action.unhandled", error: (e as Error)?.message }));
  return { error: "Une erreur est survenue. Réessayez ; si le problème persiste, contactez-nous.", code: "INTERNAL_ERROR" };
}
