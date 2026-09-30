import crypto from "node:crypto";
import { db } from "@/server/db";
import { cartInclude } from "@/server/cart-core";
import type { PaymentStrategy, Role } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

const TABLES = ["email_log", "stripe_event", "compliance_evaluation", "compliance_case", "inventory_movement", "stock_reservation", "refund", "payment", "order_document",
  "order_event", "order_item", "\"order\"", "cart_item", "cart", "animal_event", "animal", "product_relation", "product_image", "product", "compliance_rule", "species",
  "tax_rate", "shipping_rate", "document", "address", "notification", "setting", "page", "coupon", "counter", "session", "account", "\"user\"", "app_rate_limit"];

export async function resetDb() {
  // Base de test uniquement : les protections anti-TRUNCATE sont suspendues le temps du nettoyage.
  const guarded = ["audit_log", "invoice", "inventory_movement", "compliance_evaluation", "compliance_rule"];
  for (const t of guarded) await db.$executeRawUnsafe(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
  await db.$executeRawUnsafe(`TRUNCATE ${guarded.join(", ")}, ${TABLES.join(", ")} CASCADE`);
  for (const t of guarded) await db.$executeRawUnsafe(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
}

export async function seedBase(opts: { strategy?: PaymentStrategy } = {}) {
  const settings: Record<string, string> = {
    companyName: "Test SAS", legalForm: "SAS", siret: "00000000000000", addressLine: "1 rue Test", postalCode: "75001", city: "Paris", vatRegime: "NORMAL",
    vatNumber: "FR00000000000", shippingTaxRateCode: "FR-STD", paymentStrategyAnimals: opts.strategy ?? "AUTHORIZE_THEN_CAPTURE", reservationMinutes: "30", complianceHoldHours: "72", balancePaymentHours: "48",
  };
  await db.setting.createMany({ data: Object.entries(settings).map(([key, value]) => ({ key, value })) });
  for (const slug of ["mentions-legales", "cgv", "confidentialite"]) await db.page.create({ data: { slug, title: slug, content: "Contenu de test suffisamment long.", published: true } });
  const tax = await db.taxRate.create({ data: { code: "FR-STD", name: "Taux normal", rateBps: 2000 } });
  const rate = await db.shippingRate.create({ data: { name: "Transporteur", method: "SPECIALIZED_CARRIER", countries: ["FR"], priceCents: 4900 } });
  const parcel = await db.shippingRate.create({ data: { name: "Colis", method: "STANDARD_PARCEL", countries: ["FR"], priceCents: 690 } });
  const species = await db.species.create({ data: { scientificName: "Python regius", commonName: "Python royal", slug: "python-royal", regulatoryCategory: "CERTIFICATE_REQUIRED", shippingMethods: ["PICKUP", "SPECIALIZED_CARRIER"] } });
  const reviewer = await createUser("SUPER_ADMIN", "reviewer@example.org");
  type RuleData = Omit<Prisma.ComplianceRuleUncheckedCreateInput, "jurisdiction" | "effectiveFrom">;
  const rule = (data: RuleData) => db.complianceRule.create({ data: { status: "ACTIVE", reviewedAt: new Date(), reviewedById: reviewer.id, effectiveFrom: new Date("2020-01-01"), jurisdiction: "FR", ...data } });
  await rule({ code: "FR-PYTHON-DOCS", name: "Documents python", type: "DOCUMENT_REQUIREMENT", basis: "LEGAL", legalReference: "Réf. test", speciesId: species.id, requiredDocuments: ["IDENTITY_DOCUMENT", "CERTIFICATE"] });
  await rule({ code: "FR-AGE", name: "Âge", type: "AGE_REQUIREMENT", basis: "COMMERCIAL_POLICY", productTypes: ["ANIMAL"], minimumAge: 18 });
  await rule({ code: "FR-69", name: "Interdit 69", type: "GEO_RESTRICTION", basis: "LEGAL", legalReference: "Arrêté test", speciesId: species.id, conditions: { mode: "DENY", zones: [{ country: "FR", department: "69" }] } });
  return { tax, rate, parcel, species, reviewer };
}

export async function createAnimal(speciesId: string, taxRateId: string, name = "Python femelle", priceCents = 30000, extra: { depositPercent?: number } = {}) {
  const product = await db.product.create({ data: { type: "ANIMAL", status: "PUBLISHED", name, slug: `${name}-${crypto.randomUUID().slice(0, 6)}`.toLowerCase().replace(/\s/g, "-"), description: "Description de test.", priceCents, taxRateId, stockOnHand: 1, ...extra } });
  const animal = await db.animal.create({ data: { productId: product.id, speciesId, status: "AVAILABLE", sex: "FEMALE" } });
  return { product, animal };
}

export async function createAccessory(taxRateId: string, stock = 10, priceCents = 5000) {
  return db.product.create({ data: { type: "ACCESSORY", status: "PUBLISHED", name: `Lampe ${crypto.randomUUID().slice(0, 4)}`, slug: `lampe-${crypto.randomUUID().slice(0, 8)}`, description: "Accessoire de test.", priceCents, taxRateId, stockOnHand: stock } });
}

export async function createUser(role: Role = "CUSTOMER", email = `u-${crypto.randomUUID().slice(0, 8)}@example.org`, postalCode = "75001") {
  const id = crypto.randomUUID();
  const user = await db.user.create({ data: { id, email, name: "Test User", firstName: "Camille", lastName: "Martin", birthDate: new Date("1990-01-01"), emailVerified: true, role } });
  const address = await db.address.create({ data: { userId: id, firstName: "Camille", lastName: "Martin", line1: "1 rue", postalCode, city: "Ville", country: "FR", phone: "0600000000", isDefault: true } });
  return { ...user, addressId: address.id };
}

export async function cartFor(userId: string, items: { productId: string; quantity?: number }[]) {
  const cart = await db.cart.create({ data: { userId, items: { create: items.map((i) => ({ productId: i.productId, quantity: i.quantity ?? 1 })) } } });
  return db.cart.findUniqueOrThrow({ where: { id: cart.id }, include: cartInclude });
}

export async function approvedDocs(userId: string, types: ("IDENTITY_DOCUMENT" | "CERTIFICATE")[], expiresAt: Date | null = null) {
  for (const type of types) {
    await db.document.create({ data: { userId, type, status: "APPROVED", originalName: `${type}.pdf`, mimeType: "application/pdf", extension: "pdf", sizeBytes: 10, sha256: crypto.randomUUID(), storageKey: `documents/${crypto.randomUUID()}.pdf`, expiresAt } });
  }
}
