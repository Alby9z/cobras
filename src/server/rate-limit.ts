import "server-only";
import { db } from "@/server/db";
import { getContext } from "@/server/context";

/** Limiteur de débit à fenêtre fixe, partagé entre instances via PostgreSQL. */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const ip = await clientIp();
  const key = `${bucket}:${ip}`;
  const windowEnd = new Date(Date.now() + windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO app_rate_limit (key, count, "windowEnd") VALUES (${key}, 1, ${windowEnd})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN app_rate_limit."windowEnd" < now() THEN 1 ELSE app_rate_limit.count + 1 END,
      "windowEnd" = CASE WHEN app_rate_limit."windowEnd" < now() THEN ${windowEnd} ELSE app_rate_limit."windowEnd" END
    RETURNING count`;
  return rows[0].count <= limit;
}

export async function clientIp(): Promise<string> {
  return (await getContext()).ip ?? "unknown";
}

/** Limites configurables par variable d'environnement : RATE_LIMIT_<NOM>=max/fenêtre_s (ex. 5/3600). */
export function limitFor(name: string, max: number, windowSeconds: number): [number, number] {
  const raw = process.env[`RATE_LIMIT_${name.toUpperCase()}`];
  const m = raw?.match(/^(\d+)\/(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : [max, windowSeconds];
}

export async function limited(name: string, max: number, windowSeconds: number) {
  const [m, w] = limitFor(name, max, windowSeconds);
  return !(await rateLimit(name, m, w));
}
