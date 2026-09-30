import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { installFakes, jobs, type FakeStripe, type MemoryStorage } from "./fakes";
import { approvedDocs, cartFor, createAccessory, createAnimal, createUser, resetDb, seedBase } from "./seed";
import { checkout, approveCompliance, rejectCompliance, onCustomerDocumentsChanged, prepareOrder, shipOrderAction, confirmDelivery, refundOrder, expireReservations, transition, SYSTEM } from "@/server/orders";
import { recordAndProcess } from "@/server/stripe-events";
import { documentDownloadUrl, reviewDocument } from "@/server/documents";
import { AppError } from "@/lib/domain/errors";

let fake: FakeStripe;
let store: MemoryStorage;
beforeAll(() => ({ fake, store } = installFakes()));
beforeEach(async () => {
  await resetDb();
  jobs.length = 0;
  fake.failCheckout = false;
});

const sessionIdFromUrl = (url: string) => url.split("/").pop()!;
const expectError = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x) => x);
  expect(e, `attendu ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  return e as AppError;
};

async function buyAnimal(base: Awaited<ReturnType<typeof seedBase>>, opts: { postalCode?: string } = {}) {
  const { product, animal } = await createAnimal(base.species.id, base.tax.id);
  const user = await createUser("CUSTOMER", undefined, opts.postalCode);
  const cart = await cartFor(user.id, [{ productId: product.id }]);
  const res = await checkout({ user, addressId: user.addressId, shippingRateId: base.rate.id, idempotencyKey: crypto.randomUUID(), cart });
  const order = await db.order.findUniqueOrThrow({ where: { number: res.orderNumber } });
  return { product, animal, user, res, order };
}

describe("concurrence et intégrité", () => {
  it("même animal acheté simultanément → exactement une réservation réussie", async () => {
    const base = await seedBase();
    const { product, animal } = await createAnimal(base.species.id, base.tax.id);
    const buyers = await Promise.all([createUser(), createUser(), createUser()]);
    const carts = await Promise.all(buyers.map((u) => cartFor(u.id, [{ productId: product.id }])));
    const results = await Promise.allSettled(buyers.map((u, i) => checkout({ user: u, addressId: u.addressId, shippingRateId: base.rate.id, idempotencyKey: crypto.randomUUID(), cart: carts[i] })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) expect(((r as PromiseRejectedResult).reason as AppError).code).toBe("OUT_OF_STOCK");
    expect(await db.stockReservation.count({ where: { animalId: animal.id, status: { in: ["ACTIVE", "ALLOCATED"] } } })).toBe(1);
    expect((await db.animal.findUniqueOrThrow({ where: { id: animal.id } })).status).toBe("RESERVED");
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stockReserved).toBe(1);
  });

  it("la base refuse une deuxième réservation vivante du même animal (index partiel)", async () => {
    const base = await seedBase();
    const { animal, order } = await buyAnimal(base);
    await expect(db.stockReservation.create({ data: { orderId: order.id, productId: animal.productId, animalId: animal.id, quantity: 1 } })).rejects.toThrow();
  });

  it("double soumission du checkout (même clé d'idempotence) → une seule commande", async () => {
    const base = await seedBase();
    const { product } = await createAnimal(base.species.id, base.tax.id);
    const user = await createUser();
    const cart = await cartFor(user.id, [{ productId: product.id }]);
    const key = crypto.randomUUID();
    const [a, b] = await Promise.allSettled([1, 2].map(() => checkout({ user, addressId: user.addressId, shippingRateId: base.rate.id, idempotencyKey: key, cart })));
    expect(await db.order.count({ where: { userId: user.id } })).toBe(1);
    expect([a, b].some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("deux transitions concurrentes sur la même version → une seule appliquée", async () => {
    const base = await seedBase();
    const { order } = await buyAnimal(base);
    const outcomes = await Promise.allSettled([1, 2].map(() => db.$transaction((tx) => transition(tx, order.id, "CANCELLED", SYSTEM, { message: "test" }))));
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await db.orderEvent.count({ where: { orderId: order.id, status: "CANCELLED" } })).toBe(1);
  });
});

describe("paiement autorisé puis encaissé après conformité", () => {
  it("parcours complet : autorisation → documents → approbation → capture → facture → expédition → livraison", async () => {
    const base = await seedBase({ strategy: "AUTHORIZE_THEN_CAPTURE" });
    const { res, order, user, animal, product } = await buyAnimal(base);
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.totalCents).toBe(30000 + 4900);
    expect(order.totalExclTaxCents + order.taxCents).toBe(order.totalCents);

    const event = fake.pay(sessionIdFromUrl(res.redirectUrl), "requires_capture");
    expect(await recordAndProcess(event)).toBe("processed");
    let o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("DOCUMENTS_REQUIRED");
    expect(o.amountAuthorizedCents).toBe(o.totalCents);
    expect(o.amountPaidCents).toBe(0);
    expect(await db.invoice.count()).toBe(0); // rien d'encaissé : aucune facture

    await approvedDocs(user.id, ["IDENTITY_DOCUMENT", "CERTIFICATE"]);
    await onCustomerDocumentsChanged(user.id);
    o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("DOCUMENTS_REVIEW");

    await approveCompliance(order.id, base.reviewer, { justification: "Documents conformes, identité vérifiée." });
    o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fake.calls).toContain("pi.capture");
    expect(o.status).toBe("READY_FOR_FULFILLMENT");
    expect(o.amountPaidCents).toBe(o.totalCents);
    const inv = await db.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    expect(inv.kind).toBe("INVOICE");
    expect(inv.totalCents).toBe(o.totalCents);
    expect(jobs.some((j) => j.name === "invoice.pdf")).toBe(true);

    await expectError(shipOrderAction(order.id, base.reviewer, { carrier: "X", number: "1" }), "INVALID_TRANSITION"); // pas encore préparée
    await prepareOrder(order.id, base.reviewer);
    await expectError(shipOrderAction(order.id, base.reviewer, {}), "VALIDATION_ERROR"); // suivi obligatoire
    await shipOrderAction(order.id, base.reviewer, { carrier: "Transporteur", number: "TRK1" });
    expect((await db.animal.findUniqueOrThrow({ where: { id: animal.id } })).status).toBe("SHIPPED");
    const p = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect([p.stockOnHand, p.stockReserved]).toEqual([0, 0]);

    await confirmDelivery(order.id, { kind: "CUSTOMER", user });
    expect((await db.animal.findUniqueOrThrow({ where: { id: animal.id } })).status).toBe("SOLD");
    const moves = await db.inventoryMovement.findMany({ where: { productId: product.id }, orderBy: { createdAt: "asc" } });
    expect(moves.map((m) => m.type)).toEqual(["RESERVATION", "ALLOCATION", "SHIPMENT"]);
    const events = await db.complianceEvaluation.findMany({ where: { case: { orderId: order.id } } });
    expect(events.map((e) => e.stage)).toEqual(expect.arrayContaining(["CHECKOUT", "PAYMENT", "DECISION", "FULFILLMENT"]));
  });

  it("webhook Stripe dupliqué → une seule opération métier", async () => {
    const base = await seedBase({ strategy: "PAY_IMMEDIATELY" });
    const acc = await createAccessory(base.tax.id);
    const user = await createUser();
    const res = await checkout({ user, addressId: user.addressId, shippingRateId: base.parcel.id, idempotencyKey: crypto.randomUUID(), cart: await cartFor(user.id, [{ productId: acc.id, quantity: 2 }]) });
    const ev = fake.pay(sessionIdFromUrl(res.redirectUrl), "succeeded");
    const outcomes = await Promise.all([recordAndProcess(ev), recordAndProcess(ev), recordAndProcess(ev)]);
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    const o = await db.order.findUniqueOrThrow({ where: { number: res.orderNumber } });
    expect(o.amountPaidCents).toBe(o.totalCents);
    expect(o.status).toBe("READY_FOR_FULFILLMENT");
    expect(await db.invoice.count({ where: { orderId: o.id } })).toBe(1);
    expect(await db.payment.count({ where: { orderId: o.id, status: "SUCCEEDED" } })).toBe(1);
    // Un événement différent pour le même paiement (payment_intent.succeeded) reste sans effet.
    const second = { ...ev, id: "evt_other", type: "payment_intent.succeeded", data: { object: { id: [...fake.intents.keys()][0] } } } as typeof ev;
    expect(await recordAndProcess(second)).toBe("processed");
    expect(await db.invoice.count({ where: { orderId: o.id } })).toBe(1);
  });
});

describe("règles critiques de conformité", () => {
  it("document requis manquant → approbation bloquée", async () => {
    const base = await seedBase();
    const { res, order, user } = await buyAnimal(base);
    await recordAndProcess(fake.pay(sessionIdFromUrl(res.redirectUrl), "requires_capture"));
    await approvedDocs(user.id, ["IDENTITY_DOCUMENT"]);
    const e = await expectError(approveCompliance(order.id, base.reviewer, { justification: "Tentative d'approbation" }), "COMPLIANCE_ERROR");
    expect(e.details.reasons).toContain("MISSING_REQUIRED_DOCUMENT");
  });

  it("document expiré → bloqué ; dérogation réservée au rôle habilité, justifiée et tracée", async () => {
    const base = await seedBase();
    const { res, order, user } = await buyAnimal(base);
    await recordAndProcess(fake.pay(sessionIdFromUrl(res.redirectUrl), "requires_capture"));
    await approvedDocs(user.id, ["IDENTITY_DOCUMENT"]);
    await approvedDocs(user.id, ["CERTIFICATE"], new Date("2025-01-01"));
    const e = await expectError(approveCompliance(order.id, base.reviewer, { justification: "Essai sans dérogation" }), "COMPLIANCE_ERROR");
    expect(e.details.reasons).toContain("DOCUMENT_EXPIRED");
    const admin = await createUser("ADMIN");
    await expectError(approveCompliance(order.id, admin, { justification: "Justification suffisamment longue pour une dérogation.", override: true }), "AUTHORIZATION_ERROR");
    await approveCompliance(order.id, base.reviewer, { justification: "Renouvellement du certificat en cours, attestation préfectorale reçue par courrier.", override: true });
    const kase = await db.complianceCase.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(kase).toMatchObject({ status: "APPROVED", overridden: true });
    expect(kase.overriddenChecks).toContain("DOCUMENT_EXPIRED");
    expect(await db.auditLog.count({ where: { action: "compliance.override_approve", entityId: order.id } })).toBe(1);
  });

  it("destination interdite → commande refusée au checkout", async () => {
    const base = await seedBase();
    await expectError(buyAnimal(base, { postalCode: "69001" }), "COMPLIANCE_ERROR");
    expect(await db.order.count()).toBe(0);
    expect(await db.stockReservation.count()).toBe(0);
  });

  it("espèce interdite → commande refusée", async () => {
    const base = await seedBase();
    await db.species.update({ where: { id: base.species.id }, data: { regulatoryCategory: "SALE_PROHIBITED" } });
    await expectError(buyAnimal(base), "COMPLIANCE_ERROR");
  });

  it("refus de conformité → autorisation annulée, animal remis en vente, commande annulée", async () => {
    const base = await seedBase();
    const { res, order, animal } = await buyAnimal(base);
    await recordAndProcess(fake.pay(sessionIdFromUrl(res.redirectUrl), "requires_capture"));
    await rejectCompliance(order.id, base.reviewer, "Certificat de capacité non conforme à l'espèce.");
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fake.calls).toContain("pi.cancel");
    expect(o.status).toBe("CANCELLED");
    expect(o.amountPaidCents).toBe(0);
    expect((await db.animal.findUniqueOrThrow({ where: { id: animal.id } })).status).toBe("AVAILABLE");
  });
});

describe("acompte puis solde", () => {
  it("facture d'acompte, puis solde après validation et facture de solde", async () => {
    const base = await seedBase({ strategy: "DEPOSIT_THEN_BALANCE" });
    const { product } = await createAnimal(base.species.id, base.tax.id, "Python acompte", 30000, { depositPercent: 30 });
    const user = await createUser();
    await approvedDocs(user.id, ["IDENTITY_DOCUMENT", "CERTIFICATE"]);
    const res = await checkout({ user, addressId: user.addressId, shippingRateId: base.rate.id, idempotencyKey: crypto.randomUUID(), cart: await cartFor(user.id, [{ productId: product.id }]) });
    let o = await db.order.findUniqueOrThrow({ where: { number: res.orderNumber } });
    expect(o.amountDueNowCents).toBe(9000);
    await recordAndProcess(fake.pay(sessionIdFromUrl(res.redirectUrl), "succeeded"));
    o = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(o.status).toBe("DOCUMENTS_REVIEW");
    expect((await db.invoice.findFirstOrThrow({ where: { orderId: o.id } })).kind).toBe("DEPOSIT_INVOICE");

    await approveCompliance(o.id, base.reviewer, { justification: "Dossier complet et conforme." });
    o = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(o.status).toBe("AWAITING_BALANCE");
    const balance = await db.payment.findFirstOrThrow({ where: { orderId: o.id, kind: "BALANCE" } });
    expect(balance.amountCents).toBe(o.totalCents - 9000);
    await recordAndProcess(fake.pay(balance.stripeCheckoutId, "succeeded"));
    o = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(o.status).toBe("READY_FOR_FULFILLMENT");
    const invs = await db.invoice.findMany({ where: { orderId: o.id }, orderBy: { issuedAt: "asc" } });
    expect(invs.map((i) => i.kind)).toEqual(["DEPOSIT_INVOICE", "BALANCE_INVOICE"]);
    expect(invs.reduce((s, i) => s + i.totalCents, 0)).toBe(o.totalCents);
  });
});

describe("remboursements", () => {
  it("deux remboursements simultanés ne dépassent jamais le montant payé ; avoirs émis", async () => {
    const base = await seedBase({ strategy: "PAY_IMMEDIATELY" });
    const acc = await createAccessory(base.tax.id);
    const user = await createUser();
    const res = await checkout({ user, addressId: user.addressId, shippingRateId: base.parcel.id, idempotencyKey: crypto.randomUUID(), cart: await cartFor(user.id, [{ productId: acc.id }]) });
    await recordAndProcess(fake.pay(sessionIdFromUrl(res.redirectUrl), "succeeded"));
    const o = await db.order.findUniqueOrThrow({ where: { number: res.orderNumber } });
    const staffUser = await createUser("ACCOUNTANT");
    const actor = { kind: "STAFF" as const, user: staffUser };
    const results = await Promise.allSettled([refundOrder(o.id, 4000, "Geste 1", actor), refundOrder(o.id, 4000, "Geste 2", actor)]);
    const after = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.amountRefundedCents).toBeLessThanOrEqual(after.amountPaidCents);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.invoice.count({ where: { orderId: o.id, kind: "CREDIT_NOTE" } })).toBe(1);
  });
});

describe("sécurité", () => {
  it("action administrative non autorisée → AUTHORIZATION_ERROR (403)", async () => {
    const base = await seedBase();
    const { res, order } = await buyAnimal(base);
    await recordAndProcess(fake.pay(sessionIdFromUrl(res.redirectUrl), "requires_capture"));
    const operator = await createUser("WAREHOUSE_OPERATOR");
    const e = await expectError(rejectCompliance(order.id, operator, "Tentative non autorisée par un préparateur."), "AUTHORIZATION_ERROR");
    expect(e.status).toBe(403);
  });

  it("un client ne peut pas accéder au document d'un autre client", async () => {
    await seedBase();
    const owner = await createUser();
    const other = await createUser();
    await approvedDocs(owner.id, ["IDENTITY_DOCUMENT"]);
    const doc = await db.document.findFirstOrThrow({ where: { userId: owner.id } });
    await expectError(documentDownloadUrl(other, doc.id), "RESOURCE_NOT_FOUND");
    expect(await documentDownloadUrl(owner, doc.id)).toContain("storage.test");
    expect(await db.auditLog.count({ where: { action: "document.access_owner", entityId: doc.id } })).toBe(1);
    const support = await createUser("SUPPORT_AGENT");
    await expectError(documentDownloadUrl(support, doc.id), "RESOURCE_NOT_FOUND");
    await expectError(reviewDocument(support, doc.id, "APPROVED", null, null), "AUTHORIZATION_ERROR");
  });

  it("journal d'audit et factures : modification et suppression refusées par la base", async () => {
    const base = await seedBase({ strategy: "PAY_IMMEDIATELY" });
    const acc = await createAccessory(base.tax.id);
    const user = await createUser();
    const res = await checkout({ user, addressId: user.addressId, shippingRateId: base.parcel.id, idempotencyKey: crypto.randomUUID(), cart: await cartFor(user.id, [{ productId: acc.id }]) });
    await recordAndProcess(fake.pay(sessionIdFromUrl(res.redirectUrl), "succeeded"));
    const inv = await db.invoice.findFirstOrThrow();
    await expect(db.invoice.update({ where: { id: inv.id }, data: { totalCents: 1 } })).rejects.toThrow();
    await expect(db.invoice.delete({ where: { id: inv.id } })).rejects.toThrow();
    await db.invoice.update({ where: { id: inv.id }, data: { pdfStatus: "READY", pdfStorageKey: "x.pdf" } }); // seul le rendu évolue
    const log = await db.auditLog.findFirstOrThrow();
    await expect(db.auditLog.update({ where: { id: log.id }, data: { action: "falsifié" } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: log.id } })).rejects.toThrow();
  });
});

describe("expiration", () => {
  it("réservation non payée expirée → commande annulée, animal libéré", async () => {
    const base = await seedBase();
    const { order, animal } = await buyAnimal(base);
    await expireReservations(new Date(Date.now() + 60 * 60e3));
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect((await db.animal.findUniqueOrThrow({ where: { id: animal.id } })).status).toBe("AVAILABLE");
    expect(store).toBeDefined();
  });

  it("échec de création de session Stripe → commande annulée et stock libéré", async () => {
    const base = await seedBase();
    fake.failCheckout = true;
    await expectError(buyAnimal(base), "EXTERNAL_SERVICE_ERROR");
    const o = await db.order.findFirstOrThrow();
    expect(o.status).toBe("CANCELLED");
    expect(await db.stockReservation.count({ where: { status: "RELEASED" } })).toBe(1);
  });
});
