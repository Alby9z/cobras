/**
 * Moteur d'éligibilité — fonction pure, exécutée à chaque étape (panier, paiement, examen, décision, expédition).
 *
 * Principes :
 *  - aucune règle juridique n'est codée ici : les exigences proviennent des ComplianceRule ACTIVES et validées ;
 *  - un animal sans règle validée applicable est bloqué (configuration incomplète) : on ne vend pas « par défaut » ;
 *  - chaque décision est explicable (contrôles, règles appliquées, données utilisées, version du jeu de règles).
 */
import type {
  AnimalStatus, ComplianceRuleType, DocumentStatus, DocumentType, ProductType, RegulatoryCategory, RuleBasis, ShippingMethod,
} from "@/generated/prisma/enums";
import { departmentFromPostalCode, regionFromDepartment } from "@/lib/geo-fr";
import { documentTypeLabel } from "@/lib/labels";

export type Stage = "CHECKOUT" | "PAYMENT" | "REVIEW" | "DECISION" | "FULFILLMENT";

export type ReasonCode =
  | "EMAIL_NOT_VERIFIED"
  | "SPECIES_PROHIBITED"
  | "PRODUCT_PROHIBITED"
  | "RULES_NOT_CONFIGURED"
  | "ANIMAL_WITHOUT_SPECIES"
  | "ANIMAL_NOT_AVAILABLE"
  | "AGE_REQUIREMENT_NOT_MET"
  | "DESTINATION_NOT_ALLOWED"
  | "DESTINATION_UNRESOLVED"
  | "SHIPPING_METHOD_NOT_ALLOWED"
  | "NO_COMMON_SHIPPING_METHOD"
  | "SHIP_DAY_NOT_ALLOWED"
  | "MISSING_REQUIRED_DOCUMENT"
  | "DOCUMENT_EXPIRED"
  | "DOCUMENT_REJECTED"
  | "DOCUMENT_PENDING_REVIEW";

export interface Zone {
  country: string;
  region?: string | null;
  department?: string | null;
  postalPrefix?: string | null;
}

export interface RuleInput {
  id: string;
  code: string;
  version: number;
  name: string;
  type: ComplianceRuleType;
  basis: RuleBasis;
  jurisdiction: string;
  speciesId: string | null;
  regulatoryCategory: RegulatoryCategory | null;
  productTypes: ProductType[];
  conditions: { mode?: "DENY" | "ALLOW_ONLY"; zones?: Zone[]; methods?: ShippingMethod[]; shipDays?: number[] } | null;
  requiredDocuments: DocumentType[];
  minimumAge: number | null;
  customerMessage: string | null;
  legalReference: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}

export interface ItemInput {
  productId: string;
  productName: string;
  productType: ProductType;
  animal: { id: string; status: AnimalStatus } | null;
  species: {
    id: string;
    commonName: string;
    regulatoryCategory: RegulatoryCategory;
    shippingMethods: ShippingMethod[];
    deliveryAvailable: boolean;
    allowedShipDays: number[];
  } | null;
}

export interface EligibilityInput {
  stage: Stage;
  customer: { birthDate: Date; emailVerified: boolean };
  destination: { country: string; postalCode: string };
  shippingMethod: ShippingMethod;
  items: ItemInput[];
  documents: { id: string; type: DocumentType; status: DocumentStatus; expiresAt: Date | null }[];
  rules: RuleInput[];
  /** Réservation déjà détenue par la commande évaluée (l'animal n'est alors plus « disponible » mais bien à elle). */
  reservedAnimalIds?: string[];
  shipDate?: Date;
  now?: Date;
}

export interface Reason {
  code: ReasonCode;
  message: string;
  productId?: string;
  rule?: { code: string; version: number };
}

export interface RequiredDocument {
  type: DocumentType;
  rules: { code: string; version: number }[];
  status: "MISSING" | "PENDING_REVIEW" | "APPROVED" | "EXPIRED" | "REJECTED";
  documentId: string | null;
}

export interface Check {
  code: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface EligibilityResult {
  allowed: boolean;
  decision: "ALLOWED" | "BLOCKED" | "DOCUMENTS_REQUIRED" | "REVIEW_REQUIRED";
  reasons: Reason[];
  requiredDocuments: RequiredDocument[];
  warnings: string[];
  checks: Check[];
  appliedRules: { code: string; version: number; type: ComplianceRuleType; basis: RuleBasis; legalReference: string | null }[];
  allowedShippingMethods: ShippingMethod[];
  humanReviewRequired: boolean;
  ruleSetVersion: string;
  destination: { country: string; region: string | null; department: string | null; postalCode: string };
  stage: Stage;
  evaluatedAt: string;
}

const ALL_METHODS: ShippingMethod[] = ["PICKUP", "SPECIALIZED_CARRIER", "STANDARD_PARCEL"];

/** Âge révolu (UTC). */
export function ageOn(birthDate: Date, on: Date): number {
  let age = on.getUTCFullYear() - birthDate.getUTCFullYear();
  const m = on.getUTCMonth() - birthDate.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < birthDate.getUTCDate())) age--;
  return age;
}

