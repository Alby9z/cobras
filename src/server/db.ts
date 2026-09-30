import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

export const db = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Exécute des requêtes « au nom » d'un client : PostgreSQL (Row Level Security)
 * limite alors les tables personnelles aux lignes de cet utilisateur.
 */
export async function withUserScope<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/** Numérotation continue (factures, commandes) — verrouillage ligne pour éviter les doublons. */
export async function nextSequence(tx: Tx, name: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counter (name, value) VALUES (${name}, 1)
    ON CONFLICT (name) DO UPDATE SET value = counter.value + 1
    RETURNING value`;
  return rows[0].value;
}
