import "server-only";
import { db, type Tx } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError } from "@/lib/domain/errors";
import {
  evaluatePurchaseEligibility, type EligibilityResult, type ItemInput, type RuleInput, type Stage, type Zone,
} from "@/lib/domain/eligibility";
import type { ComplianceRuleType, DocumentType, EvaluationStage, ProductType, RegulatoryCategory, Role, RuleBasis } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

type Client = Tx | typeof db;

// ───────────────────────── Chargement ─────────────────────────

export async function loadActiveRules(client: Client = db): Promise<RuleInput[]> {
  const rows = await client.complianceRule.findMany({ where: { status: "ACTIVE" }, orderBy: [{ code: "asc" }] });
  return rows.map((r) => ({
    id: r.id, code: r.code, version: r.version, name: r.name, type: r.type, basis: r.basis, jurisdiction: r.jurisdiction,
    speciesId: r.speciesId, regulatoryCategory: r.regulatoryCategory, productTypes: r.productTypes,
    conditions: (r.conditions as RuleInput["conditions"]) ?? null, requiredDocuments: r.requiredDocuments, minimumAge: r.minimumAge,
    customerMessage: r.customerMessage, legalReference: r.legalReference, effectiveFrom: r.effectiveFrom, effectiveUntil: r.effectiveUntil,
  }));
}

export const productComplianceInclude = { animal: { include: { species: true } } } as const;
type ProductWithAnimal = Prisma.ProductGetPayload<{ include: typeof productComplianceInclude }>;

export function toItemInput(p: ProductWithAnimal): ItemInput {
  const sp = p.animal?.species;
  return {
    productId: p.id,
    productName: p.name,
    productType: p.type,
    animal: p.animal ? { id: p.animal.id, status: p.animal.status } : null,
    species: sp ? { id: sp.id, commonName: sp.commonName, regulatoryCategory: sp.regulatoryCategory, shippingMethods: sp.shippingMethods, deliveryAvailable: sp.deliveryAvailable, allowedShipDays: sp.allowedShipDays } : null,
  };
}

export async function customerDocuments(client: Client, userId: string) {
  return client.document.findMany({ where: { userId }, select: { id: true, type: true, status: true, expiresAt: true }, orderBy: { createdAt: "desc" } });
}

// ───────────────────────── Évaluation d'une commande ─────────────────────────

const STAGE_MAP: Record<Stage, EvaluationStage> = { CHECKOUT: "CHECKOUT", PAYMENT: "PAYMENT", REVIEW: "REVIEW", DECISION: "DECISION", FULFILLMENT: "FULFILLMENT" };

/** Réévalue une commande avec les règles ACTIVES, et enregistre l'évaluation (immuable) dans son dossier. */
export async function evaluateOrder(tx: Tx, orderId: string, stage: Stage, opts: { actorId?: string | null; shipDate?: Date } = {}): Promise<EligibilityResult> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { user: true, items: { include: { product: { include: productComplianceInclude } } }, reservations: { where: { status: { in: ["ACTIVE", "ALLOCATED"] } } } },
  });
  const addr = order.shippingAddress as { country: string; postalCode: string };
  const result = evaluatePurchaseEligibility({
    stage,
    customer: { birthDate: order.user.birthDate, emailVerified: order.user.emailVerified },
    destination: { country: addr.country, postalCode: addr.postalCode },
    shippingMethod: order.shippingMethod,
    items: order.items.map((i) => toItemInput(i.product)),
    documents: await customerDocuments(tx, order.userId),
    rules: await loadActiveRules(tx),
    reservedAnimalIds: order.reservations.map((r) => r.animalId).filter((x): x is string => Boolean(x)),
    shipDate: opts.shipDate,
  });
  const json = result as unknown as Prisma.InputJsonValue;
  const existing = await tx.complianceCase.findUnique({ where: { orderId } });
  const kase = existing
    ? await tx.complianceCase.update({ where: { id: existing.id }, data: { lastEvaluation: json, ruleSetVersion: result.ruleSetVersion } })
    : await tx.complianceCase.create({ data: { orderId, lastEvaluation: json, ruleSetVersion: result.ruleSetVersion } });
  await tx.complianceEvaluation.create({ data: { caseId: kase.id, stage: STAGE_MAP[stage], allowed: result.allowed, result: json, ruleSetVersion: result.ruleSetVersion, actorId: opts.actorId ?? null } });
  return result;
}