/** Empreinte stable du jeu de règles (FNV-1a 32 bits) : identifie la version appliquée. */
export function ruleSetVersion(rules: Pick<RuleInput, "code" | "version">[]): string {
  const s = rules.map((r) => `${r.code}@${r.version}`).sort().join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `RS-${rules.length}-${h.toString(16).padStart(8, "0")}`;
}

export function resolveDestination(country: string, postalCode: string) {
  const c = country.toUpperCase();
  const department = c === "FR" ? departmentFromPostalCode(postalCode) : null;
  return { country: c, department, region: regionFromDepartment(department), postalCode: postalCode.replace(/\s/g, "") };
}

export function zoneMatches(z: Zone, d: ReturnType<typeof resolveDestination>) {
  if (z.country.toUpperCase() !== d.country) return false;
  if (z.region && z.region !== d.region) return false;
  if (z.department && z.department !== d.department) return false;
  if (z.postalPrefix && !d.postalCode.startsWith(z.postalPrefix)) return false;
  return true;
}

const isoWeekday = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

function ruleInScope(r: RuleInput, item: ItemInput) {
  if (r.productTypes.length && !r.productTypes.includes(item.productType)) return false;
  if (r.speciesId && r.speciesId !== item.species?.id) return false;
  if (r.regulatoryCategory && r.regulatoryCategory !== item.species?.regulatoryCategory) return false;
  return true;
}

function ruleActive(r: RuleInput, now: Date) {
  return r.effectiveFrom <= now && (!r.effectiveUntil || r.effectiveUntil > now);
}

/** Modes d'expédition compatibles avec les contraintes logistiques de chaque article (hors règles). */
export function logisticMethods(items: ItemInput[]): ShippingMethod[] {
  let allowed = new Set<ShippingMethod>(ALL_METHODS);
  for (const it of items) {
    if (it.productType !== "ANIMAL") continue;
    // Un animal vivant ne voyage jamais en colis standard (contrainte logistique du catalogue).
    let m: ShippingMethod[] = (it.species?.shippingMethods ?? []).filter((x) => x !== "STANDARD_PARCEL");
    if (it.species && !it.species.deliveryAvailable) m = m.filter((x) => x === "PICKUP");
    allowed = new Set([...allowed].filter((x) => m.includes(x)));
  }
  return ALL_METHODS.filter((m) => allowed.has(m));
}

