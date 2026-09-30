import { NextResponse } from "next/server";
import { assertUser } from "@/server/session";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { audit } from "@/server/audit";
import { apiRoute } from "@/server/api";
import { can } from "@/lib/domain/permissions";
import { AppError } from "@/lib/domain/errors";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await assertUser();
  const inv = await db.invoice.findUnique({ where: { id: (await params).id }, include: { order: { select: { userId: true } } } });
  if (!inv || (inv.order.userId !== user.id && !can(user.role, "invoices.read"))) throw new AppError("RESOURCE_NOT_FOUND", "Facture introuvable.");
  if (inv.pdfStatus !== "READY" || !inv.pdfStorageKey) throw new AppError("CONFLICT", "Le PDF de cette facture est en cours de génération. Réessayez dans un instant.");
  if (inv.order.userId !== user.id) await audit({ actor: user, action: "invoice.access", entity: "invoice", entityId: inv.id });
  return NextResponse.redirect(await storage().signedDownloadUrl(inv.pdfStorageKey, `${inv.number}.pdf`), { headers: { "Cache-Control": "no-store" } });
});
