/**
 * Worker asynchrone (processus séparé) : e-mails, PDF de factures, antivirus, tâches planifiées.
 * Lancement : node --conditions=react-server dist/worker.mjs
 */
import { Worker, Queue, type Job } from "bullmq";
import { redis, QUEUE_NAME, type JobMap, type JobName } from "@/server/queue";
import { runWithContext } from "@/server/context";
import { log } from "@/server/logger";
import { deliverEmail } from "@/server/email/deliver";
import { generateInvoicePdf, remindAbandonedCarts, checkAuthorizations, businessAlertsAndSweep } from "@/server/jobs";
import { scanDocument, markScanFailed } from "@/server/documents";
import { expireReservations } from "@/server/orders";
import { db } from "@/server/db";
import { env } from "@/lib/env";

process.env.SERVICE_NAME = "worker";
env(); // validation de la configuration au démarrage : arrêt immédiat si invalide

const handlers: { [N in JobName]: (data: JobMap[N]) => Promise<unknown> } = {
  "email.send": (d) => deliverEmail(d.emailLogId),
  "invoice.pdf": (d) => generateInvoicePdf(d.invoiceId, d.emailAfter),
  "document.scan": (d) => scanDocument(d.documentId),
  "reservations.expire": () => expireReservations(),
  "authorizations.check": () => checkAuthorizations(),
  "carts.abandoned": () => remindAbandonedCarts(),
  "alerts.business": () => businessAlertsAndSweep(),
};

async function onFinalFailure(job: Job) {
  const data = job.data as Record<string, string>;
  if (job.name === "email.send") await db.emailLog.update({ where: { id: data.emailLogId }, data: { status: "FAILED" } }).catch(() => undefined);
  if (job.name === "document.scan") await markScanFailed(data.documentId);
  if (job.name === "invoice.pdf") await db.invoice.update({ where: { id: data.invoiceId }, data: { pdfStatus: "FAILED" } }).catch(() => undefined);
}

async function main() {
  const connection = redis();
  const queue = new Queue(QUEUE_NAME, { connection });
  // Tâches planifiées (idempotentes : une seule planification par identifiant).
  await queue.upsertJobScheduler("reservations-expire", { every: 5 * 60e3 }, { name: "reservations.expire", data: {} });
  await queue.upsertJobScheduler("authorizations-check", { every: 60 * 60e3 }, { name: "authorizations.check", data: {} });
  await queue.upsertJobScheduler("carts-abandoned", { every: 60 * 60e3 }, { name: "carts.abandoned", data: {} });
  await queue.upsertJobScheduler("alerts-business", { every: 15 * 60e3 }, { name: "alerts.business", data: {} });

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => runWithContext({ requestId: `job:${job.name}:${job.id}`, source: "worker" }, async () => {
      const start = Date.now();
      const handler = handlers[job.name as JobName] as (d: unknown) => Promise<unknown>;
      if (!handler) throw new Error(`Tâche inconnue : ${job.name}`);
      const result = await handler(job.data);
      log.info("job.completed", { job: job.name, id: job.id, ms: Date.now() - start, attempt: job.attemptsMade + 1 });
      return result;
    }),
    { connection, concurrency: 5 },
  );
  worker.on("failed", async (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    log.error("job.failed", { job: job.name, id: job.id, attempt: job.attemptsMade, final, error: err });
    if (final) await onFinalFailure(job);
  });

  const beat = setInterval(() => connection.set("worker:heartbeat", new Date().toISOString(), "EX", 120).catch(() => undefined), 30_000);
  await connection.set("worker:heartbeat", new Date().toISOString(), "EX", 120);
  log.info("worker.started", { queue: QUEUE_NAME });

  const shutdown = async (signal: string) => {
    log.info("worker.stopping", { signal });
    clearInterval(beat);
    await worker.close();
    await queue.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  log.error("worker.fatal", { error: e });
  process.exit(1);
});
