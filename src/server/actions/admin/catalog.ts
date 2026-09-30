"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { db } from "@/server/db";
import { assertPermission } from "@/server/session";
import { audit } from "@/server/audit";
import { inspectUpload, randomKey, IMAGE_MIME } from "@/server/uploads";
import { scanBuffer } from "@/server/antivirus";
import { storage } from "@/server/storage";
import { adjustStock, setAnimalAvailability } from "@/server/inventory";
import { slugify } from "@/lib/utils";
import { AppError } from "@/lib/domain/errors";
import { toActionError, zodErrors, type ActionState } from "@/lib/action-state";

const optStr = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const optNum = z.string().trim().optional().transform((v) => (v ? Number(v.replace(",", ".")) : null)).refine((v) => v === null || Number.isFinite(v), "Nombre invalide.");
const optInt = z.string().trim().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 0), "Entier positif attendu.");
const euros = z.string().trim().min(1, "Prix requis.").transform((v) => Math.round(Number(v.replace(",", ".")) * 100)).refine((v) => Number.isInteger(v) && v >= 0, "Prix invalide.");
const optEuros = z.string().trim().optional().transform((v) => (v ? Math.round(Number(v.replace(",", ".")) * 100) : null));

// ───────── Produits (fiche commerciale) + animal (fiche individuelle) ─────────
const productSchema = z.object({
  id: z.string().max(40).optional().or(z.literal("")),
  version: z.coerce.number().int().optional(),
  type: z.enum(["ANIMAL", "ACCESSORY", "EQUIPMENT"]),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  name: z.string().trim().min(2, "Nom requis.").max(160),
  slug: z.string().trim().max(100).optional(),
  sku: optStr(60),
  shortDescription: optStr(300),
  description: z.string().trim().min(20, "Description trop courte (20 caractères min.).").max(20000),
  price: euros,
  compareAt: optEuros,
  taxRateId: z.string().min(1, "Taux de TVA requis.").max(40),
  paymentStrategy: z.enum(["", "PAY_IMMEDIATELY", "AUTHORIZE_THEN_CAPTURE", "DEPOSIT_THEN_BALANCE", "PAY_AFTER_COMPLIANCE"]).transform((v) => v || null),
  depositPercent: optNum.refine((v) => v === null || (v >= 1 && v <= 99), "Entre 1 et 99 %."),
  initialStock: optInt,
  lowStockAlert: z.coerce.number().int().min(0).default(1),
  featured: z.string().optional(),
  categoryId: optStr(40),
  ean: optStr(14).refine((v) => v === null || /^\d{8}(\d{4,6})?$/.test(v), "EAN : 8, 12, 13 ou 14 chiffres."),
  brand: optStr(80), supplier: optStr(120), purchasePrice: optEuros,
  weightGrams: optInt, lengthMm: optInt, widthMm: optInt, heightMm: optInt,
  relatedSlugs: z.string().optional(),
  metaTitle: optStr(70), metaDescription: optStr(170),
  // Animal
  speciesId: optStr(40), subspecies: optStr(120), morph: optStr(120), sex: z.enum(["MALE", "FEMALE", "UNKNOWN"]).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  sizeCm: optNum, weightG: optNum,
  origin: z.enum(["CAPTIVE_BRED", "CAPTIVE_BRED_OWN", "RANCHED", "WILD_CAUGHT", "UNKNOWN"]).optional(),
  originDetails: optStr(300), acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  identificationReference: optStr(120), healthStatus: optStr(1000), location: optStr(120), internalNotes: optStr(4000),
  careDifficulty: optNum.refine((v) => v === null || (v >= 1 && v <= 5), "Entre 1 et 5."),
  temperatureRange: optStr(120), humidityRange: optStr(120), diet: optStr(300), recommendedTerrarium: optStr(300),
  videoUrls: z.string().optional(),
});

