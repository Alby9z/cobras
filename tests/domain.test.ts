import { describe, expect, it } from "vitest";
import { evaluatePurchaseEligibility, type EligibilityInput, type ItemInput, type RuleInput, ruleSetVersion } from "@/lib/domain/eligibility";
import { assertTransition, canTransition, ORDER_TRANSITIONS, type TransitionContext } from "@/lib/domain/order-state";
import { allocate, computeTotals, exclTax } from "@/lib/domain/pricing";
import { resolvePaymentStrategy } from "@/lib/domain/payment-strategy";
import { can, assignableRoles, ROLE_PERMISSIONS } from "@/lib/domain/permissions";
import { AppError } from "@/lib/domain/errors";
import { departmentFromPostalCode } from "@/lib/geo-fr";

const now = new Date("2026-09-24T10:00:00Z");
const species = { id: "sp1", commonName: "Python royal", regulatoryCategory: "DECLARATION_REQUIRED" as const, shippingMethods: ["PICKUP", "SPECIALIZED_CARRIER"] as ("PICKUP" | "SPECIALIZED_CARRIER")[], deliveryAvailable: true, allowedShipDays: [] as number[] };
const animal = (over: Partial<ItemInput> = {}): ItemInput => ({ productId: "p1", productName: "Python femelle", productType: "ANIMAL", animal: { id: "a1", status: "AVAILABLE" }, species, ...over });
const accessory: ItemInput = { productId: "p2", productName: "Lampe", productType: "ACCESSORY", animal: null, species: null };
const rule = (over: Partial<RuleInput>): RuleInput => ({
  id: over.code ?? "r", code: "R", version: 1, name: "r", type: "DOCUMENT_REQUIREMENT", basis: "LEGAL", jurisdiction: "FR", speciesId: null, regulatoryCategory: null,
  productTypes: [], conditions: null, requiredDocuments: [], minimumAge: null, customerMessage: null, legalReference: "réf.", effectiveFrom: new Date("2020-01-01"), effectiveUntil: null, ...over,
});
const docsRule = rule({ code: "FR-DOCS", speciesId: "sp1", requiredDocuments: ["IDENTITY_DOCUMENT", "CERTIFICATE"] });
const ageRule = rule({ code: "FR-AGE", type: "AGE_REQUIREMENT", basis: "COMMERCIAL_POLICY", legalReference: null, productTypes: ["ANIMAL"], minimumAge: 18 });
const base = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  stage: "CHECKOUT", customer: { birthDate: new Date("1990-01-01"), emailVerified: true }, destination: { country: "FR", postalCode: "75001" },
  shippingMethod: "SPECIALIZED_CARRIER", items: [animal()], documents: [], rules: [docsRule, ageRule], now, ...over,
});
const approved = (type: "IDENTITY_DOCUMENT" | "CERTIFICATE", expiresAt: Date | null = null) => ({ id: type, type, status: "APPROVED" as const, expiresAt });

