import "server-only";
import { db } from "@/server/db";
import { getSettings, type Settings } from "@/server/settings";
import { REQUIRED_SELLER_SETTINGS } from "@/server/invoices";
import { AppError } from "@/lib/domain/errors";
import { redis } from "@/server/queue";
import { storage } from "@/server/storage";
import { scanBuffer } from "@/server/antivirus";

export type Severity = "blocking" | "warning";
export interface ReadinessCheck { code: string; label: string; ok: boolean; severity: Severity; detail?: string; fix?: string }

const REQUIRED_PAGES = ["mentions-legales", "cgv", "confidentialite"];
const STRATEGIES = ["PAY_IMMEDIATELY", "AUTHORIZE_THEN_CAPTURE", "DEPOSIT_THEN_BALANCE", "PAY_AFTER_COMPLIANCE"];

/**
 * Dépendances de mise en production : aucune vente n'est possible tant qu'une donnée légale ou
 * de configuration indispensable manque (mieux vaut bloquer que publier une information fictive).
 */
export async function businessReadiness(s?: Settings): Promise<ReadinessCheck[]> {
  const settings = s ?? (await getSettings());
  const [pages, taxRates, rates, rulesAge, species] = await Promise.all([
    db.page.findMany({ where: { slug: { in: REQUIRED_PAGES }, published: true }, select: { slug: true } }),
    db.taxRate.count({ where: { active: true } }),
    db.shippingRate.count({ where: { active: true } }),
    db.complianceRule.count({ where: { status: "ACTIVE", type: "AGE_REQUIREMENT" } }),
    db.species.findMany({ where: { animals: { some: { product: { status: "PUBLISHED" } } } }, select: { id: true, commonName: true, regulatoryCategory: true, rules: { where: { status: "ACTIVE" }, select: { id: true } } } }),
  ]);
  const categoriesCovered = new Set((await db.complianceRule.findMany({ where: { status: "ACTIVE", regulatoryCategory: { not: null } }, select: { regulatoryCategory: true } })).map((r) => r.regulatoryCategory));
  const missingSeller = REQUIRED_SELLER_SETTINGS.filter((k) => !settings[k]);
  const missingPages = REQUIRED_PAGES.filter((p) => !pages.some((x) => x.slug === p));
  const uncovered = species.filter((sp) => !sp.rules.length && !categoriesCovered.has(sp.regulatoryCategory));
  const shippingTaxOk = settings.vatRegime === "FRANCHISE" || Boolean(settings.shippingTaxRateCode && (await db.taxRate.count({ where: { code: settings.shippingTaxRateCode, active: true } })));

  return [
    { code: "SELLER_IDENTITY", label: "Identité légale du vendeur", ok: !missingSeller.length, severity: "blocking", detail: missingSeller.join(", "), fix: "/admin/parametres" },
    { code: "VAT_NUMBER", label: "N° de TVA (régime normal)", ok: settings.vatRegime !== "NORMAL" || Boolean(settings.vatNumber), severity: "blocking", fix: "/admin/parametres" },
    { code: "LEGAL_PAGES", label: "Pages légales publiées (mentions, CGV, confidentialité)", ok: !missingPages.length, severity: "blocking", detail: missingPages.join(", "), fix: "/admin/pages" },
    { code: "TAX_RATES", label: "Taux de TVA configurés", ok: taxRates > 0, severity: "blocking", fix: "/admin/tva" },
    { code: "SHIPPING_TAX", label: "TVA applicable à la livraison", ok: shippingTaxOk, severity: "blocking", fix: "/admin/parametres" },
    { code: "SHIPPING_RATES", label: "Tarifs de livraison", ok: rates > 0, severity: "blocking", fix: "/admin/livraison" },
    { code: "PAYMENT_STRATEGY", label: "Stratégie de paiement des animaux", ok: STRATEGIES.includes(settings.paymentStrategyAnimals ?? ""), severity: "blocking", fix: "/admin/parametres" },
    { code: "SPECIES_RULES", label: "Chaque espèce en vente est couverte par une règle validée", ok: !uncovered.length, severity: "warning", detail: uncovered.map((s2) => s2.commonName).join(", "), fix: "/admin/conformite/regles" },
    { code: "AGE_RULE", label: "Règle d'âge minimum active", ok: rulesAge > 0, severity: "warning", fix: "/admin/conformite/regles" },
  ];
}

export async function assertSalesReady() {
  const failing = (await businessReadiness()).filter((c) => !c.ok && c.severity === "blocking");
  if (failing.length) {
    throw new AppError("CONFIGURATION_ERROR", "La boutique n'est pas encore ouverte à la vente (configuration en cours). Réessayez plus tard ou contactez-nous.", { missing: failing.map((c) => c.code) });
  }
}

/** Santé technique des dépendances (utilisée par /api/ready et la page Santé système). */
export async function dependencyHealth(opts: { deep?: boolean } = {}) {
  const t = async (fn: () => Promise<unknown>) => {
    const start = Date.now();
    try {
      await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
      return { ok: true, ms: Date.now() - start };
    } catch (e) {
      return { ok: false, ms: Date.now() - start, error: (e as Error).message.slice(0, 120) };
    }
  };
  const res: Record<string, { ok: boolean; ms: number; error?: string }> = {
    database: await t(() => db.$queryRaw`SELECT 1`),
    redis: await t(() => redis().ping()),
  };
  if (opts.deep) {
    res.storage = await t(() => storage().ping());
    res.antivirus = await t(() => scanBuffer(Buffer.from("readiness-probe"), 3000));
  }
  return res;
}
