"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, withUserScope } from "@/server/db";
import { requireUser } from "@/server/session";
import { redirect } from "next/navigation";
import { limited } from "@/server/rate-limit";
import { uploadCustomerDocument } from "@/server/documents";
import { confirmDelivery, retryPayment } from "@/server/orders";
import { COUNTRIES, departmentFromPostalCode } from "@/lib/geo-fr";
import { zodErrors, toActionError, type ActionState } from "@/lib/action-state";

const addressSchema = z.object({
  id: z.string().max(40).optional().or(z.literal("")),
  label: z.string().trim().max(60).optional(),
  firstName: z.string().trim().min(1, "Prénom requis.").max(80),
  lastName: z.string().trim().min(1, "Nom requis.").max(80),
  company: z.string().trim().max(120).optional(),
  line1: z.string().trim().min(3, "Adresse requise.").max(200),
  line2: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().min(3, "Code postal requis.").max(12),
  city: z.string().trim().min(1, "Ville requise.").max(100),
  country: z.string().refine((c) => c in COUNTRIES, "Pays non desservi."),
  phone: z.string().trim().min(6, "Téléphone requis (pour le transporteur).").max(30).regex(/^[+\d\s().-]+$/, "Numéro invalide."),
  isDefault: z.string().optional(),
});

export async function saveAddress(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = addressSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const { id, isDefault, ...data } = parsed.data;
  if (data.country === "FR" && !departmentFromPostalCode(data.postalCode)) return { error: "Code postal français invalide.", fieldErrors: { postalCode: "Code postal invalide." } };

  await withUserScope(user.id, async (tx) => {
    const count = await tx.address.count();
    const makeDefault = isDefault === "on" || count === 0;
    if (makeDefault) await tx.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    if (id) {
      const res = await tx.address.updateMany({ where: { id, userId: user.id }, data: { ...data, isDefault: makeDefault } });
      if (!res.count) throw new Error("NOT_FOUND");
    } else {
      await tx.address.create({ data: { ...data, userId: user.id, isDefault: makeDefault } });
    }
  });
  revalidatePath("/compte/adresses");
  revalidatePath("/commande");
  return { ok: "Adresse enregistrée." };
}

export async function deleteAddress(fd: FormData) {
  const user = await requireUser();
  const id = z.string().max(40).parse(fd.get("id"));
  await withUserScope(user.id, (tx) => tx.address.deleteMany({ where: { id, userId: user.id } }));
  revalidatePath("/compte/adresses");
}

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).regex(/^[+\d\s().-]*$/, "Numéro invalide.").optional(),
  marketingOptIn: z.string().optional(),
});

export async function updateProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodErrors(parsed.error);
  const { firstName, lastName, phone, marketingOptIn } = parsed.data;
  // La date de naissance n'est pas modifiable en libre-service (contrôle de majorité).
  await db.user.update({ where: { id: user.id }, data: { firstName, lastName, name: `${firstName} ${lastName}`, phone: phone || null, marketingOptIn: marketingOptIn === "on" } });
  revalidatePath("/compte");
  return { ok: "Profil mis à jour." };
}

const docType = z.enum(["IDENTITY_DOCUMENT", "ADDRESS_PROOF", "CERTIFICATE", "AUTHORIZATION", "DECLARATION", "CITES_DOCUMENT", "REGULATORY_DOCUMENT", "OTHER"]);

export async function uploadDocument(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/compte/documents");
  if (await limited("documents", 20, 3600)) return { error: "Trop de fichiers envoyés. Réessayez plus tard." };
  const type = docType.safeParse(fd.get("type"));
  const file = fd.get("file");
  const expires = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).safeParse(fd.get("expiresAt") ?? "");
  if (!type.success) return { error: "Choisissez le type de document." };
  if (!(file instanceof File) || file.size === 0) return { error: "Sélectionnez un fichier." };
  try {
    await uploadCustomerDocument(user, file, type.data, expires.success && expires.data ? new Date(`${expires.data}T00:00:00Z`) : null);
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/compte/documents");
  return { ok: "Document reçu. Il est en cours d'analyse antivirus, puis sera contrôlé par notre équipe." };
}

export async function markNotificationsRead() {
  const user = await requireUser();
  await withUserScope(user.id, (tx) => tx.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } }));
  revalidatePath("/compte");
}

export async function confirmReception(fd: FormData) {
  const user = await requireUser();
  const number = z.string().max(40).parse(fd.get("number"));
  const order = await db.order.findFirst({ where: { number, userId: user.id, status: "SHIPPED" } });
  if (!order) return;
  await confirmDelivery(order.id, { kind: "CUSTOMER", user });
  revalidatePath(`/compte/commandes/${number}`);
}

export async function payOrder(fd: FormData) {
  const user = await requireUser();
  const number = z.string().max(40).parse(fd.get("number"));
  let url: string;
  try {
    url = await retryPayment(number, user);
  } catch {
    redirect(`/compte/commandes/${number}?paiement=indisponible`);
  }
  redirect(url);
}