describe("éligibilité — règles critiques", () => {
  it("valid compliance → la commande peut continuer", () => {
    const r = evaluatePurchaseEligibility(base({ stage: "DECISION", documents: [approved("IDENTITY_DOCUMENT"), approved("CERTIFICATE")] }));
    expect(r.allowed).toBe(true);
    expect(r.decision).toBe("REVIEW_REQUIRED"); // animal : examen humain systématique
    expect(r.appliedRules.map((x) => x.code).sort()).toEqual(["FR-AGE", "FR-DOCS"]);
  });
  it("document requis manquant → bloqué à la décision, en attente au panier", () => {
    expect(evaluatePurchaseEligibility(base()).decision).toBe("DOCUMENTS_REQUIRED");
    const r = evaluatePurchaseEligibility(base({ stage: "DECISION", documents: [approved("IDENTITY_DOCUMENT")] }));
    expect(r.allowed).toBe(false);
    expect(r.reasons.map((x) => x.code)).toContain("MISSING_REQUIRED_DOCUMENT");
  });
  it("document expiré → bloqué", () => {
    const r = evaluatePurchaseEligibility(base({ stage: "DECISION", documents: [approved("IDENTITY_DOCUMENT", new Date("2026-01-01")), approved("CERTIFICATE")] }));
    expect(r.reasons.map((x) => x.code)).toContain("DOCUMENT_EXPIRED");
  });
  it("destination interdite → bloqué (département)", () => {
    const geo = rule({ code: "FR-69", type: "GEO_RESTRICTION", speciesId: "sp1", conditions: { mode: "DENY", zones: [{ country: "FR", department: "69" }] } });
    const r = evaluatePurchaseEligibility(base({ rules: [docsRule, geo], destination: { country: "FR", postalCode: "69001" } }));
    expect(r.reasons[0]).toMatchObject({ code: "DESTINATION_NOT_ALLOWED", rule: { code: "FR-69", version: 1 } });
    expect(evaluatePurchaseEligibility(base({ rules: [docsRule, geo] })).allowed).toBe(true);
  });
  it("liste blanche régionale", () => {
    const geo = rule({ code: "IDF", type: "GEO_RESTRICTION", speciesId: "sp1", conditions: { mode: "ALLOW_ONLY", zones: [{ country: "FR", region: "11" }] } });
    expect(evaluatePurchaseEligibility(base({ rules: [geo], destination: { country: "FR", postalCode: "13001" } })).allowed).toBe(false);
    expect(evaluatePurchaseEligibility(base({ rules: [geo], destination: { country: "FR", postalCode: "92100" } })).allowed).toBe(true);
  });
  it("espèce interdite → bloqué (catégorie et règle)", () => {
    expect(evaluatePurchaseEligibility(base({ items: [animal({ species: { ...species, regulatoryCategory: "SALE_PROHIBITED" } })] })).reasons.map((r) => r.code)).toContain("SPECIES_PROHIBITED");
    const ban = rule({ code: "BAN", type: "SALE_PROHIBITION", speciesId: "sp1" });
    expect(evaluatePurchaseEligibility(base({ rules: [ban] })).allowed).toBe(false);
  });
  it("animal sans règle validée → bloqué (pas de vente par défaut)", () => {
    const r = evaluatePurchaseEligibility(base({ rules: [ageRule] }));
    expect(r.reasons.map((x) => x.code)).toContain("RULES_NOT_CONFIGURED");
  });
  it("règle hors période d'effet ignorée", () => {
    const future = rule({ code: "BAN", type: "SALE_PROHIBITION", speciesId: "sp1", effectiveFrom: new Date("2027-01-01") });
    expect(evaluatePurchaseEligibility(base({ rules: [docsRule, future] })).allowed).toBe(true);
  });
  it("âge : configurable, jamais codé en dur", () => {
    const minor = { birthDate: new Date("2008-09-25"), emailVerified: true };
    expect(evaluatePurchaseEligibility(base({ customer: minor })).reasons.map((r) => r.code)).toContain("AGE_REQUIREMENT_NOT_MET");
    const r = evaluatePurchaseEligibility(base({ customer: minor, rules: [docsRule] }));
    expect(r.reasons.map((x) => x.code)).not.toContain("AGE_REQUIREMENT_NOT_MET");
    expect(r.warnings).toContain("NO_AGE_RULE_CONFIGURED");
  });
  it("colis standard refusé pour un animal ; retrait seul si livraison désactivée", () => {
    expect(evaluatePurchaseEligibility(base({ shippingMethod: "STANDARD_PARCEL", items: [animal(), accessory] })).allowedShippingMethods).toEqual(["PICKUP", "SPECIALIZED_CARRIER"]);
    const r = evaluatePurchaseEligibility(base({ items: [animal({ species: { ...species, deliveryAvailable: false } })] }));
    expect(r.allowedShippingMethods).toEqual(["PICKUP"]);
    expect(r.allowed).toBe(false);
  });
  it("animal déjà réservé → bloqué au panier, sauf pour la commande qui le détient", () => {
    const reserved = animal({ animal: { id: "a1", status: "RESERVED" } });
    expect(evaluatePurchaseEligibility(base({ items: [reserved] })).reasons.map((r) => r.code)).toContain("ANIMAL_NOT_AVAILABLE");
    expect(evaluatePurchaseEligibility(base({ items: [reserved], reservedAnimalIds: ["a1"] })).allowed).toBe(true);
  });
  it("jour d'expédition interdit à l'expédition", () => {
    const ship = rule({ code: "SHIP", type: "SHIPPING_RESTRICTION", speciesId: "sp1", conditions: { shipDays: [1, 2, 3] } });
    const docs = [approved("IDENTITY_DOCUMENT"), approved("CERTIFICATE")];
    const thursday = new Date("2026-09-24T08:00:00Z");
    expect(evaluatePurchaseEligibility(base({ stage: "FULFILLMENT", rules: [docsRule, ship], documents: docs, shipDate: thursday })).reasons.map((r) => r.code)).toContain("SHIP_DAY_NOT_ALLOWED");
  });
  it("accessoires seuls : aucune règle animale requise, pas d'examen", () => {
    const r = evaluatePurchaseEligibility(base({ items: [accessory], shippingMethod: "STANDARD_PARCEL" }));
    expect(r.decision).toBe("ALLOWED");
  });
  it("version du jeu de règles stable et sensible aux versions", () => {
    expect(ruleSetVersion([{ code: "A", version: 1 }, { code: "B", version: 2 }])).toBe(ruleSetVersion([{ code: "B", version: 2 }, { code: "A", version: 1 }]));
    expect(ruleSetVersion([{ code: "A", version: 1 }])).not.toBe(ruleSetVersion([{ code: "A", version: 2 }]));
  });
  it("Corse et outre-mer", () => {
    expect(departmentFromPostalCode("20000")).toBe("2A");
    expect(departmentFromPostalCode("20200")).toBe("2B");
    expect(departmentFromPostalCode("97400")).toBe("974");
  });
});

