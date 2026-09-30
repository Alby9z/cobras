"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { assertPermission } from "@/server/session";
import { assignableRoles } from "@/lib/domain/permissions";
import { audit } from "@/server/audit";
import { SETTING_KEYS } from "@/server/settings";
import { CMS_SLUGS } from "@/lib/cms";
import { COUNTRIES } from "@/lib/geo-fr";
import { zodErrors, toActionError, type ActionState } from "@/lib/action-state";
import type { Role } from "@/generated/prisma/enums";

const optStr = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const idOpt = z.string().max(40).optional().or(z.literal(""));
const cents = z.string().trim().transform((v) => Math.round(Number(v.replace(",", ".")) * 100)).refine((v) => Number.isInteger(v) && v >= 0, "Montant invalide.");
const optCents = z.string().trim().optional().transform((v) => (v ? Math.round(Number(v.replace(",", ".")) * 100) : null));

// ───────── Livraison ─────────
export async function saveShippingRate(_: ActionState, fd: FormData): Promise<ActionState> {
  let user;
  try { user = await assertPermission("shipping.write"); } catch (e) { return toActionError(e); }
  const parsed = z.object({
    id: idOpt, name: z.string().trim().min(2).max(100), method: z.enum(["PICKUP", "SPECIALIZED_CARRIER", "STANDARD_PARCEL"]),
    price: cents, freeAbove: optCents, position: z.coerce.number().int().default(0), active: z.string().optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const countries = fd.getAll("countries").map(String).filter((c) => c in COUNTRIES);
  const { id, price, freeAbove, active, ...d } = parsed.data;
  if (d.method !== "PICKUP" && countries.length === 0) return { error: "Sélectionnez au moins un pays desservi." };
  const data = { ...d, priceCents: price, freeAboveCents: freeAbove, countries, active: active === "on" };
  if (id) await db.shippingRate.update({ where: { id }, data }); else await db.shippingRate.create({ data });
  await audit({ actor: user, action: "shipping.save", entity: "shipping_rate", entityId: id || undefined });
  revalidatePath("/admin/livraison");
  return { ok: "Tarif enregistré." };
}

// ───────── Coupons ─────────
export async function saveCoupon(_: ActionState, fd: FormData): Promise<ActionState> {
  let user;
  try { user = await assertPermission("marketing.write"); } catch (e) { return toActionError(e); }
  const parsed = z.object({
    id: idOpt, code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, "3 à 40 caractères : lettres, chiffres, - ou _."),
    type: z.enum(["PERCENT", "FIXED", "FREE_SHIPPING"]), value: z.string().trim().default("0"),
    minOrder: optCents, maxUses: z.string().trim().optional().transform((v) => (v ? Number(v) : null)),
    startsAt: optStr(30), endsAt: optStr(30), accessoriesOnly: z.string().optional(), active: z.string().optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const d = parsed.data;
  const num = Number(d.value.replace(",", "."));
  const value = d.type === "PERCENT" ? Math.round(num) : d.type === "FIXED" ? Math.round(num * 100) : 0;
  if (d.type === "PERCENT" && (value < 1 || value > 100)) return { error: "Pourcentage entre 1 et 100." };
  if (d.type === "FIXED" && value <= 0) return { error: "Montant invalide." };
  if (await db.coupon.findFirst({ where: { code: d.code, NOT: d.id ? { id: d.id } : undefined } })) return { error: "Ce code existe déjà." };
  const data = { code: d.code, type: d.type, value, minOrderCents: d.minOrder ?? 0, maxUses: d.maxUses, startsAt: d.startsAt ? new Date(d.startsAt) : null, endsAt: d.endsAt ? new Date(d.endsAt) : null, accessoriesOnly: d.accessoriesOnly === "on", active: d.active === "on" };
  if (d.id) await db.coupon.update({ where: { id: d.id }, data }); else await db.coupon.create({ data });
  await audit({ actor: user, action: "coupon.save", entity: "coupon", entityId: d.id || undefined, data: { code: d.code } });
  revalidatePath("/admin/coupons");
  return { ok: "Code enregistré." };
}

// ───────── FAQ ─────────
export async function saveFaq(_: ActionState, fd: FormData): Promise<ActionState> {
  try { await assertPermission("content.write"); } catch (e) { return toActionError(e); }
  const parsed = z.object({ id: idOpt, question: z.string().trim().min(5).max(300), answer: z.string().trim().min(5).max(5000), position: z.coerce.number().int().default(0), onHome: z.string().optional(), published: z.string().optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, onHome, published, ...d } = parsed.data;
  const data = { ...d, onHome: onHome === "on", published: published === "on" };
  if (id) await db.faq.update({ where: { id }, data }); else await db.faq.create({ data });
  revalidatePath("/", "layout");
  return { ok: "Question enregistrée." };
}

export async function deleteFaq(fd: FormData) {
  await assertPermission("content.write");
  await db.faq.delete({ where: { id: z.string().max(40).parse(fd.get("id")) } });
  revalidatePath("/", "layout");
}

// ───────── Témoignages ─────────
export async function saveTestimonial(_: ActionState, fd: FormData): Promise<ActionState> {
  try { await assertPermission("content.write"); } catch (e) { return toActionError(e); }
  const parsed = z.object({
    id: idOpt, author: z.string().trim().min(2).max(100), location: optStr(100), content: z.string().trim().min(10).max(2000),
    consentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date du consentement écrit requise."), published: z.string().optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, published, consentAt, ...d } = parsed.data;
  const data = { ...d, consentAt: new Date(consentAt), published: published === "on" };
  if (id) await db.testimonial.update({ where: { id }, data }); else await db.testimonial.create({ data });
  revalidatePath("/", "layout");
  return { ok: "Témoignage enregistré." };
}

export async function deleteTestimonial(fd: FormData) {
  await assertPermission("content.write");
  await db.testimonial.delete({ where: { id: z.string().max(40).parse(fd.get("id")) } });
  revalidatePath("/", "layout");
}

// ───────── Pages ─────────
export async function savePage(_: ActionState, fd: FormData): Promise<ActionState> {
  let user;
  try { user = await assertPermission("content.write"); } catch (e) { return toActionError(e); }
  const parsed = z.object({ slug: z.string().refine((s) => CMS_SLUGS.includes(s)), title: z.string().trim().min(2).max(120), content: z.string().trim().min(20, "Contenu trop court.").max(100000), metaDescription: optStr(170), published: z.string().optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const { slug, published, ...d } = parsed.data;
  await db.page.upsert({ where: { slug }, create: { slug, ...d, published: published === "on" }, update: { ...d, published: published === "on" } });
  await audit({ actor: user, action: "page.save", entity: "page", entityId: slug });
  revalidatePath("/", "layout");
  return { ok: "Page enregistrée." };
}

// ───────── Demandes (CRM) ─────────
export async function updateRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  try { await assertPermission("crm.write"); } catch (e) { return toActionError(e); }
  const parsed = z.object({ id: z.string().max(40), status: z.enum(["NEW", "IN_PROGRESS", "CLOSED"]), assignedToId: optStr(40), internalNotes: optStr(10000) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...d } = parsed.data;
  await db.contactRequest.update({ where: { id }, data: d });
  revalidatePath("/admin/demandes");
  return { ok: "Demande mise à jour." };
}

// ───────── Utilisateurs ─────────
export async function updateUser(_: ActionState, fd: FormData): Promise<ActionState> {
  let actor;
  try { actor = await assertPermission("users.write"); } catch (e) { return toActionError(e); }
  const parsed = z.object({ id: z.string().max(60), role: z.string(), banned: z.string().optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Données invalides." };
  if (parsed.data.id === actor.id) return { error: "Vous ne pouvez pas modifier votre propre rôle ni bloquer votre compte." };
  const target = await db.user.findUniqueOrThrow({ where: { id: parsed.data.id } });
  const allowed = assignableRoles(actor.role);
  // On ne peut ni attribuer ni retirer un rôle supérieur ou égal au sien.
  if (!allowed.includes(parsed.data.role as Role) || (target.role !== parsed.data.role && !allowed.includes(target.role))) return { error: "Vous ne pouvez pas attribuer ou retirer ce rôle." };
  const banned = parsed.data.banned === "on";
  await db.user.update({ where: { id: parsed.data.id }, data: { role: parsed.data.role as Role, banned } });
  if (banned || target.role !== parsed.data.role) await db.session.deleteMany({ where: { userId: parsed.data.id } }); // nouvelle connexion obligatoire
  await audit({ actor, action: "user.permissions", entity: "user", entityId: parsed.data.id, before: { role: target.role, banned: target.banned }, after: { role: parsed.data.role, banned } });
  revalidatePath("/admin/utilisateurs");
  return { ok: "Utilisateur mis à jour." };
}

// ───────── Paramètres ─────────
export async function saveSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  let user;
  try { user = await assertPermission("settings.write"); } catch (e) { return toActionError(e); }
  const entries = Object.keys(SETTING_KEYS).map((k) => [k, String(fd.get(k) ?? "").trim().slice(0, 5000)] as const);
  const val = Object.fromEntries(entries) as Record<string, string>;
  if (val.vatRegime && !["NORMAL", "FRANCHISE"].includes(val.vatRegime)) return { error: "Régime de TVA : NORMAL ou FRANCHISE." };
  if (val.paymentStrategyAnimals && !["PAY_IMMEDIATELY", "AUTHORIZE_THEN_CAPTURE", "DEPOSIT_THEN_BALANCE", "PAY_AFTER_COMPLIANCE"].includes(val.paymentStrategyAnimals)) return { error: "Stratégie de paiement inconnue." };
  for (const k of ["reservationMinutes", "complianceHoldHours", "balancePaymentHours", "abandonedCartDelayHours"]) if (val[k] && !/^\d+$/.test(val[k])) return { error: `${k} : nombre entier attendu.` };
  const before = await db.setting.findMany();
  const lat = entries.find(([k]) => k === "latitude")?.[1];
  const lng = entries.find(([k]) => k === "longitude")?.[1];
  if ((lat && !Number.isFinite(Number(lat))) || (lng && !Number.isFinite(Number(lng)))) return { error: "Coordonnées GPS invalides." };
  for (const [k, v] of entries) {
    if (k.match(/^(instagram|facebook)$/) && v && !/^https:\/\//.test(v)) return { error: `URL invalide pour ${k} (https:// requis).` };
  }
  await db.$transaction(entries.map(([key, value]) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })));
  await audit({ actor: user, action: "settings.save", entity: "setting", before: Object.fromEntries(before.map((b) => [b.key, b.value])), after: val });
  revalidatePath("/", "layout");
  return { ok: "Paramètres enregistrés." };
}
