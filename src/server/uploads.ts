import "server-only";
import crypto from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { env } from "@/lib/env";
import { AppError } from "@/lib/domain/errors";

export const DOCUMENT_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

const EXT_ALIASES: Record<string, string> = { jpeg: "jpg", jpe: "jpg" };
const norm = (e: string) => EXT_ALIASES[e] ?? e;

/**
 * Contrôles d'un fichier reçu : taille, type réel (signature binaire), cohérence avec l'extension déclarée,
 * empreinte SHA-256. Le nom et le type MIME envoyés par le navigateur ne sont jamais utilisés.
 */
export async function inspectUpload(file: File, allowed: readonly string[]) {
  const max = env().UPLOAD_MAX_MB * 1024 * 1024;
  if (file.size === 0) throw new AppError("DOCUMENT_ERROR", "Le fichier est vide.");
  if (file.size > max) throw new AppError("DOCUMENT_ERROR", `Le fichier dépasse la taille maximale de ${env().UPLOAD_MAX_MB} Mo.`);
  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = await fileTypeFromBuffer(buffer);
  const allowedList = allowed.map((m) => m.split("/")[1].toUpperCase().replace("JPEG", "JPG")).join(", ");
  if (!detected || !allowed.includes(detected.mime)) throw new AppError("DOCUMENT_ERROR", `Format non accepté. Formats autorisés : ${allowedList}.`);
  const declared = norm((file.name.split(".").pop() ?? "").toLowerCase());
  if (declared !== norm(detected.ext)) throw new AppError("DOCUMENT_ERROR", "L'extension du fichier ne correspond pas à son contenu.");
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return { buffer, mime: detected.mime, ext: norm(detected.ext), sha256 };
}

export function randomKey(prefix: string, ext: string) {
  return `${prefix}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
}

/** Nom de fichier affichable sans caractère dangereux (jamais utilisé comme chemin de stockage). */
export function safeDisplayName(name: string) {
  return name.normalize("NFKC").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "document";
}
