/** Pages éditoriales gérées dans l'administration (légales, à propos…). */
export const CMS_PAGES: Record<string, string> = {
  "a-propos": "À propos",
  "mentions-legales": "Mentions légales",
  cgv: "Conditions générales de vente",
  cgu: "Conditions générales d'utilisation",
  confidentialite: "Politique de confidentialité",
  cookies: "Politique de cookies",
  rgpd: "Vos droits (RGPD)",
  livraison: "Livraison et transport des animaux",
  retours: "Rétractation et retours",
};
export const CMS_SLUGS = Object.keys(CMS_PAGES);
