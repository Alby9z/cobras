import "server-only";
import { cache } from "react";
import { db } from "@/server/db";

/** Paramètres de l'entreprise saisis dans l'administration. Aucune valeur n'est inventée. */
export const SETTING_KEYS = {
  companyName: "Raison sociale",
  brandName: "Nom commercial (affiché sur le site)",
  tagline: "Accroche (page d'accueil)",
  valueProposition: "Proposition de valeur (page d'accueil)",
  about: "Présentation de l'entreprise (page d'accueil)",
  legalForm: "Forme juridique",
  siret: "SIRET",
  vatNumber: "N° TVA intracommunautaire",
  capacityCertificate: "N° certificat de capacité de l'établissement",
  establishmentAuthorization: "N° autorisation d'ouverture d'établissement",
  addressLine: "Adresse",
  postalCode: "Code postal",
  city: "Ville",
  country: "Pays (ISO, ex. FR)",
  phone: "Téléphone",
  email: "Email de contact",
  openingHours: "Horaires (texte libre)",
  latitude: "Latitude (Google Business)",
  longitude: "Longitude (Google Business)",
  mapsQuery: "Recherche Google Maps (ex. raison sociale + ville)",
  rcs: "RCS / RM (ville et numéro)",
  shareCapital: "Capital social",
  vatRegime: "Régime de TVA (à confirmer avec votre expert-comptable)",
  vatNote: "Mention TVA en franchise (ex. « TVA non applicable, art. 293 B du CGI »)",
  shippingTaxRateCode: "Taux de TVA appliqué à la livraison",
  invoiceLegalMentions: "Mentions légales des factures (pénalités de retard, escompte…)",
  paymentStrategyAnimals: "Stratégie de paiement par défaut des animaux",
  reservationMinutes: "Durée de réservation pendant le paiement (minutes, ex. 30)",
  complianceHoldHours: "Durée de réservation en attente de validation (heures, ex. 72)",
  balancePaymentHours: "Délai de paiement du solde après validation (heures, ex. 48)",
  abandonedCartDelayHours: "Délai avant relance de panier abandonné (heures, ex. 24)",
  instagram: "URL Instagram",
  facebook: "URL Facebook",
} as const;

export type SettingKey = keyof typeof SETTING_KEYS;
export type Settings = Partial<Record<SettingKey, string>>;

export const getSettings = cache(async (): Promise<Settings> => {
  const rows = await db.setting.findMany();
  const out: Settings = {};
  for (const r of rows) if (r.key in SETTING_KEYS && r.value.trim()) out[r.key as SettingKey] = r.value;
  return out;
});

export function intSetting(s: Settings, key: SettingKey, fallback: number, min = 1, max = 24 * 365) {
  const n = Number(s[key]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function brandName(s: Settings) {
  return s.brandName || s.companyName || process.env.NEXT_PUBLIC_SITE_NAME || "Boutique";
}
