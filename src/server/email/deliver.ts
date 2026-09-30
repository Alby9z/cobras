import "server-only";
import crypto from "node:crypto";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { getSettings } from "@/server/settings";
import { emailProvider } from "@/server/email/provider";
import { renderEmail } from "@/server/email/render";
import { TEMPLATES, type TemplateName } from "@/server/email/templates";
import { siteUrl } from "@/lib/utils";

/** Jeton de désinscription (HMAC) : aucune donnée personnelle dans l'URL hormis l'identifiant. */
export function unsubscribeToken(userId: string) {
  return crypto.createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(`unsubscribe:${userId}`).digest("base64url").slice(0, 32);
}
export function unsubscribeUrl(userId: string) {
  return siteUrl(`/api/desinscription?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId)}`);
}

/** Tâche worker : envoi effectif (idempotent côté fournisseur via dedupeKey). */
export async function deliverEmail(emailLogId: string) {
  const log = await db.emailLog.findUnique({ where: { id: emailLogId } });
  if (!log) throw new Error("EMAIL_LOG_NOT_FOUND"); // transaction pas encore validée : nouvelle tentative
  if (log.status === "SENT") return;
  const payload = (log.payload ?? {}) as { params?: unknown; attachInvoiceId?: string | null };
  const tpl = TEMPLATES[log.template as TemplateName];
  if (!tpl || !payload.params) throw new Error("EMAIL_TEMPLATE_OR_PAYLOAD_MISSING");
  const content = (tpl.render as (p: unknown) => ReturnType<(typeof TEMPLATES)["ADMIN_ALERT"]["render"]>)(payload.params);
  if (content.marketing && log.userId) {
    const u = await db.user.findUnique({ where: { id: log.userId }, select: { marketingOptIn: true } });
    if (!u?.marketingOptIn) {
      await db.emailLog.update({ where: { id: log.id }, data: { status: "FAILED", error: "Consentement retiré avant envoi", payload: undefined } });
      return;
    }
  }
  let attachments: { filename: string; content: Buffer }[] | undefined;
  if (payload.attachInvoiceId) {
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: payload.attachInvoiceId } });
    if (inv.pdfStatus !== "READY" || !inv.pdfStorageKey) throw new Error("INVOICE_PDF_NOT_READY");
    attachments = [{ filename: `${inv.number}.pdf`, content: await storage().get("private", inv.pdfStorageKey) }];
  }
  const settings = await getSettings();
  const unsub = content.marketing && log.userId ? unsubscribeUrl(log.userId) : undefined;
  const { html, text } = renderEmail(content, settings, unsub);
  try {
    const res = await emailProvider().send({
      to: log.to, subject: log.subject, html, text, idempotencyKey: log.dedupeKey.slice(0, 256), attachments,
      headers: unsub ? { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
    });
    await db.emailLog.update({ where: { id: log.id }, data: { status: "SENT", providerId: res.id, sentAt: new Date(), error: null, payload: { erased: true } } });
  } catch (e) {
    await db.emailLog.update({ where: { id: log.id }, data: { retryCount: { increment: 1 }, error: (e as Error).message.slice(0, 500) } });
    throw e;
  }
}
