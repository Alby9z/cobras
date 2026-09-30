import { PageHeader } from "@/components/ui/card";
import { SimpleForm } from "@/components/admin/simple-forms";
import { db } from "@/server/db";
import { requirePermission } from "@/server/session";
import { updateUser } from "@/server/actions/admin/content";
import { assignableRoles, ROLE_PERMISSIONS } from "@/lib/domain/permissions";
import { roleLabel } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import type { Role } from "@/generated/prisma/enums";

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; role?: string }> }) {
  const actor = await requirePermission("users.read");
  const { q, role } = await searchParams;
  const users = await db.user.findMany({
    where: { ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } : {}), ...(role && role in roleLabel ? { role: role as Role } : {}) },
    orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { orders: true } } },
  });
  const assignable = assignableRoles(actor.role);
  return (
    <>
      <PageHeader title="Utilisateurs & rôles" description="Les rôles déterminent des permissions précises vérifiées côté serveur. Un changement de rôle déconnecte la personne concernée." />
      <form className="mb-4 flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">Recherche</label>
        <input id="q" name="q" defaultValue={q} placeholder="Email ou nom" className="h-10 rounded-lg border border-border bg-card px-3 text-sm" />
        <select name="role" defaultValue={role ?? ""} aria-label="Rôle" className="h-10 rounded-lg border border-border bg-card px-3 text-sm"><option value="">Tous les rôles</option>{Object.entries(roleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Filtrer</button>
      </form>
      <div className="space-y-3">
        {users.map((u) => (
          <details key={u.id} className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer">
              <span className="font-semibold">{u.firstName} {u.lastName}</span> <span className="text-sm text-muted-foreground">{u.email} · {roleLabel[u.role]} · {u._count.orders} commande(s) · inscrit le {formatDate(u.createdAt, { dateStyle: "short" })}{u.emailVerified ? "" : " · email non vérifié"}{u.twoFactorEnabled ? " · 2FA" : ""}{u.banned ? " · BLOQUÉ" : ""}</span>
            </summary>
            <p className="mt-3 text-xs text-muted-foreground">Permissions : {ROLE_PERMISSIONS[u.role].join(", ") || "aucune (client)"}</p>
            {assignable.includes(u.role) && u.id !== actor.id && (
              <div className="mt-4 max-w-xl"><SimpleForm action={updateUser} hidden={{ id: u.id }} fields={[
                { name: "role", label: "Rôle", type: "select", options: assignable.map((r) => [r, roleLabel[r]]), defaultValue: u.role },
                { name: "banned", label: "Bloquer le compte (déconnexion immédiate)", type: "checkbox", defaultChecked: u.banned },
              ]} /></div>
            )}
          </details>
        ))}
      </div>
    </>
  );
}