export function missingDocumentTypes(r: EligibilityResult): DocumentType[] {
  return r.requiredDocuments.filter((d) => d.status !== "APPROVED").map((d) => d.type);
}

// ───────────────────────── Gestion des règles (versionnées) ─────────────────────────

export interface RuleDraftInput {
  code: string;
  name: string;
  jurisdiction: string;
  type: ComplianceRuleType;
  basis: RuleBasis;
  speciesId: string | null;
  regulatoryCategory: RegulatoryCategory | null;
  productTypes: ProductType[];
  mode: "DENY" | "ALLOW_ONLY" | null;
  zones: Zone[];
  methods: ("PICKUP" | "SPECIALIZED_CARRIER" | "STANDARD_PARCEL")[];
  shipDays: number[];
  requiredDocuments: DocumentType[];
  minimumAge: number | null;
  customerMessage: string | null;
  legalReference: string | null;
  sourceUrl: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}

type StaffActor = { id: string; role: Role };

function validateDraft(d: RuleDraftInput) {
  if (d.basis === "LEGAL" && !d.legalReference) throw new AppError("VALIDATION_ERROR", "Une règle d'origine légale doit citer sa référence juridique.");
  if (d.type === "AGE_REQUIREMENT" && d.minimumAge == null) throw new AppError("VALIDATION_ERROR", "Âge minimum requis.");
  if (d.type === "DOCUMENT_REQUIREMENT" && !d.requiredDocuments.length) throw new AppError("VALIDATION_ERROR", "Sélectionnez au moins un document.");
  if (d.type === "GEO_RESTRICTION" && (!d.mode || !d.zones.length)) throw new AppError("VALIDATION_ERROR", "Mode et zones requis pour une restriction géographique.");
  if (d.type === "SHIPPING_RESTRICTION" && !d.methods.length && !d.shipDays.length) throw new AppError("VALIDATION_ERROR", "Indiquez les modes ou jours d'expédition autorisés.");
  if (d.effectiveUntil && d.effectiveUntil <= d.effectiveFrom) throw new AppError("VALIDATION_ERROR", "La date de fin doit suivre la date d'effet.");
}

function draftData(d: RuleDraftInput) {
  const conditions: Record<string, unknown> = {};
  if (d.type === "GEO_RESTRICTION" || d.type === "SALE_PROHIBITION" || d.type === "DOCUMENT_REQUIREMENT") {
    if (d.zones.length) conditions.zones = d.zones;
    if (d.mode) conditions.mode = d.mode;
  }
  if (d.type === "SHIPPING_RESTRICTION") {
    if (d.methods.length) conditions.methods = d.methods;
    if (d.shipDays.length) conditions.shipDays = d.shipDays;
  }
  return {
    name: d.name, jurisdiction: d.jurisdiction, type: d.type, basis: d.basis, speciesId: d.speciesId, regulatoryCategory: d.regulatoryCategory,
    productTypes: d.productTypes, conditions: Object.keys(conditions).length ? (conditions as Prisma.InputJsonValue) : undefined,
    requiredDocuments: d.type === "DOCUMENT_REQUIREMENT" ? d.requiredDocuments : [], minimumAge: d.type === "AGE_REQUIREMENT" ? d.minimumAge : null,
    customerMessage: d.customerMessage, legalReference: d.legalReference, sourceUrl: d.sourceUrl, effectiveFrom: d.effectiveFrom, effectiveUntil: d.effectiveUntil,
  };
}

export async function saveRuleDraft(actor: StaffActor, input: RuleDraftInput, draftId?: string) {
  validateDraft(input);
  return db.$transaction(async (tx) => {
    if (draftId) {
      const cur = await tx.complianceRule.findUniqueOrThrow({ where: { id: draftId } });
      if (cur.status !== "DRAFT") throw new AppError("CONFLICT", "Seul un brouillon est modifiable : créez une nouvelle version.");
      const rule = await tx.complianceRule.update({ where: { id: draftId }, data: draftData(input) });
      await audit({ actor, action: "compliance_rule.draft_update", entity: "compliance_rule", entityId: rule.id, before: cur, after: rule }, tx);
      return rule;
    }
    const code = input.code.trim().toUpperCase();
    if (await tx.complianceRule.findFirst({ where: { code } })) throw new AppError("CONFLICT", "Ce code existe déjà : créez une nouvelle version de la règle existante.");
    const rule = await tx.complianceRule.create({ data: { ...draftData(input), code, version: 1 } });
    await audit({ actor, action: "compliance_rule.create", entity: "compliance_rule", entityId: rule.id, after: rule }, tx);
    return rule;
  });
}

