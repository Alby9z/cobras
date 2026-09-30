import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Queue } from "bullmq";
import { requirePermission } from "@/server/session";
import { businessReadiness, dependencyHealth } from "@/server/readiness";
import { redis, QUEUE_NAME } from "@/server/queue";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function queueStats() {
  try {
    const q = new Queue(QUEUE_NAME, { connection: redis() });
    const counts = await q.getJobCounts("waiting", "active", "delayed", "failed", "completed");
    const failed = await q.getFailed(0, 9);
    const heartbeat = await redis().get("worker:heartbeat");
    await q.close();
    return { counts, failed: failed.map((j) => ({ id: j.id, name: j.name, reason: j.failedReason?.slice(0, 160), at: j.finishedOn })), heartbeat };
  } catch {
    return null;
  }
}

export default async function SystemPage() {
  await requirePermission("system.read");
  const [readiness, deps, queue] = await Promise.all([businessReadiness(), dependencyHealth({ deep: true }), queueStats()]);
  const beatAge = queue?.heartbeat ? (Date.now() - new Date(queue.heartbeat).getTime()) / 1000 : null;
  return (
    <>
      <PageHeader title="Santé système" description={`Environnement : ${process.env.APP_ENV ?? "development"} · version ${process.env.APP_VERSION ?? "locale"}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Mise en production — dépendances métier</h2>
          <ul className="space-y-2 text-sm">
            {readiness.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center justify-between gap-2">
                <span>{c.label}{c.detail ? <span className="block text-xs text-muted-foreground">{c.detail}</span> : null}</span>
                <span className="flex items-center gap-2">{!c.ok && c.fix && <Link href={c.fix} className="text-xs text-primary underline">Corriger</Link>}<Badge tone={c.ok ? "success" : c.severity === "blocking" ? "danger" : "warning"}>{c.ok ? "OK" : c.severity === "blocking" ? "Bloquant" : "À traiter"}</Badge></span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Tant qu&apos;un point bloquant subsiste, le checkout refuse toute commande.</p>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Services techniques</h2>
          <ul className="space-y-2 text-sm">
            {Object.entries(deps).map(([k, v]) => <li key={k} className="flex justify-between"><span>{{ database: "PostgreSQL", redis: "Redis", storage: "Stockage objet (bucket privé)", antivirus: "Antivirus ClamAV" }[k] ?? k}{v.error ? <span className="block text-xs text-danger">{v.error}</span> : null}</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{v.ms} ms <Badge tone={v.ok ? "success" : "danger"}>{v.ok ? "OK" : "KO"}</Badge></span></li>)}
            <li className="flex justify-between"><span>Worker (tâches de fond)</span><Badge tone={beatAge !== null && beatAge < 90 ? "success" : "danger"}>{beatAge !== null ? `vu il y a ${Math.round(beatAge)} s` : "aucun signal"}</Badge></li>
          </ul>
        </Card>
        {queue && (
          <Card className="lg:col-span-2">
            <h2 className="mb-3 font-semibold">File de tâches</h2>
            <p className="text-sm">{Object.entries(queue.counts).map(([k, v]) => `${k} : ${v}`).join(" · ")}</p>
            {queue.failed.length > 0 && <ul className="mt-3 space-y-1 text-xs">{queue.failed.map((f) => <li key={f.id}><code>{f.name}</code> — {f.reason}{f.at ? ` (${formatDate(new Date(f.at), { dateStyle: "short", timeStyle: "short" })})` : ""}</li>)}</ul>}
          </Card>
        )}
      </div>
    </>
  );
}
