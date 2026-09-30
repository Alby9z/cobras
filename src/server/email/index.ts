import "server-only";
import { db, type Tx } from "@/server/db";
import { enqueue } from "@/server/queue";
import { log } from "@/server/logger";
import { env } from "@/lib/env";
import { TEMPLATES, type TemplateName, type TemplateParams } from "@/server/email/templates";
import type { Prisma } from "@/generated/prisma/client";

export interface SendOptions {
  /** Clé de déduplication : un même e-mail métier n'est jamais envoyé deux fois (retries, doubles clics…). */
  dedupeKey: string;
  userId?: string | null;
  orderId?: string | null;
  attachInvoiceId?: string;
}

/**
 * Programme l'envoi d'un e-mail : journal (EmailLog) + tâche worker.
 * Idempotent : un dedupeKey déjà connu n'engendre aucun nouvel envoi.
 * Avec `tx`, le journal est créé dans la transaction métier et la tâche après validation (voir flushAfterCommit).
 */
export async function sendTemplate<N extends TemplateName>(name: N, to: string, params: TemplateParams<N>, opts: SendOptions, tx?: Tx): Promise<string | null> {
  const tpl = TEMPLATES[name];
  const content = (tpl.render as (p: TemplateParams<N>) => { subject: string })(params);
  const client = tx ?? db;
  const rows = await client.$queryRaw<{ id: string }[]>`
    INSERT INTO email_log (id, "dedupeKey", template, "templateVersion", "to", subject, payload, status, "userId", "orderId", "createdAt", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${opts.dedupeKey}, ${name}, ${tpl.version}, ${to}, ${content.subject},
            ${JSON.stringify({ params, attachInvoiceId: opts.attachInvoiceId ?? null })}::jsonb, 'QUEUED', ${opts.userId ?? null}, ${opts.orderId ?? null}, now(), now())
    ON CONFLICT ("dedupeKey") DO NOTHING
    RETURNING id`;
  const id = rows[0]?.id ?? null;
  if (!id) return null; // déjà programmé ou envoyé
  if (tx) pendingJobs.push(id);
  else await enqueue("email.send", { emailLogId: id }, { jobId: `email-${id}` }).catch(() => undefined); // repris par le balayage si Redis indisponible
  return id;
}

const pendingJobs: string[] = [];
/** À appeler après la validation d'une transaction ayant programmé des e-mails. */
export async function flushAfterCommit() {
  const ids = pendingJobs.splice(0);
  for (const id of ids) await enqueue("email.send", { emailLogId: id }, { jobId: `email-${id}` }).catch(() => undefined);
}

export async function notifyAdmin(subject: string, lines: string[], path: string, dedupeKey: string) {
  try {
    await sendTemplate("ADMIN_ALERT", env().ADMIN_NOTIFY_EMAIL, { subject, lines, path }, { dedupeKey: `admin:${dedupeKey}` });
  } catch (e) {
    log.error("email.admin_alert_failed", { subject, error: e });
  }
}

export type { Prisma };
