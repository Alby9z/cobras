"use server";
import { z } from "zod";
import { db } from "@/server/db";
import { limited, clientIp } from "@/server/rate-limit";
import { notifyAdmin } from "@/server/email";
import { getCurrentUser } from "@/server/session";
import { zodErrors, type ActionState } from "@/lib/action-state";

const schema = z.object({
  kind: z.enum(["CONTACT", "QUOTE", "AUDIT"]),
  name: z.string().trim().min(2, "Indiquez votre nom.").max(120),
  email: z.string().trim().email("Adresse email invalide.").max(200),
  phone: z.string().trim().max(30).regex(/^[+\d\s().-]*$/, "Numéro invalide.").optional().or(z.literal("")),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(10, "Votre message est trop court.").max(5000),
  consent: z.literal("on", { message: "Votre accord est nécessaire pour traiter la demande." }),
  website: z.string().max(0).optional(), // pot de miel anti-robots
});

const KIND_LABEL = { CONTACT: "Contact", QUOTE: "Demande de devis", AUDIT: "Demande d'audit" } as const;

export async function submitContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === "website")) return { ok: "Merci, votre message a bien été envoyé." };
    return zodErrors(parsed.error);
  }
  if (await limited("contact", 5, 3600)) return { error: "Trop de demandes envoyées. Réessayez plus tard." };
  const d = parsed.data;
  const user = await getCurrentUser();
  const req = await db.contactRequest.create({
    data: { kind: d.kind, name: d.name, email: d.email, phone: d.phone || null, subject: d.subject || null, message: d.message, userId: user?.id, consentAt: new Date(), ip: await clientIp() },
  });
  await notifyAdmin(`${KIND_LABEL[d.kind]} — ${d.name}`, [`Email : ${d.email}`, d.phone ? `Téléphone : ${d.phone}` : "", d.subject ?? "", d.message].filter(Boolean), `/admin/demandes/${req.id}`, `contact:${req.id}`);
  return { ok: "Merci, votre demande a bien été envoyée. Nous vous répondons sous 24 h ouvrées." };
}
