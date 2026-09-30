/**
 * Choix de la stratégie d'encaissement. Aucune règle légale n'est codée ici :
 * la stratégie résulte du paramétrage (produit, politique par défaut) et des contraintes techniques.
 */
import type { PaymentStrategy, ProductType } from "@/generated/prisma/enums";

export const STRATEGY_RANK: Record<PaymentStrategy, number> = {
  PAY_IMMEDIATELY: 1,
  DEPOSIT_THEN_BALANCE: 2,
  AUTHORIZE_THEN_CAPTURE: 3,
  PAY_AFTER_COMPLIANCE: 4,
};

export interface StrategyInput {
  lines: { productType: ProductType; paymentStrategy: PaymentStrategy | null; depositPercent: number | null }[];
  defaults: { animals: PaymentStrategy; other: PaymentStrategy };
  reviewRequired: boolean; // examen humain requis (animal, règle HUMAN_REVIEW…)
}

export interface StrategyDecision {
  strategy: PaymentStrategy;
  captureManually: boolean;
  chargeNow: "TOTAL" | "DEPOSIT" | "NOTHING";
  warnings: string[];
}

/** La stratégie la plus prudente parmi celles applicables à chaque ligne l'emporte. */
export function resolvePaymentStrategy(input: StrategyInput): StrategyDecision {
  const warnings: string[] = [];
  let strategy: PaymentStrategy = "PAY_IMMEDIATELY";
  for (const l of input.lines) {
    const s = l.paymentStrategy ?? (l.productType === "ANIMAL" ? input.defaults.animals : input.defaults.other);
    if (STRATEGY_RANK[s] > STRATEGY_RANK[strategy]) strategy = s;
  }
  if (strategy === "DEPOSIT_THEN_BALANCE" && !input.lines.some((l) => l.depositPercent)) {
    // Aucun pourcentage d'acompte configuré : on ne peut pas inventer un montant.
    strategy = "AUTHORIZE_THEN_CAPTURE";
    warnings.push("DEPOSIT_NOT_CONFIGURED");
  }
  if (strategy === "PAY_IMMEDIATELY" && input.reviewRequired) warnings.push("CAPTURE_BEFORE_REVIEW");
  if (strategy === "AUTHORIZE_THEN_CAPTURE") warnings.push("AUTHORIZATION_EXPIRES"); // validité limitée (≈ 7 jours pour une carte)
  return {
    strategy,
    captureManually: strategy === "AUTHORIZE_THEN_CAPTURE",
    chargeNow: strategy === "PAY_AFTER_COMPLIANCE" ? "NOTHING" : strategy === "DEPOSIT_THEN_BALANCE" ? "DEPOSIT" : "TOTAL",
    warnings,
  };
}
