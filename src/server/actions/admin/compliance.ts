"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/server/session";
import { approveRule, deleteRuleDraft, newRuleVersion, retireRule, saveRuleDraft } from "@/server/compliance";
import { FR_DEPARTMENTS, FR_REGIONS } from "@/lib/geo-fr";
import { toActionError, zodErrors, type ActionState } from "@/lib/action-state";

const DOCS = ["IDENTITY_DOCUMENT", "ADDRESS_PROOF", "CERTIFICATE", "AUTHORIZATION", "DECLARATION", "CITES_DOCUMENT", "REGULATORY_DOCUMENT", "OTHER"] as const;

const schema = z.object({
  id: z.string().max(40).optional().or(z.literal("")),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,40}$/, "Code : 3 à 40 caractères (lettres, chiffres, tirets)."),
  name: z.string().trim().min(3).max(160),
  jurisdiction: z.string().trim().toUpperCase().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$|^EU$/, "Ex. FR, FR-69, EU."),
  type: z.enum(["SALE_PROHIBITION", "DOCUMENT_REQUIREMENT", "AGE_REQUIREMENT", "GEO_RESTRICTION", "SHIPPING_RESTRICTION", "HUMAN_REVIEW"]),
  basis: z.enum(["LEGAL", "COMMERCIAL_POLICY"]),
  speciesId: z.string().max(40).optional().transform((v) => v || null),
  regulatoryCategory: z.enum(["", "SALE_ALLOWED", "SALE_ALLOWED_WITH_DOCUMENTS", "DECLARATION_REQUIRED", "CERTIFICATE_REQUIRED", "AUTHORIZATION_REQUIRED", "RESTRICTED", "SALE_PROHIBITED"]).optional().transform((v) => v || null),
  // Champs affichés selon le type de règle : absents du formulaire pour les autres types.
  mode: z.enum(["", "DENY", "ALLOW_ONLY"]).optional().transform((v) => v || null),
  zones: z.string().max(4000).optional(),
  minimumAge: z.string().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 120), "Âge invalide."),
  customerMessage: z.string().trim().max(300).optional().transform((v) => v || null),
  legalReference: z.string().trim().max(500).optional().transform((v) => v || null),
  sourceUrl: z.string().trim().url().max(500).optional().or(z.literal("")).transform((v) => v || null),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

/** Zones : une par ligne, « FR », « FR/84 » (région), « FR//69 » (département), « FR///20 » (préfixe postal). */
function parseZones(text: string | undefined) {
  const zones = [];
  for (const line of (text ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean)) {
    const [country, region, department, postalPrefix] = line.split("/").map((x) => x?.trim() || null);
    if (!country || !/^[A-Z]{2}$/i.test(country)) throw new Error(`Zone invalide : ${line}`);
    if (region && !(region in FR_REGIONS)) throw new Error(`Région inconnue : ${region}`);
    if (department && !FR_DEPARTMENTS.includes(department.toUpperCase())) throw new Error(`Département inconnu : ${department}`);
    if (postalPrefix && !/^\d{1,5}$/.test(postalPrefix)) throw new Error(`Préfixe postal invalide : ${postalPrefix}`);
    zones.push({ country: country.toUpperCase(), region, department: department?.toUpperCase() ?? null, postalPrefix });
  }
  return zones;
}

export async function saveRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let user;
  try { user = await assertPermission("compliance.rules.write"); } catch (e) { return toActionError(e); }
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const d = parsed.data;
  let zones;
  try { zones = parseZones(d.zones); } catch (e) { return { error: (e as Error).message, fieldErrors: { zones: (e as Error).message } }; }
  try {
    const rule = await saveRuleDraft(user, {
      code: d.code, name: d.name, jurisdiction: d.jurisdiction, type: d.type, basis: d.basis, speciesId: d.speciesId, regulatoryCategory: d.regulatoryCategory,
      productTypes: z.array(z.enum(["ANIMAL", "ACCESSORY", "EQUIPMENT"])).parse(fd.getAll("productTypes")), mode: d.mode, zones,
      methods: z.array(z.enum(["PICKUP", "SPECIALIZED_CARRIER", "STANDARD_PARCEL"])).parse(fd.getAll("methods")),
      shipDays: z.array(z.coerce.number().int().min(1).max(7)).parse(fd.getAll("shipDays")),
      requiredDocuments: z.array(z.enum(DOCS)).parse(fd.getAll("requiredDocuments")), minimumAge: d.minimumAge, customerMessage: d.customerMessage,
      legalReference: d.legalReference, sourceUrl: d.sourceUrl, effectiveFrom: new Date(`${d.effectiveFrom}T00:00:00Z`), effectiveUntil: d.effectiveUntil ? new Date(`${d.effectiveUntil}T00:00:00Z`) : null,
    }, d.id || undefined);
    revalidatePath("/admin/conformite/regles");
    return d.id ? { ok: "Brouillon enregistré." } : { ok: "Brouillon créé.", redirectTo: `/admin/conformite/regles/${rule.id}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function ruleLifecycleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const d = z.object({ ruleId: z.string().max(40), op: z.enum(["approve", "retire", "new_version", "delete"]), note: z.string().trim().max(1000).optional() }).parse(Object.fromEntries(fd));
    if (d.op === "approve") {
      const user = await assertPermission("compliance.rules.approve");
      if (!d.note || d.note.length < 10) return { error: "Indiquez votre note de validation (10 caractères minimum) : sources vérifiées, périmètre…" };
      await approveRule(user, d.ruleId, d.note);
    } else if (d.op === "retire") {
      const user = await assertPermission("compliance.rules.approve");
      if (!d.note || d.note.length < 5) return { error: "Motif du retrait requis." };
      await retireRule(user, d.ruleId, d.note);
    } else if (d.op === "new_version") {
      const user = await assertPermission("compliance.rules.write");
      const rule = await newRuleVersion(user, d.ruleId);
      revalidatePath("/admin/conformite/regles");
      return { ok: "Nouvelle version créée (brouillon).", redirectTo: `/admin/conformite/regles/${rule.id}` };
    } else {
      const user = await assertPermission("compliance.rules.write");
      await deleteRuleDraft(user, d.ruleId);
      revalidatePath("/admin/conformite/regles");
      return { ok: "Brouillon supprimé.", redirectTo: "/admin/conformite/regles" };
    }
    revalidatePath("/admin/conformite/regles", "layout");
    return { ok: d.op === "approve" ? "Règle validée et active." : "Règle retirée." };
  } catch (e) {
    return toActionError(e);
  }
}
