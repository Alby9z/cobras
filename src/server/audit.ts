import "server-only";
import { db, type Tx } from "@/server/db";
import { getContext } from "@/server/context";
import { log } from "@/server/logger";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";

export interface AuditEntry {
  actor: { id: string; role: Role } | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  data?: unknown;
}

const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

/**
 * Journal d'audit en ajout seul (UPDATE/DELETE refusés par PostgreSQL).
 * Dans une transaction métier, passer `tx` : l'audit est alors atomique avec l'action.
 */
export async function audit(entry: AuditEntry, tx?: Tx) {
  const ctx = await getContext();
  const data = {
    actorId: entry.actor?.id ?? null,
    actorRole: entry.actor?.role ?? (ctx.source === "http" ? null : "SYSTEM"),
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: json(entry.before),
    after: json(entry.after),
    reason: entry.reason ?? null,
    data: json(entry.data),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  };
  if (tx) {
    await tx.auditLog.create({ data });
    return;
  }
  try {
    await db.auditLog.create({ data });
  } catch (e) {
    log.error("audit.write_failed", { action: entry.action, error: e });
  }
}