describe("machine à états", () => {
  const ctx = (status: TransitionContext["order"]["status"], over: Partial<TransitionContext["order"]> = {}, actor: TransitionContext["actor"] = "STAFF"): TransitionContext => ({
    actor, hasPermission: () => true,
    order: { status, totalCents: 1000, amountPaidCents: 1000, amountRefundedCents: 0, containsAnimals: true, shippingMethod: "SPECIALIZED_CARRIER", paymentStrategy: "PAY_IMMEDIATELY", complianceApproved: true, ...over },
  });
  it("COMPLIANCE_REJECTED → SHIPPED impossible", () => {
    expect(canTransition("COMPLIANCE_REJECTED", "SHIPPED")).toBe(false);
    expect(() => assertTransition("SHIPPED", ctx("COMPLIANCE_REJECTED"))).toThrow(AppError);
  });
  it("aucun statut terminal n'a de sortie", () => {
    expect(ORDER_TRANSITIONS.CANCELLED).toEqual([]);
    expect(ORDER_TRANSITIONS.REFUNDED).toEqual([]);
  });
  it("préparation impossible sans encaissement complet ni conformité", () => {
    expect(() => assertTransition("READY_FOR_FULFILLMENT", ctx("AWAITING_BALANCE", { amountPaidCents: 300 }, "SYSTEM"))).toThrow(/encaissée/);
    expect(() => assertTransition("READY_FOR_FULFILLMENT", ctx("COMPLIANCE_APPROVED", { complianceApproved: false }, "SYSTEM"))).toThrow(/conformité/);
  });
  it("expédition : suivi obligatoire hors retrait", () => {
    expect(() => assertTransition("SHIPPED", ctx("PREPARING"))).toThrow(/suivi/);
    expect(() => assertTransition("SHIPPED", { ...ctx("PREPARING"), tracking: { carrier: "X", number: "1" } })).not.toThrow();
  });
  it("permission exigée pour le personnel ; le client ne peut que confirmer la réception", () => {
    expect(() => assertTransition("COMPLIANCE_APPROVED", { ...ctx("DOCUMENTS_REVIEW"), hasPermission: () => false })).toThrow(/Permission/);
    expect(() => assertTransition("COMPLIANCE_APPROVED", ctx("DOCUMENTS_REVIEW", {}, "CUSTOMER"))).toThrow();
    expect(() => assertTransition("DELIVERED", ctx("SHIPPED", {}, "CUSTOMER"))).not.toThrow();
  });
});