/** Crée le brouillon de la version suivante à partir d'une règle publiée. */
export async function newRuleVersion(actor: StaffActor, ruleId: string) {
  return db.$transaction(async (tx) => {
    const cur = await tx.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
    if (cur.status === "DRAFT") throw new AppError("CONFLICT", "Cette règle est déjà un brouillon.");
    const pending = await tx.complianceRule.findFirst({ where: { code: cur.code, status: "DRAFT" } });
    if (pending) return pending;
    const last = await tx.complianceRule.aggregate({ where: { code: cur.code }, _max: { version: true } });
    const rule = await tx.complianceRule.create({
      data: {
        code: cur.code, version: (last._max.version ?? cur.version) + 1, name: cur.name, jurisdiction: cur.jurisdiction, type: cur.type, basis: cur.basis,
        speciesId: cur.speciesId, regulatoryCategory: cur.regulatoryCategory, productTypes: cur.productTypes, conditions: cur.conditions ?? undefined,
        requiredDocuments: cur.requiredDocuments, minimumAge: cur.minimumAge, customerMessage: cur.customerMessage, legalReference: cur.legalReference,
        sourceUrl: cur.sourceUrl, effectiveFrom: new Date(), supersedesId: cur.status === "ACTIVE" ? cur.id : null,
      },
    });
    await audit({ actor, action: "compliance_rule.new_version", entity: "compliance_rule", entityId: rule.id, data: { from: `${cur.code}@${cur.version}` } }, tx);
    return rule;
  });
}

/** Validation et publication (permission compliance.rules.approve). Retire la version précédente. */
export async function approveRule(actor: StaffActor, ruleId: string, reviewNote: string) {
  return db.$transaction(async (tx) => {
    const rule = await tx.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
    if (rule.status !== "DRAFT") throw new AppError("CONFLICT", "Seul un brouillon peut être validé.");
    if (rule.basis === "LEGAL" && !rule.legalReference) throw new AppError("VALIDATION_ERROR", "Référence juridique manquante.");
    const previous = await tx.complianceRule.findFirst({ where: { code: rule.code, status: "ACTIVE" } });
    if (previous) await tx.complianceRule.update({ where: { id: previous.id }, data: { status: "RETIRED", effectiveUntil: new Date() } });
    const now = new Date();
    const published = await tx.complianceRule.update({
      where: { id: ruleId },
      data: { status: "ACTIVE", reviewedAt: now, reviewedById: actor.id, effectiveFrom: rule.effectiveFrom < now ? rule.effectiveFrom : rule.effectiveFrom },
    });
    await audit({ actor, action: "compliance_rule.approve", entity: "compliance_rule", entityId: ruleId, before: previous ? { retired: `${previous.code}@${previous.version}` } : undefined, after: { code: published.code, version: published.version }, reason: reviewNote }, tx);
    return published;
  });
}

export async function retireRule(actor: StaffActor, ruleId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const rule = await tx.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
    if (rule.status !== "ACTIVE") throw new AppError("CONFLICT", "Seule une règle active peut être retirée.");
    await tx.complianceRule.update({ where: { id: ruleId }, data: { status: "RETIRED", effectiveUntil: new Date() } });
    await audit({ actor, action: "compliance_rule.retire", entity: "compliance_rule", entityId: ruleId, reason }, tx);
  });
}

export async function deleteRuleDraft(actor: StaffActor, ruleId: string) {
  return db.$transaction(async (tx) => {
    const rule = await tx.complianceRule.findUniqueOrThrow({ where: { id: ruleId } });
    if (rule.status !== "DRAFT") throw new AppError("CONFLICT", "Seul un brouillon peut être supprimé.");
    await tx.complianceRule.delete({ where: { id: ruleId } });
    await audit({ actor, action: "compliance_rule.draft_delete", entity: "compliance_rule", entityId: ruleId, before: rule }, tx);
  });
}
