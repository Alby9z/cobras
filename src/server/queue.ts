import "server-only";
import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { log } from "@/server/logger";

/** Tâches asynchrones exécutées par le worker (src/worker). */
export interface JobMap {
  "email.send": { emailLogId: string };
  "invoice.pdf": { invoiceId: string; emailAfter: boolean };
  "document.scan": { documentId: string };
  "reservations.expire": Record<string, never>;
  "authorizations.check": Record<string, never>;
  "carts.abandoned": Record<string, never>;
  "alerts.business": Record<string, never>;
}
export type JobName = keyof JobMap;
export const QUEUE_NAME = "jobs";

export interface QueueDriver {
  add<N extends JobName>(name: N, data: JobMap[N], opts?: JobsOptions): Promise<void>;
}

let connection: IORedis | null = null;
export function redis(): IORedis {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL manquant");
    connection = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
    connection.on("error", (e) => log.error("redis.error", { error: e }));
  }
  return connection;
}

let queue: Queue | null = null;
const bullDriver: QueueDriver = {
  async add(name, data, opts) {
    queue ??= new Queue(QUEUE_NAME, { connection: redis() });
    await queue.add(name, data, {
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 30 * 24 * 3600 }, // conservés 30 jours : file des échecs (dead-letter)
      ...opts,
    });
  },
};

let driver: QueueDriver = bullDriver;
/** Tests : remplace la file par un enregistreur en mémoire. */
export function setQueueDriver(d: QueueDriver) {
  driver = d;
}

/**
 * Ajoute une tâche. Si Redis est indisponible, l'erreur est journalisée et remontée :
 * l'appelant décide (l'e-mail reste QUEUED en base et sera repris par le balayage du worker).
 */
export async function enqueue<N extends JobName>(name: N, data: JobMap[N], opts?: JobsOptions) {
  try {
    await driver.add(name, data, opts);
  } catch (e) {
    log.error("queue.enqueue_failed", { job: name, error: e });
    throw e;
  }
}
