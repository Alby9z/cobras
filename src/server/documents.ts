import "server-only";
import { db, withUserScope } from "@/server/db";
import { storage } from "@/server/storage";
import { enqueue } from "@/server/queue";
import { audit } from "@/server/audit";
import { scanBuffer } from "@/server/antivirus";
import { sendTemplate, flushAfterCommit, notifyAdmin } from "@/server/email";
import { onCustomerDocumentsChanged } from "@/server/orders";
import { inspectUpload, randomKey, safeDisplayName, DOCUMENT_MIME } from "@/server/uploads";
import { AppError } from "@/lib/domain/errors";
import { can } from "@/lib/domain/permissions";
import { documentTypeLabel } from "@/lib/labels";
import { log } from "@/server/logger";
import type { DocumentType, Role } from "@/generated/prisma/enums";

export const DOCUMENT_QUOTA = { count: 40, bytes: 150 * 1024 * 1024 };

/** Dépôt d'un document : contrôlé, stocké en quarantaine, puis analysé par le worker (antivirus). */
export async function uploadCustomerDocument(user: { id: string; role: Role }, file: File, type: DocumentType, expiresAt: Date | null) {
  const usage = await db.document.aggregate({ where: { userId: user.id, status: { notIn: ["INFECTED"] } }, _count: true, _sum: { sizeBytes: true } });
  if (usage._count >= DOCUMENT_QUOTA.count || (usage._sum.sizeBytes ?? 0) + file.size > DOCUMENT_QUOTA.bytes) {
    throw new AppError("DOCUMENT_ERROR", "Quota de documents atteint. Contactez-nous pour supprimer d'anciens documents.");
  }
  const info = await inspectUpload(file, DOCUMENT_MIME);
  const duplicate = await db.document.findFirst({ where: { userId: user.id, sha256: info.sha256, type, status: { in: ["PENDING_SCAN", "PENDING_REVIEW", "APPROVED"] } } });
  if (duplicate) throw new AppError("CONFLICT", "Ce fichier a déjà été déposé pour ce type de document.");
  if (expiresAt && expiresAt <= new Date()) throw new AppError("DOCUMENT_ERROR", "Ce document est déjà expiré.");

  const key = randomKey(`quarantine/${user.id}`, info.ext);
  await storage().put("private", key, info.buffer, info.mime);
  const doc = await db.document.create({
    data: { userId: user.id, type, status: "PENDING_SCAN", originalName: safeDisplayName(file.name), mimeType: info.mime, extension: info.ext, sizeBytes: file.size, sha256: info.sha256, storageKey: key, expiresAt },
  });
  await audit({ actor: user, action: "document.upload", entity: "document", entityId: doc.id, after: { type, sizeBytes: file.size, sha256: info.sha256 } });
  try {
    await enqueue("document.scan", { documentId: doc.id }, { jobId: `scan-${doc.id}` });
  } catch {
    // File indisponible : le document reste PENDING_SCAN et sera repris par le balayage du worker.
  }
  return doc;
}

/** Tâche worker : analyse antivirus puis sortie de quarantaine. */
export async function scanDocument(documentId: string) {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.status !== "PENDING_SCAN") return;
  const buffer = await storage().get("private", doc.storageKey);
  const result = await scanBuffer(buffer); // lève si ClamAV indisponible → nouvelle tentative
  if (!result.clean) {
    await storage().remove("private", doc.storageKey).catch(() => undefined);
    await db.document.update({ where: { id: doc.id }, data: { status: "INFECTED", reviewNote: `Menace détectée : ${result.signature}` } });
    await audit({ actor: null, action: "document.infected", entity: "document", entityId: doc.id, data: { signature: result.signature } });
    await notifyAdmin("Fichier infecté rejeté", [`Document ${doc.id}`, `Signature : ${result.signature}`], "/admin/documents", `infected:${doc.id}`);
    return;
  }
  const finalKey = doc.storageKey.replace(/^quarantine\//, "documents/");
  await storage().copy("private", doc.storageKey, finalKey);
  await storage().remove("private", doc.storageKey).catch(() => undefined);
  await db.document.update({ where: { id: doc.id }, data: { status: "PENDING_REVIEW", storageKey: finalKey } });
  await onCustomerDocumentsChanged(doc.userId);
  await notifyAdmin(`Document à valider — ${documentTypeLabel[doc.type]}`, [`Déposé le ${doc.createdAt.toISOString().slice(0, 10)}`], "/admin/documents", `doc-review:${doc.id}`);
}

