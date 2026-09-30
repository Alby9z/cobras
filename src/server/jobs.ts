import "server-only";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { enqueue } from "@/server/queue";
import { renderInvoicePdf } from "@/server/invoices";
import { sendTemplate, notifyAdmin } from "@/server/email";
import { unsubscribeUrl } from "@/server/email/deliver";
import { getSettings, intSetting } from "@/server/settings";
import { log } from "@/server/logger";

/** Génère et stocke le PDF d'une facture (le contenu est figé : seul le rendu est produit ici). */
export async function generateInvoicePdf(invoiceId: string, emailAfter: boolean) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { order: { include: { user: true } } } });
  if (inv.pdfStatus !== "READY") {
    const { number, pdf } = await renderInvoicePdf(invoiceId);
    const key = `invoices/${inv.issuedAt.getUTCFullYear()}/${number}.pdf`;
    await storage().put("private", key, pdf, "application/pdf");
    await db.invoice.update({ where: { id: invoiceId }, data: { pdfStatus: "READY", pdfStorageKey: key } });
  }
  if (emailAfter) {
    await sendTemplate("INVOICE_AVAILABLE", inv.order.user.email, { number: inv.order.number, invoiceNumber: inv.number, amountCents: inv.totalCents }, { dedupeKey: `invoice:${inv.id}:email`, userId: inv.order.userId, orderId: inv.orderId, attachInvoiceId: inv.id });
  }
}

/** Relance des paniers abandonnés : clients ayant consenti, une seule fois par panier. */
export async function remindAbandonedCarts() {
  const s = await getSettings();
  const delayH = intSetting(s, "abandonedCartDelayHours", 24, 1, 24 * 14);
  const now = Date.now();
  const carts = await db.cart.findMany({
    where: { reminderSentAt: null, userId: { not: null }, items: { some: {} }, updatedAt: { lt: new Date(now - delayH * 3600e3), gt: new Date(now - (delayH + 7 * 24) * 3600e3) }, user: { marketingOptIn: true, emailVerified: true, banned: false } },
    include: { user: true, items: { include: { product: { select: { name: true, status: true } } } } },
    take: 200,
  });
  let sent = 0;
  for (const c of carts) {
    const names = c.items.filter((i) => i.product.status === "PUBLISHED").map((i) => i.product.name);
    if (!names.length || !c.user) continue;
    // Marquage conditionnel : un seul envoi même si deux exécutions se chevauchent.
    const mark = await db.cart.updateMany({ where: { id: c.id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
    if (!mark.count) continue;
    await sendTemplate("ABANDONED_CART", c.user.email, { firstName: c.user.firstName, items: names, unsubscribeUrl: unsubscribeUrl(c.user.id) }, { dedupeKey: `cart:${c.id}:reminder:${c.updatedAt.toISOString()}`, userId: c.user.id });
    sent++;
  }
  await db.cart.deleteMany({ where: { userId: null, updatedAt: { lt: new Date(now - 30 * 24 * 3600e3) } } });
  await db.appRateLimit.deleteMany({ where: { windowEnd: { lt: new Date() } } });
  return { sent };
}

/** Autorisations bancaires proches de l'expiration alors que l'examen n'est pas terminé. */
export async function checkAuthorizations() {
  const soon = new Date(Date.now() + 36 * 3600e3);
  const list = await db.payment.findMany({ where: { status: "AUTHORIZED", authorizationExpiresAt: { lt: soon } }, include: { order: { select: { id: true, number: true, status: true } } } });
  for (const p of list) {
    await notifyAdmin(`Autorisation bientôt expirée — ${p.order.number}`, [`Expiration : ${p.authorizationExpiresAt?.toISOString()}`, "Sans décision avant cette date, un nouveau paiement devra être demandé au client."], `/admin/conformite/${p.order.id}`, `auth-expiring:${p.id}`);
  }
  return { expiring: list.length };
}

/** Alertes métier + balayage de reprise (tâches perdues si Redis était indisponible). */
export async function businessAlertsAndSweep() {
  const now = Date.now();
  const stale = new Date(now - 5 * 60e3);
  const [queuedEmails, pendingScans, pendingPdf, failedEvents, stuckDocs, stuckOrders, failedEmails] = await Promise.all([
    db.emailLog.findMany({ where: { status: "QUEUED", createdAt: { lt: stale } }, select: { id: true }, take: 500 }),
    db.document.findMany({ where: { status: "PENDING_SCAN", createdAt: { lt: stale } }, select: { id: true }, take: 200 }),
    db.invoice.findMany({ where: { pdfStatus: "PENDING", createdAt: { lt: stale } }, select: { id: true }, take: 200 }),
    db.stripeEvent.count({ where: { status: { in: ["FAILED", "RECEIVED"] }, receivedAt: { lt: stale } } }),
    db.document.count({ where: { status: "PENDING_REVIEW", createdAt: { lt: new Date(now - 48 * 3600e3) } } }),
    db.order.count({ where: { status: { in: ["DOCUMENTS_REVIEW", "COMPLIANCE_PENDING"] }, updatedAt: { lt: new Date(now - 72 * 3600e3) } } }),
    db.emailLog.count({ where: { status: "FAILED", updatedAt: { gt: new Date(now - 3600e3) } } }),
  ]);
  // Événements Stripe restés « en cours » (processus interrompu) : remis en échec pour être rejoués.
  await db.stripeEvent.updateMany({ where: { status: "PROCESSING", receivedAt: { lt: new Date(now - 10 * 60e3) } }, data: { status: "FAILED", lastError: "Traitement interrompu" } });
  for (const e of queuedEmails) await enqueue("email.send", { emailLogId: e.id }, { jobId: `email-${e.id}` }).catch(() => undefined);
  for (const d of pendingScans) await enqueue("document.scan", { documentId: d.id }, { jobId: `scan-${d.id}` }).catch(() => undefined);
  for (const i of pendingPdf) await enqueue("invoice.pdf", { invoiceId: i.id, emailAfter: true }, { jobId: `invoice-${i.id}` }).catch(() => undefined);
  const lines = [
    failedEvents && `${failedEvents} événement(s) Stripe non traité(s)`,
    stuckDocs && `${stuckDocs} document(s) en attente de validation depuis plus de 48 h`,
    stuckOrders && `${stuckOrders} commande(s) bloquée(s) en conformité depuis plus de 72 h`,
    failedEmails && `${failedEmails} e-mail(s) en échec dans la dernière heure`,
  ].filter(Boolean) as string[];
  if (lines.length) {
    const hour = new Date().toISOString().slice(0, 13);
    await notifyAdmin("Alertes d'exploitation", lines, "/admin/systeme", `alerts:${hour}`);
  }
  log.info("jobs.sweep", { requeuedEmails: queuedEmails.length, requeuedScans: pendingScans.length, requeuedPdf: pendingPdf.length, alerts: lines.length });
}