export function evaluatePurchaseEligibility(input: EligibilityInput): EligibilityResult {
  const now = input.now ?? new Date();
  const dest = resolveDestination(input.destination.country, input.destination.postalCode);
  const rules = input.rules.filter((r) => ruleActive(r, now));
  const reasons: Reason[] = [];
  const warnings: string[] = [];
  const checks: Check[] = [];
  const applied = new Map<string, RuleInput>();
  const docNeeds = new Map<DocumentType, { code: string; version: number }[]>();
  let humanReview = false;
  const ref = (r: RuleInput) => ({ code: r.code, version: r.version });
  const add = (reason: Reason) => {
    if (!reasons.some((x) => x.code === reason.code && x.productId === reason.productId && x.rule?.code === reason.rule?.code)) reasons.push(reason);
  };

  // 1. Compte
  checks.push({ code: "EMAIL_VERIFIED", label: "Adresse email vérifiée", passed: input.customer.emailVerified });
  if (!input.customer.emailVerified) add({ code: "EMAIL_NOT_VERIFIED", message: "Votre adresse email doit être vérifiée." });

  // 2. Destination
  const destOk = dest.country !== "FR" || input.shippingMethod === "PICKUP" || Boolean(dest.department);
  checks.push({ code: "DESTINATION_RESOLVED", label: "Adresse rattachée à un territoire", passed: destOk, detail: [dest.country, dest.region, dest.department].filter(Boolean).join(" / ") });
  if (!destOk) add({ code: "DESTINATION_UNRESOLVED", message: "Le code postal n'a pas pu être rattaché à un département." });

  const age = ageOn(input.customer.birthDate, now);
  const animals = input.items.filter((i) => i.productType === "ANIMAL");

  for (const item of input.items) {
    // 3. Données structurelles de l'article
    if (item.productType === "ANIMAL") {
      if (!item.species) {
        add({ code: "ANIMAL_WITHOUT_SPECIES", message: `« ${item.productName} » n'est rattaché à aucune espèce.`, productId: item.productId });
        continue;
      }
      if (item.species.regulatoryCategory === "SALE_PROHIBITED") {
        add({ code: "SPECIES_PROHIBITED", message: `La vente de l'espèce ${item.species.commonName} est interdite.`, productId: item.productId });
      }
      if (item.species.regulatoryCategory === "RESTRICTED") humanReview = true;
      const reservedHere = item.animal && input.reservedAnimalIds?.includes(item.animal.id);
      if (input.stage === "CHECKOUT" && item.animal && item.animal.status !== "AVAILABLE" && !reservedHere) {
        add({ code: "ANIMAL_NOT_AVAILABLE", message: `« ${item.productName} » n'est plus disponible.`, productId: item.productId });
      }
    }

    const scoped = rules.filter((r) => ruleInScope(r, item));
    if (item.productType === "ANIMAL" && !scoped.some((r) => r.speciesId || r.regulatoryCategory)) {
      // Aucune règle validée ne couvre cette espèce ou sa catégorie : vente impossible tant que la conformité n'est pas paramétrée.
      add({ code: "RULES_NOT_CONFIGURED", message: `La vente de « ${item.productName} » n'est pas encore ouverte (règles de conformité non validées).`, productId: item.productId });
    }

    for (const r of scoped) {
      const zones = r.conditions?.zones ?? [];
      const zoneHit = zones.some((z) => zoneMatches(z, dest));
      switch (r.type) {
        case "SALE_PROHIBITION":
          if (!zones.length || zoneHit) {
            applied.set(r.id, r);
            add({ code: item.species ? "SPECIES_PROHIBITED" : "PRODUCT_PROHIBITED", message: r.customerMessage ?? `La vente de « ${item.productName} » est interdite${zones.length ? " vers cette destination" : ""}.`, productId: item.productId, rule: ref(r) });
          }
          break;
        case "GEO_RESTRICTION": {
          applied.set(r.id, r);
          const mode = r.conditions?.mode ?? "DENY";
          if ((mode === "DENY" && zoneHit) || (mode === "ALLOW_ONLY" && !zoneHit)) {
            add({ code: "DESTINATION_NOT_ALLOWED", message: r.customerMessage ?? `« ${item.productName} » ne peut pas être vendu vers cette destination.`, productId: item.productId, rule: ref(r) });
          }
          break;
        }
        case "AGE_REQUIREMENT":
          applied.set(r.id, r);
          if (r.minimumAge != null && age < r.minimumAge) {
            add({ code: "AGE_REQUIREMENT_NOT_MET", message: r.customerMessage ?? `L'achat de « ${item.productName} » est réservé aux personnes de ${r.minimumAge} ans et plus.`, productId: item.productId, rule: ref(r) });
          }
          break;
        case "DOCUMENT_REQUIREMENT":
          if (!zones.length || zoneHit) {
            applied.set(r.id, r);
            for (const d of r.requiredDocuments) docNeeds.set(d, [...(docNeeds.get(d) ?? []).filter((x) => x.code !== r.code), ref(r)]);
          }
          break;
        case "SHIPPING_RESTRICTION": {
          applied.set(r.id, r);
          const methods = r.conditions?.methods;
          if (methods?.length && !methods.includes(input.shippingMethod)) {
            add({ code: "SHIPPING_METHOD_NOT_ALLOWED", message: r.customerMessage ?? `Le mode de livraison choisi n'est pas autorisé pour « ${item.productName} ».`, productId: item.productId, rule: ref(r) });
          }
          const days = r.conditions?.shipDays;
          if (input.stage === "FULFILLMENT" && days?.length && input.shipDate && !days.includes(isoWeekday(input.shipDate))) {
            add({ code: "SHIP_DAY_NOT_ALLOWED", message: `Expédition de « ${item.productName} » interdite ce jour.`, productId: item.productId, rule: ref(r) });
          }
          break;
        }
        case "HUMAN_REVIEW":
          applied.set(r.id, r);
          humanReview = true;
          break;
      }
    }

    // Jours d'expédition définis sur l'espèce (paramétrage logistique)
    if (input.stage === "FULFILLMENT" && input.shipDate && item.species?.allowedShipDays.length && input.shippingMethod !== "PICKUP" && !item.species.allowedShipDays.includes(isoWeekday(input.shipDate))) {
      add({ code: "SHIP_DAY_NOT_ALLOWED", message: `Expédition de « ${item.productName} » interdite ce jour.`, productId: item.productId });
    }
  }

  // 4. Mode de livraison (contraintes logistiques)
  const methods = logisticMethods(input.items);
  if (!methods.length) add({ code: "NO_COMMON_SHIPPING_METHOD", message: "Aucun mode de livraison commun à ces articles : passez des commandes séparées." });
  else if (!methods.includes(input.shippingMethod)) add({ code: "SHIPPING_METHOD_NOT_ALLOWED", message: "Le mode de livraison choisi n'est pas possible pour un ou plusieurs articles." });
  checks.push({ code: "SHIPPING_METHOD", label: "Mode de livraison autorisé", passed: !reasons.some((r) => r.code.startsWith("SHIPPING") || r.code === "NO_COMMON_SHIPPING_METHOD") });

  // 5. Documents
  const requiredDocuments: RequiredDocument[] = [...docNeeds.entries()].map(([type, rs]) => {
    const docs = input.documents.filter((d) => d.type === type);
    const valid = docs.find((d) => d.status === "APPROVED" && (!d.expiresAt || d.expiresAt > now));
    const expired = docs.find((d) => d.status === "APPROVED" && d.expiresAt && d.expiresAt <= now);
    const pending = docs.find((d) => d.status === "PENDING_REVIEW" || d.status === "PENDING_SCAN");
    const rejected = docs.find((d) => d.status === "REJECTED");
    const status: RequiredDocument["status"] = valid ? "APPROVED" : pending ? "PENDING_REVIEW" : expired ? "EXPIRED" : rejected ? "REJECTED" : "MISSING";
    return { type, rules: rs, status, documentId: (valid ?? pending ?? expired ?? rejected)?.id ?? null };
  });
  const docsComplete = requiredDocuments.every((d) => d.status === "APPROVED");
  if (input.stage === "DECISION" || input.stage === "FULFILLMENT") {
    for (const d of requiredDocuments) {
      if (d.status === "APPROVED") continue;
      const code: ReasonCode = d.status === "EXPIRED" ? "DOCUMENT_EXPIRED" : d.status === "REJECTED" ? "DOCUMENT_REJECTED" : d.status === "PENDING_REVIEW" ? "DOCUMENT_PENDING_REVIEW" : "MISSING_REQUIRED_DOCUMENT";
      add({ code, message: `${documentTypeLabel[d.type]} : ${d.status === "EXPIRED" ? "document expiré" : d.status === "REJECTED" ? "document refusé" : d.status === "PENDING_REVIEW" ? "en attente de validation" : "document manquant"}.`, rule: d.rules[0] });
    }
  }
  checks.push({ code: "DOCUMENTS", label: "Documents requis validés", passed: docsComplete, detail: `${requiredDocuments.filter((d) => d.status === "APPROVED").length}/${requiredDocuments.length}` });
  checks.push({ code: "AGE", label: "Âge minimum respecté", passed: !reasons.some((r) => r.code === "AGE_REQUIREMENT_NOT_MET") });
  checks.push({ code: "DESTINATION_ALLOWED", label: "Destination autorisée", passed: !reasons.some((r) => r.code === "DESTINATION_NOT_ALLOWED" || r.code === "DESTINATION_UNRESOLVED") });
  checks.push({ code: "PRODUCTS_ELIGIBLE", label: "Articles éligibles à la vente", passed: !reasons.some((r) => ["SPECIES_PROHIBITED", "PRODUCT_PROHIBITED", "RULES_NOT_CONFIGURED", "ANIMAL_WITHOUT_SPECIES", "ANIMAL_NOT_AVAILABLE"].includes(r.code)) });

  if (animals.length > 0) humanReview = true; // tout animal fait l'objet d'une vérification humaine
  if (animals.length && !rules.some((r) => r.type === "AGE_REQUIREMENT" && input.items.some((i) => ruleInScope(r, i)))) warnings.push("NO_AGE_RULE_CONFIGURED");

  const blocked = reasons.length > 0;
  const decision: EligibilityResult["decision"] = blocked ? "BLOCKED" : !docsComplete ? "DOCUMENTS_REQUIRED" : humanReview ? "REVIEW_REQUIRED" : "ALLOWED";

  return {
    allowed: !blocked,
    decision,
    reasons,
    requiredDocuments,
    warnings,
    checks,
    appliedRules: [...applied.values()].map((r) => ({ code: r.code, version: r.version, type: r.type, basis: r.basis, legalReference: r.legalReference })),
    allowedShippingMethods: methods,
    humanReviewRequired: humanReview,
    ruleSetVersion: ruleSetVersion(rules),
    destination: dest,
    stage: input.stage,
    evaluatedAt: now.toISOString(),
  };
}
