import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { db, nextSequence, type Tx } from "@/server/db";
import { getSettings, type Settings } from "@/server/settings";
import { allocate } from "@/lib/domain/pricing";
import { AppError } from "@/lib/domain/errors";
import type { InvoiceKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export interface InvoiceLine {
  label: string;
  quantity: number;
  unitCents: number; // TTC
  taxRateBps: number;
  totalExclTaxCents: number;
  taxCents: number;
  totalCents: number;
}
export interface VatRow { rateBps: number; baseCents: number; taxCents: number }

const LABEL: Record<InvoiceKind, string> = { INVOICE: "Facture", DEPOSIT_INVOICE: "Facture d'acompte", BALANCE_INVOICE: "Facture de solde", CREDIT_NOTE: "Avoir" };

/** Champs vendeur indispensables à l'émission d'une facture (aucune valeur n'est inventée). */
export const REQUIRED_SELLER_SETTINGS = ["companyName", "legalForm", "siret", "addressLine", "postalCode", "city", "vatRegime"] as const;

export function sellerSnapshot(s: Settings) {
  const missing = REQUIRED_SELLER_SETTINGS.filter((k) => !s[k]);
  if (missing.length) throw new AppError("CONFIGURATION_ERROR", "Identité du vendeur incomplète : facturation impossible.", { missing });
  if (s.vatRegime !== "NORMAL" && s.vatRegime !== "FRANCHISE") throw new AppError("CONFIGURATION_ERROR", "Régime de TVA invalide.", { vatRegime: s.vatRegime });
  if (s.vatRegime === "NORMAL" && !s.vatNumber) throw new AppError("CONFIGURATION_ERROR", "N° de TVA intracommunautaire manquant.", { missing: ["vatNumber"] });
  return {
    companyName: s.companyName, legalForm: s.legalForm, shareCapital: s.shareCapital ?? null, siret: s.siret, rcs: s.rcs ?? null, vatNumber: s.vatNumber ?? null,
    address: [s.addressLine, `${s.postalCode} ${s.city}`, s.country ?? "FR"], email: s.email ?? null, phone: s.phone ?? null,
    capacityCertificate: s.capacityCertificate ?? null, vatRegime: s.vatRegime,
  };
}

function orderVat(order: { items: { taxRateBps: number; totalExclTaxCents: number; taxCents: number }[]; shippingTaxRateBps: number; shippingExclTaxCents: number; shippingCents: number }): VatRow[] {
  const m = new Map<number, VatRow>();
  const add = (rateBps: number, base: number, tax: number) => {
    if (base + tax === 0) return;
    const r = m.get(rateBps) ?? { rateBps, baseCents: 0, taxCents: 0 };
    r.baseCents += base;
    r.taxCents += tax;
    m.set(rateBps, r);
  };
  for (const i of order.items) add(i.taxRateBps, i.totalExclTaxCents, i.taxCents);
  add(order.shippingTaxRateBps, order.shippingExclTaxCents, order.shippingCents - order.shippingExclTaxCents);
  return [...m.values()].sort((a, b) => a.rateBps - b.rateBps);
}

/** Répartit un montant TTC selon la ventilation TVA de référence (acomptes, avoirs). */
function prorata(amountCents: number, ref: VatRow[]): VatRow[] {
  const parts = allocate(amountCents, ref.map((r) => r.baseCents + r.taxCents));
  return ref.map((r, i) => {
    const incl = parts[i];
    const tax = r.baseCents + r.taxCents === 0 ? 0 : Math.round((incl * r.taxCents) / (r.baseCents + r.taxCents));
    return { rateBps: r.rateBps, baseCents: incl - tax, taxCents: tax };
  }).filter((r) => r.baseCents + r.taxCents > 0);
}

/**
 * Émet une facture (ou un avoir) : numérotation continue par type et par année, snapshot complet et figé.
 * Idempotent par paiement (paymentId+kind) et par remboursement (refundId). Le PDF est produit par le worker.
 */
export async function issueInvoice(tx: Tx, input: { kind: InvoiceKind; orderId: string; paymentId?: string; refundId?: string; amountCents: number; creditedInvoiceId?: string }) {
  if (input.paymentId) {
    const existing = await tx.invoice.findFirst({ where: { paymentId: input.paymentId, kind: input.kind } });
    if (existing) return existing;
  }
  if (input.refundId) {
    const existing = await tx.invoice.findFirst({ where: { refundId: input.refundId } });
    if (existing) return existing;
  }
  const s = await getSettings();
  const seller = sellerSnapshot(s);
  const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { items: true, user: true, invoices: true } });
  const billing = order.billingAddress as Record<string, string | null>;
  const customer = { name: `${order.user.firstName} ${order.user.lastName}`, email: order.user.email, company: billing.company ?? null, address: [billing.line1, billing.line2, `${billing.postalCode} ${billing.city}`, billing.country].filter(Boolean) };
  const fullVat = orderVat(order);

  let lines: InvoiceLine[];
  let vat: VatRow[];
  if (input.kind === "INVOICE" || input.kind === "BALANCE_INVOICE") {
    lines = order.items.map((i) => ({ label: i.name + (i.sku ? ` (${i.sku})` : ""), quantity: i.quantity, unitCents: i.unitCents, taxRateBps: i.taxRateBps, totalExclTaxCents: i.totalExclTaxCents, taxCents: i.taxCents, totalCents: i.totalCents }));
    const itemDiscount = order.items.reduce((s2, i) => s2 + i.discountCents, 0);
    if (itemDiscount) lines.push({ label: `Remise${order.couponCode ? ` ${order.couponCode}` : ""} (incluse dans les montants ci-dessus)`, quantity: 1, unitCents: 0, taxRateBps: 0, totalExclTaxCents: 0, taxCents: 0, totalCents: 0 });
    if (order.shippingCents) lines.push({ label: `Livraison — ${order.shippingRateName}`, quantity: 1, unitCents: order.shippingCents, taxRateBps: order.shippingTaxRateBps, totalExclTaxCents: order.shippingExclTaxCents, taxCents: order.shippingCents - order.shippingExclTaxCents, totalCents: order.shippingCents });
    vat = fullVat.map((r) => ({ ...r }));
    if (input.kind === "BALANCE_INVOICE") {
      for (const dep of order.invoices.filter((i) => i.kind === "DEPOSIT_INVOICE")) {
        lines.push({ label: `Déduction facture d'acompte ${dep.number}`, quantity: 1, unitCents: -dep.totalCents, taxRateBps: 0, totalExclTaxCents: -dep.totalExclTaxCents, taxCents: -dep.taxCents, totalCents: -dep.totalCents });
        for (const d of dep.vatBreakdown as unknown as VatRow[]) {
          const row = vat.find((v) => v.rateBps === d.rateBps);
          if (row) { row.baseCents -= d.baseCents; row.taxCents -= d.taxCents; }
        }
      }
    }
  } else if (input.kind === "DEPOSIT_INVOICE") {
    vat = prorata(input.amountCents, fullVat);
    lines = vat.map((v) => ({ label: `Acompte sur commande ${order.number} (TVA ${v.rateBps / 100} %)`, quantity: 1, unitCents: v.baseCents + v.taxCents, taxRateBps: v.rateBps, totalExclTaxCents: v.baseCents, taxCents: v.taxCents, totalCents: v.baseCents + v.taxCents }));
  } else {
    const credited = input.creditedInvoiceId ? await tx.invoice.findUniqueOrThrow({ where: { id: input.creditedInvoiceId } }) : null;
    vat = prorata(input.amountCents, credited ? (credited.vatBreakdown as unknown as VatRow[]) : fullVat);
    lines = vat.map((v) => ({ label: `Remboursement${credited ? ` — facture ${credited.number}` : ""} (TVA ${v.rateBps / 100} %)`, quantity: 1, unitCents: v.baseCents + v.taxCents, taxRateBps: v.rateBps, totalExclTaxCents: v.baseCents, taxCents: v.taxCents, totalCents: v.baseCents + v.taxCents }));
  }
  const totalExcl = vat.reduce((a, v) => a + v.baseCents, 0);
  const tax = vat.reduce((a, v) => a + v.taxCents, 0);
  if (totalExcl + tax !== input.amountCents) throw new AppError("INTERNAL_ERROR", "Incohérence de montant lors de la facturation.", { expected: input.amountCents, computed: totalExcl + tax });

  const year = new Date().getUTCFullYear();
  const series = input.kind === "CREDIT_NOTE" ? "AV" : "FA";
  const seq = await nextSequence(tx, `invoice-${series}-${year}`);
  const mentions = [s.vatRegime === "FRANCHISE" ? s.vatNote : null, s.invoiceLegalMentions].filter(Boolean).join("\n") || null;
  return tx.invoice.create({
    data: {
      number: `${series}-${year}-${String(seq).padStart(6, "0")}`, kind: input.kind, orderId: order.id, paymentId: input.paymentId ?? null, refundId: input.refundId ?? null,
      creditedInvoiceId: input.creditedInvoiceId ?? null, seller: seller as Prisma.InputJsonValue, customer: customer as Prisma.InputJsonValue,
      lines: lines as unknown as Prisma.InputJsonValue, vatBreakdown: vat as unknown as Prisma.InputJsonValue, totalExclTaxCents: totalExcl, taxCents: tax, totalCents: input.amountCents,
      legalMentions: mentions,
    },
  });
}

