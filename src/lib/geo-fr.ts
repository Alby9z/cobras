/** Référentiel géographique français (régions INSEE depuis 2016). */

export const FR_REGIONS: Record<string, { name: string; departments: string[] }> = {
  "84": { name: "Auvergne-Rhône-Alpes", departments: ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"] },
  "27": { name: "Bourgogne-Franche-Comté", departments: ["21", "25", "39", "58", "70", "71", "89", "90"] },
  "53": { name: "Bretagne", departments: ["22", "29", "35", "56"] },
  "24": { name: "Centre-Val de Loire", departments: ["18", "28", "36", "37", "41", "45"] },
  "94": { name: "Corse", departments: ["2A", "2B"] },
  "44": { name: "Grand Est", departments: ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"] },
  "32": { name: "Hauts-de-France", departments: ["02", "59", "60", "62", "80"] },
  "11": { name: "Île-de-France", departments: ["75", "77", "78", "91", "92", "93", "94", "95"] },
  "28": { name: "Normandie", departments: ["14", "27", "50", "61", "76"] },
  "75": { name: "Nouvelle-Aquitaine", departments: ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"] },
  "76": { name: "Occitanie", departments: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"] },
  "52": { name: "Pays de la Loire", departments: ["44", "49", "53", "72", "85"] },
  "93": { name: "Provence-Alpes-Côte d'Azur", departments: ["04", "05", "06", "13", "83", "84"] },
  "01": { name: "Guadeloupe", departments: ["971"] },
  "02": { name: "Martinique", departments: ["972"] },
  "03": { name: "Guyane", departments: ["973"] },
  "04": { name: "La Réunion", departments: ["974"] },
  "06": { name: "Mayotte", departments: ["976"] },
};

const deptToRegion = new Map<string, string>();
for (const [code, r] of Object.entries(FR_REGIONS)) for (const d of r.departments) deptToRegion.set(d, code);

export const FR_DEPARTMENTS = [...deptToRegion.keys()].sort();

/** Déduit le département d'un code postal français. Renvoie null si invalide ou hors départements. */
export function departmentFromPostalCode(postalCode: string): string | null {
  const cp = postalCode.replace(/\s/g, "");
  if (!/^\d{5}$/.test(cp)) return null;
  if (cp.startsWith("97")) {
    const d = cp.slice(0, 3);
    return deptToRegion.has(d) ? d : null;
  }
  if (cp.startsWith("20")) return Number(cp) < 20200 ? "2A" : "2B";
  const d = cp.slice(0, 2);
  return deptToRegion.has(d) ? d : null;
}

export function regionFromDepartment(dept: string | null): string | null {
  return dept ? deptToRegion.get(dept) ?? null : null;
}

/** Pays proposés à la livraison (ISO alpha-2). La liste effective dépend des tarifs configurés. */
export const COUNTRIES: Record<string, string> = {
  FR: "France", BE: "Belgique", LU: "Luxembourg", CH: "Suisse", DE: "Allemagne", ES: "Espagne",
  IT: "Italie", NL: "Pays-Bas", PT: "Portugal", AT: "Autriche", IE: "Irlande", MC: "Monaco",
};