export async function saveProduct(_: ActionState, fd: FormData): Promise<ActionState> {
  let user;
  try { user = await assertPermission("products.write"); } catch (e) { return toActionError(e); }
  const parsed = productSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const d = parsed.data;
  const isAnimal = d.type === "ANIMAL";
  if (isAnimal && !d.speciesId) return { error: "Un animal doit être rattaché à une espèce.", fieldErrors: { speciesId: "Espèce requise." } };
  if (d.compareAt != null && d.compareAt <= d.price) return { error: "Le prix barré doit être supérieur au prix.", fieldErrors: { compareAt: "Doit être supérieur au prix." } };
  if (d.paymentStrategy === "DEPOSIT_THEN_BALANCE" && !d.depositPercent) return { error: "Indiquez le pourcentage d'acompte.", fieldErrors: { depositPercent: "Requis pour un acompte." } };
  const slug = slugify(d.slug || d.name);
  if (await db.product.findFirst({ where: { slug, NOT: d.id ? { id: d.id } : undefined } })) return { error: "Cette URL est déjà utilisée.", fieldErrors: { slug: "Déjà utilisée." } };

  const productData = {
    type: d.type, status: d.status, name: d.name, slug, sku: d.sku, shortDescription: d.shortDescription, description: d.description,
    priceCents: d.price, compareAtCents: d.compareAt, taxRateId: d.taxRateId, paymentStrategy: d.paymentStrategy, depositPercent: d.depositPercent,
    lowStockAlert: d.lowStockAlert, featured: d.featured === "on", categoryId: d.categoryId, metaTitle: d.metaTitle, metaDescription: d.metaDescription,
    ean: isAnimal ? null : d.ean, brand: isAnimal ? null : d.brand, supplier: isAnimal ? null : d.supplier, purchasePriceCents: isAnimal ? null : d.purchasePrice,
    weightGrams: isAnimal ? null : d.weightGrams, lengthMm: isAnimal ? null : d.lengthMm, widthMm: isAnimal ? null : d.widthMm, heightMm: isAnimal ? null : d.heightMm,
  };
  const animalData = isAnimal ? {
    speciesId: d.speciesId!, subspecies: d.subspecies, morph: d.morph, sex: d.sex ?? "UNKNOWN", birthDate: d.birthDate ? new Date(`${d.birthDate}T00:00:00Z`) : null,
    sizeCm: d.sizeCm, weightG: d.weightG, origin: d.origin ?? "UNKNOWN", originDetails: d.originDetails, acquisitionDate: d.acquisitionDate ? new Date(`${d.acquisitionDate}T00:00:00Z`) : null,
    identificationReference: d.identificationReference, healthStatus: d.healthStatus, location: d.location, internalNotes: d.internalNotes,
    careDifficulty: d.careDifficulty, temperatureRange: d.temperatureRange, humidityRange: d.humidityRange, diet: d.diet, recommendedTerrarium: d.recommendedTerrarium,
    videoUrls: (d.videoUrls ?? "").split(/\s+/).filter((u) => /^https:\/\//.test(u)).slice(0, 6),
  } : null;

  try {
    const product = await db.$transaction(async (tx) => {
      let p;
      if (d.id) {
        const before = await tx.product.findUniqueOrThrow({ where: { id: d.id }, include: { animal: true } });
        if (before.type !== d.type) throw new AppError("VALIDATION_ERROR", "Le type d'un produit existant ne peut pas être modifié.");
        // Verrou optimiste : refuse d'écraser une modification faite entre-temps par un autre membre de l'équipe.
        const res = await tx.product.updateMany({ where: { id: d.id, version: d.version ?? -1 }, data: { ...productData, version: { increment: 1 } } });
        if (!res.count) throw new AppError("CONFLICT", "Ce produit a été modifié par quelqu'un d'autre. Rechargez la page avant d'enregistrer.");
        p = await tx.product.findUniqueOrThrow({ where: { id: d.id } });
        if (animalData) await tx.animal.update({ where: { productId: p.id }, data: animalData });
        await audit({ actor: user, action: "product.update", entity: "product", entityId: p.id, before: { priceCents: before.priceCents, status: before.status, animal: before.animal ? { speciesId: before.animal.speciesId, identificationReference: before.animal.identificationReference } : null }, after: { priceCents: p.priceCents, status: p.status } }, tx);
      } else {
        p = await tx.product.create({ data: { ...productData, stockOnHand: 0 } });
        if (animalData) {
          // Un animal est créé indisponible : il est mis en vente explicitement (contrôle de statut + journal).
          const a = await tx.animal.create({ data: { ...animalData, productId: p.id, status: "UNAVAILABLE" } });
          await tx.animalEvent.create({ data: { animalId: a.id, type: "STATUS_CHANGE", toStatus: "UNAVAILABLE", note: "Création de la fiche", actorId: user.id } });
        } else if (d.initialStock) {
          await adjustStock(tx, p.id, d.initialStock, "RECEIPT", "Stock initial", null, user);
        }
        await audit({ actor: user, action: "product.create", entity: "product", entityId: p.id, after: { name: p.name, type: p.type, priceCents: p.priceCents } }, tx);
      }
      const slugs = (d.relatedSlugs ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
      const related = await tx.product.findMany({ where: { slug: { in: slugs }, id: { not: p.id } }, select: { id: true } });
      await tx.productRelation.deleteMany({ where: { fromId: p.id } });
      await tx.productRelation.createMany({ data: related.map((r) => ({ fromId: p.id, toId: r.id })) });
      return p;
    });
    revalidatePath("/", "layout");
    return d.id ? { ok: "Produit enregistré." } : { ok: "Produit créé.", redirectTo: `/admin/produits/${product.id}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function animalStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("animals.write");
    const d = z.object({ animalId: z.string().max(40), to: z.enum(["AVAILABLE", "QUARANTINED", "UNAVAILABLE", "RETURNED"]), note: z.string().trim().min(3, "Motif requis.").max(500) }).parse(Object.fromEntries(fd));
    await db.$transaction(async (tx) => {
      const before = await tx.animal.findUniqueOrThrow({ where: { id: d.animalId } });
      await setAnimalAvailability(tx, d.animalId, d.to, d.note, user);
      await audit({ actor: user, action: "animal.status", entity: "animal", entityId: d.animalId, before: { status: before.status }, after: { status: d.to }, reason: d.note }, tx);
    });
    revalidatePath("/admin/produits", "layout");
    return { ok: "Statut mis à jour." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function animalEventAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("animals.write");
    const d = z.object({ animalId: z.string().max(40), type: z.enum(["MEASURE", "HEALTH", "LOCATION", "NOTE"]), note: z.string().trim().min(2).max(1000) }).parse(Object.fromEntries(fd));
    await db.animalEvent.create({ data: { animalId: d.animalId, type: d.type, note: d.note, actorId: user.id } });
    revalidatePath("/admin/produits", "layout");
    return { ok: "Événement ajouté à l'historique." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function stockAdjustAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertPermission("inventory.write");
    const d = z.object({ productId: z.string().max(40), delta: z.coerce.number().int().min(-100000).max(100000), kind: z.enum(["RECEIPT", "ADJUSTMENT", "RETURN"]), reason: z.string().trim().min(3, "Motif requis.").max(300), reference: optStr(80) }).parse(Object.fromEntries(fd));
    if (d.delta === 0) return { error: "Quantité nulle." };
    const after = await db.$transaction(async (tx) => {
      const r = await adjustStock(tx, d.productId, d.delta, d.kind, d.reason, d.reference, user);
      await audit({ actor: user, action: "inventory.adjust", entity: "product", entityId: d.productId, after: r, reason: d.reason, data: { delta: d.delta, kind: d.kind } }, tx);
      return r;
    });
    revalidatePath("/admin/inventaire");
    revalidatePath(`/admin/produits/${d.productId}`);
    return { ok: `Stock mis à jour : ${after.stockOnHand} en stock, ${after.stockReserved} réservé(s).` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function uploadProductImage(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await assertPermission("products.write");
    const productId = z.string().max(40).parse(fd.get("productId"));
    const alt = z.string().trim().min(3).max(200).safeParse(fd.get("alt"));
    if (!alt.success) return { error: "Décrivez l'image (texte alternatif, 3 caractères min.)." };
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Sélectionnez une image." };
    const info = await inspectUpload(file, IMAGE_MIME);
    const scan = await scanBuffer(info.buffer).catch(() => { throw new AppError("EXTERNAL_SERVICE_ERROR", "Antivirus indisponible : réessayez plus tard."); });
    if (!scan.clean) return { error: "Fichier rejeté par l'antivirus." };
    if (await db.productImage.findFirst({ where: { productId, storageKey: { contains: info.sha256.slice(0, 16) } } })) return { error: "Cette image est déjà associée au produit." };
    // Ré-encodage WebP 2000 px max, métadonnées (dont GPS) supprimées ; le nom inclut l'empreinte (détection de doublons).
    const { data, info: meta } = await sharp(info.buffer).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const key = randomKey(`products/${info.sha256.slice(0, 16)}`, "webp");
    await storage().put("public", key, data, "image/webp");
    const count = await db.productImage.count({ where: { productId } });
    await db.productImage.create({ data: { productId, storageKey: key, alt: alt.data, width: meta.width, height: meta.height, position: count } });
    revalidatePath(`/admin/produits/${productId}`);
    return { ok: "Image ajoutée." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteProductImage(fd: FormData) {
  await assertPermission("products.write");
  const img = await db.productImage.delete({ where: { id: z.string().max(40).parse(fd.get("imageId")) } });
  await storage().remove("public", img.storageKey).catch(() => undefined);
  revalidatePath(`/admin/produits/${img.productId}`);
}

export async function moveProductImage(fd: FormData) {
  await assertPermission("products.write");
  const id = z.string().max(40).parse(fd.get("imageId"));
  const img = await db.productImage.findUniqueOrThrow({ where: { id } });
  const all = await db.productImage.findMany({ where: { productId: img.productId }, orderBy: { position: "asc" } });
  await db.$transaction([img, ...all.filter((i) => i.id !== id)].map((i, idx) => db.productImage.update({ where: { id: i.id }, data: { position: idx } })));
  revalidatePath(`/admin/produits/${img.productId}`);
}

// ───────── Catégories ─────────
export async function saveCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  try { await assertPermission("products.write"); } catch (e) { return toActionError(e); }
  const parsed = z.object({ id: z.string().max(40).optional().or(z.literal("")), name: z.string().trim().min(2).max(100), description: optStr(2000), parentId: optStr(40), position: z.coerce.number().int().default(0), metaTitle: optStr(70), metaDescription: optStr(170) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, ...d } = parsed.data;
  if (id && d.parentId === id) return { error: "Une catégorie ne peut pas être son propre parent." };
  const slug = slugify(d.name);
  if (await db.category.findFirst({ where: { slug, NOT: id ? { id } : undefined } })) return { error: "Une catégorie porte déjà ce nom." };
  if (id) await db.category.update({ where: { id }, data: { ...d, slug } });
  else await db.category.create({ data: { ...d, slug } });
  revalidatePath("/admin/categories");
  revalidatePath("/", "layout");
  return { ok: "Catégorie enregistrée." };
}

export async function deleteCategory(fd: FormData) {
  await assertPermission("products.write");
  await db.category.delete({ where: { id: z.string().max(40).parse(fd.get("id")) } });
  revalidatePath("/admin/categories");
}

// ───────── Espèces (référentiel) ─────────
export async function saveSpecies(_: ActionState, fd: FormData): Promise<ActionState> {
  let user;
  try { user = await assertPermission("compliance.rules.write"); } catch (e) { return toActionError(e); }
  const parsed = z.object({
    id: z.string().max(40).optional().or(z.literal("")),
    scientificName: z.string().trim().min(3, "Nom scientifique requis.").max(160),
    commonName: z.string().trim().min(2, "Nom commun requis.").max(160),
    synonyms: z.string().max(1000).optional(), family: optStr(120),
    regulatoryCategory: z.enum(["SALE_ALLOWED", "SALE_ALLOWED_WITH_DOCUMENTS", "DECLARATION_REQUIRED", "CERTIFICATE_REQUIRED", "AUTHORIZATION_REQUIRED", "RESTRICTED", "SALE_PROHIBITED"]),
    citesAnnex: z.enum(["", "A", "B", "C", "D"]).transform((v) => v || null), protectionStatus: optStr(300),
    regulatoryNotes: optStr(3000), restrictionsNotes: optStr(3000),
    transportConditions: optStr(3000), packagingRequirements: optStr(2000), carrierConstraints: optStr(2000), deliveryAvailable: z.string().optional(),
    careDifficulty: optNum, temperatureRange: optStr(120), humidityRange: optStr(120), diet: optStr(300), recommendedTerrarium: optStr(300),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const shippingMethods = z.array(z.enum(["PICKUP", "SPECIALIZED_CARRIER"])).parse(fd.getAll("shippingMethods"));
  const allowedShipDays = z.array(z.coerce.number().int().min(1).max(7)).parse(fd.getAll("allowedShipDays"));
  if (!shippingMethods.length) return { error: "Choisissez au moins un mode de remise." };
  const { id, deliveryAvailable, synonyms, ...d } = parsed.data;
  const slug = slugify(d.commonName);
  if (await db.species.findFirst({ where: { OR: [{ slug }, { scientificName: d.scientificName }], NOT: id ? { id } : undefined } })) return { error: "Cette espèce existe déjà." };
  const data = { ...d, slug, shippingMethods, allowedShipDays, deliveryAvailable: deliveryAvailable === "on", synonyms: (synonyms ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 30) };
  const before = id ? await db.species.findUnique({ where: { id } }) : null;
  const sp = id ? await db.species.update({ where: { id }, data }) : await db.species.create({ data });
  await audit({ actor: user, action: id ? "species.update" : "species.create", entity: "species", entityId: sp.id, before: before ? { regulatoryCategory: before.regulatoryCategory } : undefined, after: { regulatoryCategory: sp.regulatoryCategory } });
  revalidatePath("/", "layout");
  return id ? { ok: "Espèce enregistrée." } : { ok: "Espèce créée.", redirectTo: `/admin/especes/${sp.id}` };
}

// ───────── TVA ─────────
export async function saveTaxRate(_: ActionState, fd: FormData): Promise<ActionState> {
  let user;
  try { user = await assertPermission("settings.write"); } catch (e) { return toActionError(e); }
  const parsed = z.object({ id: z.string().max(40).optional().or(z.literal("")), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,30}$/, "Code : lettres, chiffres, tirets."), name: z.string().trim().min(2).max(80), country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), rate: z.string().transform((v) => Math.round(Number(v.replace(",", ".")) * 100)).refine((v) => Number.isInteger(v) && v >= 0 && v <= 10000, "Taux entre 0 et 100 %."), active: z.string().optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, rate, active, ...d } = parsed.data;
  if (id) {
    const used = await db.product.count({ where: { taxRateId: id } });
    const cur = await db.taxRate.findUniqueOrThrow({ where: { id } });
    if (used && cur.rateBps !== rate) return { error: "Taux utilisé par des produits : créez un nouveau taux et réaffectez les produits (les commandes passées conservent leur taux)." };
    await db.taxRate.update({ where: { id }, data: { ...d, rateBps: rate, active: active === "on" } });
  } else {
    if (await db.taxRate.findUnique({ where: { code: d.code } })) return { error: "Code déjà utilisé." };
    await db.taxRate.create({ data: { ...d, rateBps: rate, active: active === "on" } });
  }
  await audit({ actor: user, action: "tax_rate.save", entity: "tax_rate", entityId: id || d.code, after: { ...d, rateBps: rate } });
  revalidatePath("/admin/tva");
  return { ok: "Taux enregistré." };
}