// ───────────────────────── PDF (exécuté par le worker) ─────────────────────────

const eur = (c: number) => (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, " ") + " EUR";
const safe = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");

export async function renderInvoicePdf(invoiceId: string): Promise<{ number: string; pdf: Buffer }> {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { order: { select: { number: true } }, creditedInvoice: { select: { number: true } } } });
  const seller = inv.seller as ReturnType<typeof sellerSnapshot>;
  const customer = inv.customer as { name: string; email: string; company: string | null; address: string[] };
  const lines = inv.lines as unknown as InvoiceLine[];
  const vat = inv.vatBreakdown as unknown as VatRow[];

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${LABEL[inv.kind]} ${inv.number}`);
  pdf.setAuthor(seller.companyName ?? "");
  let page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 800;
  const text = (t: string, x: number, size = 9, f: PDFFont = font, color = rgb(0.1, 0.1, 0.1)) => page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, xr: number, size = 9, f: PDFFont = font) => page.drawText(safe(t), { x: xr - f.widthOfTextAtSize(safe(t), size), y, size, font: f });

  text(seller.companyName ?? "", 50, 15, bold);
  right(`${LABEL[inv.kind]} n° ${inv.number}`, 545, 12, bold);
  y -= 16;
  right(`Date d'émission : ${inv.issuedAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}`, 545);
  y -= 12;
  right(`Commande : ${inv.order.number}`, 545);
  if (inv.creditedInvoice) { y -= 12; right(`Avoir sur facture : ${inv.creditedInvoice.number}`, 545); }
  y = 780;
  for (const l of [
    [seller.legalForm, seller.shareCapital ? `au capital de ${seller.shareCapital}` : null].filter(Boolean).join(" "),
    ...(seller.address ?? []), seller.siret ? `SIRET ${seller.siret}` : null, seller.rcs, seller.vatNumber ? `TVA ${seller.vatNumber}` : null,
    seller.capacityCertificate ? `Certificat de capacité n° ${seller.capacityCertificate}` : null,
  ].filter(Boolean) as string[]) { text(l, 50, 8); y -= 11; }

  y = 660;
  text("Facturé à", 330, 9, bold); y -= 13;
  for (const l of [customer.name, customer.company, ...customer.address, customer.email].filter(Boolean) as string[]) { text(l, 330, 9); y -= 12; }

  y = 560;
  const header = () => {
    page.drawRectangle({ x: 50, y: y - 4, width: 495, height: 16, color: rgb(0.92, 0.94, 0.92) });
    text("Désignation", 54, 8, bold); right("Qté", 330, 8, bold); right("PU TTC", 385, 8, bold); right("TVA", 420, 8, bold); right("Total HT", 480, 8, bold); right("Total TTC", 541, 8, bold);
    y -= 18;
  };
  header();
  for (const l of lines) {
    if (y < 140) { page = pdf.addPage([595.28, 841.89]); y = 800; header(); }
    text(l.label.slice(0, 62), 54, 8);
    right(String(l.quantity), 330, 8); right(eur(l.unitCents), 385, 8); right(`${l.taxRateBps / 100} %`, 420, 8); right(eur(l.totalExclTaxCents), 480, 8); right(eur(l.totalCents), 541, 8);
    y -= 13;
  }
  y -= 10;
  for (const v of vat) { right(`Base HT ${v.rateBps / 100} % : ${eur(v.baseCents)}   TVA : ${eur(v.taxCents)}`, 541, 8); y -= 12; }
  y -= 4;
  right(`Total HT : ${eur(inv.totalExclTaxCents)}`, 541, 9); y -= 13;
  right(`Total TVA : ${eur(inv.taxCents)}`, 541, 9); y -= 15;
  right(`${inv.kind === "CREDIT_NOTE" ? "Montant de l'avoir TTC" : "Total TTC"} : ${eur(inv.totalCents)}`, 541, 11, bold);
  y -= 26;
  if (inv.kind !== "CREDIT_NOTE") { text(inv.kind === "DEPOSIT_INVOICE" ? "Acompte réglé par carte bancaire (Stripe)." : "Réglé par carte bancaire (Stripe).", 50, 8); y -= 12; }
  for (const m of (inv.legalMentions ?? "").split("\n").filter(Boolean)) { text(m.slice(0, 120), 50, 7, font, rgb(0.35, 0.35, 0.35)); y -= 10; }
  return { number: inv.number, pdf: Buffer.from(await pdf.save()) };
}

export async function invoicesForUser(userId: string) {
  return db.invoice.findMany({ where: { order: { userId } }, orderBy: { issuedAt: "desc" }, include: { order: { select: { number: true } } } });
}

export const invoiceKindLabel = LABEL;