describe("prix, TVA, arrondis", () => {
  it("HT arrondi au centime", () => {
    expect(exclTax(1200, 2000)).toBe(1000);
    expect(exclTax(999, 2000)).toBe(833); // 832,5 → 833
    expect(exclTax(1000, 0)).toBe(1000);
  });
  it("répartition exacte de la remise", () => {
    const a = allocate(100, [1, 1, 1]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(100);
    expect(a).toEqual([34, 33, 33]);
  });
  it("totaux cohérents (HT + TVA = TTC), remise accessoires, acompte, ventilation TVA", () => {
    const t = computeTotals(
      [
        { key: "a", productType: "ANIMAL", unitCents: 30000, quantity: 1, taxRateBps: 2000, depositPercent: 30 },
        { key: "b", productType: "ACCESSORY", unitCents: 4999, quantity: 3, taxRateBps: 2000, depositPercent: null },
        { key: "c", productType: "ACCESSORY", unitCents: 1055, quantity: 1, taxRateBps: 550, depositPercent: null },
      ],
      { priceCents: 4900, freeAboveCents: null, taxRateBps: 2000 },
      { code: "ACC10", type: "PERCENT", value: 10, minOrderCents: 0, accessoriesOnly: true },
    );
    expect(t.subtotalCents).toBe(46052);
    expect(t.discountCents).toBe(1605);
    expect(t.lines[0].discountCents).toBe(0);
    expect(t.totalExclTaxCents + t.taxCents).toBe(t.totalCents);
    expect(t.totalCents).toBe(46052 - 1605 + 4900);
    expect(t.vatBreakdown.map((v) => v.rateBps)).toEqual([550, 2000]);
    expect(t.vatBreakdown.reduce((s, v) => s + v.baseCents + v.taxCents, 0)).toBe(t.totalCents);
    expect(t.depositCents).toBe(9000);
  });
  it("coupon sous le minimum refusé", () => {
    const t = computeTotals([{ key: "a", productType: "ACCESSORY", unitCents: 1000, quantity: 1, taxRateBps: 2000, depositPercent: null }], null, { code: "X", type: "FIXED", value: 500, minOrderCents: 5000, accessoriesOnly: false });
    expect(t.couponApplied).toBeNull();
    expect(t.totalCents).toBe(1000);
  });
  it("refuse montants non entiers", () => {
    expect(() => computeTotals([{ key: "a", productType: "ACCESSORY", unitCents: 10.5, quantity: 1, taxRateBps: 2000, depositPercent: null }], null, null)).toThrow();
  });
});

describe("stratégie de paiement", () => {
  const defaults = { animals: "AUTHORIZE_THEN_CAPTURE" as const, other: "PAY_IMMEDIATELY" as const };
  it("accessoires seuls → paiement immédiat", () => {
    expect(resolvePaymentStrategy({ lines: [{ productType: "ACCESSORY", paymentStrategy: null, depositPercent: null }], defaults, reviewRequired: false }).strategy).toBe("PAY_IMMEDIATELY");
  });
  it("la stratégie la plus prudente l'emporte", () => {
    const d = resolvePaymentStrategy({ lines: [{ productType: "ACCESSORY", paymentStrategy: null, depositPercent: null }, { productType: "ANIMAL", paymentStrategy: "PAY_AFTER_COMPLIANCE", depositPercent: null }], defaults, reviewRequired: true });
    expect(d).toMatchObject({ strategy: "PAY_AFTER_COMPLIANCE", chargeNow: "NOTHING" });
  });
  it("acompte sans pourcentage configuré → repli sur autorisation (aucun montant inventé)", () => {
    const d = resolvePaymentStrategy({ lines: [{ productType: "ANIMAL", paymentStrategy: "DEPOSIT_THEN_BALANCE", depositPercent: null }], defaults, reviewRequired: true });
    expect(d.strategy).toBe("AUTHORIZE_THEN_CAPTURE");
    expect(d.warnings).toContain("DEPOSIT_NOT_CONFIGURED");
  });
});

describe("RBAC", () => {
  it("séparation des pouvoirs", () => {
    expect(can("ADMIN", "compliance.override")).toBe(false);
    expect(can("COMPLIANCE_MANAGER", "compliance.override")).toBe(true);
    expect(can("WAREHOUSE_OPERATOR", "orders.refund")).toBe(false);
    expect(can("SUPPORT_AGENT", "documents.read_sensitive")).toBe(false);
    expect(ROLE_PERMISSIONS.CUSTOMER).toEqual([]);
  });
  it("un ADMIN ne peut pas créer d'ADMIN ni de SUPER_ADMIN", () => {
    expect(assignableRoles("ADMIN")).not.toContain("ADMIN");
    expect(assignableRoles("ADMIN")).not.toContain("SUPER_ADMIN");
    expect(assignableRoles("COMPLIANCE_MANAGER")).toEqual([]);
  });
});