export async function markScanFailed(documentId: string) {
  await db.document.updateMany({ where: { id: documentId, status: "PENDING_SCAN" }, data: { status: "SCAN_FAILED" } });
  log.error("document.scan_failed_final", { documentId });
  await notifyAdmin("Analyse antivirus impossible", [`Document ${documentId}`, "Vérifiez le service ClamAV. Le client doit renvoyer le fichier."], "/admin/systeme", `scan-failed:${documentId}`);
}

export async function reviewDocument(actor: { id: string; role: Role }, documentId: string, decision: "APPROVED" | "REJECTED", note: string | null, expiresAt: Date | null) {
  if (!can(actor.role, "documents.review")) throw new AppError("AUTHORIZATION_ERROR", "Permission insuffisante.");
  if (decision === "REJECTED" && !note) throw new AppError("VALIDATION_ERROR", "Indiquez le motif du refus (communiqué au client).");
  const doc = await db.$transaction(async (tx) => {
    const before = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
    if (before.status !== "PENDING_REVIEW") throw new AppError("CONFLICT", "Ce document a déjà été traité ou n'est pas prêt.");
    const upd = await tx.document.updateMany({ where: { id: documentId, status: "PENDING_REVIEW" }, data: { status: decision, reviewNote: note, reviewedById: actor.id, reviewedAt: new Date(), ...(expiresAt ? { expiresAt } : {}) } });
    if (!upd.count) throw new AppError("CONFLICT", "Ce document vient d'être traité par un autre membre de l'équipe.");
    const after = await tx.document.findUniqueOrThrow({ where: { id: documentId }, include: { user: true } });
    await audit({ actor, action: `document.${decision === "APPROVED" ? "approve" : "reject"}`, entity: "document", entityId: documentId, before: { status: before.status }, after: { status: decision, expiresAt: after.expiresAt }, reason: note }, tx);
    await tx.notification.create({ data: { userId: after.userId, title: "Document contrôlé", body: decision === "APPROVED" ? `${documentTypeLabel[after.type]} validé.` : `${documentTypeLabel[after.type]} refusé.`, href: "/compte/documents" } });
    if (decision === "APPROVED") await sendTemplate("DOCUMENT_APPROVED", after.user.email, { type: after.type }, { dedupeKey: `document:${documentId}:approved`, userId: after.userId }, tx);
    else await sendTemplate("DOCUMENT_REJECTED", after.user.email, { type: after.type, note: note! }, { dedupeKey: `document:${documentId}:rejected`, userId: after.userId }, tx);
    return after;
  });
  await flushAfterCommit();
  await onCustomerDocumentsChanged(doc.userId);
}

/** URL signée (2 min) : propriétaire ou personnel habilité ; tout accès est journalisé. */
export async function documentDownloadUrl(viewer: { id: string; role: Role }, documentId: string) {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  const isOwner = doc?.userId === viewer.id;
  if (!doc || (!isOwner && !can(viewer.role, "documents.read_sensitive"))) throw new AppError("RESOURCE_NOT_FOUND", "Document introuvable.");
  if (doc.status === "INFECTED" || doc.status === "PENDING_SCAN" || doc.status === "SCAN_FAILED") throw new AppError("DOCUMENT_ERROR", "Ce document n'est pas consultable.");
  await audit({ actor: viewer, action: isOwner ? "document.access_owner" : "document.access_sensitive", entity: "document", entityId: doc.id });
  return storage().signedDownloadUrl(doc.storageKey, `${documentTypeLabel[doc.type]}.${doc.extension}`);
}

export async function listOwnDocuments(userId: string) {
  return withUserScope(userId, (tx) => tx.document.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }));
}
