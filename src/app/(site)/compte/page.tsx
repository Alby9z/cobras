import Link from "next/link";
import { Bell } from "lucide-react";
import { Card, PageHeader, Alert } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/order-status";
import { ResendVerification } from "@/components/auth/resend-verification";
import { requireUser } from "@/server/session";
import { withUserScope } from "@/server/db";
import { markNotificationsRead } from "@/server/actions/account";
import { formatDate, formatPrice } from "@/lib/utils";

export const metadata = { title: "Mon compte" };

export default async function AccountPage() {
  const user = await requireUser();
  const { orders, notifications, pendingDocs } = await withUserScope(user.id, async (tx) => ({
    orders: await tx.order.findMany({ where: { userId: user.id, status: { notIn: ["DRAFT"] } }, orderBy: { createdAt: "desc" }, take: 3 }),
    notifications: await tx.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    pendingDocs: await tx.order.count({ where: { userId: user.id, status: "DOCUMENTS_REQUIRED" } }),
  }));
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader title="Mon compte" />
      {!user.emailVerified && <Alert tone="warning" className="mb-6">Votre email n&apos;est pas vérifié. <ResendVerification email={user.email} inline /></Alert>}
      {pendingDocs > 0 && <Alert tone="warning" className="mb-6">{pendingDocs} commande{pendingDocs > 1 ? "s attendent" : " attend"} vos documents. <Link href="/compte/documents" className="font-semibold underline">Déposer mes documents</Link></Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">Dernières commandes</h2>
          {orders.length === 0 ? <p className="text-sm text-muted-foreground">Aucune commande pour le moment.</p> : (
            <ul className="divide-y divide-border">
              {orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <Link href={`/compte/commandes/${o.number}`} className="font-medium hover:underline">{o.number}</Link>
                  <span className="text-muted-foreground">{formatDate(o.createdAt, { dateStyle: "short" })}</span>
                  <span>{formatPrice(o.totalCents)}</span>
                  <OrderStatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="link" className="mt-2 px-0"><Link href="/compte/commandes">Toutes mes commandes</Link></Button>
        </Card>
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold"><Bell className="h-4 w-4" aria-hidden /> Notifications {unread > 0 && <span className="rounded-full bg-accent px-2 text-xs text-accent-foreground">{unread}</span>}</h2>
            {unread > 0 && <form action={markNotificationsRead}><Button type="submit" variant="ghost" size="sm">Tout marquer comme lu</Button></form>}
          </div>
          {notifications.length === 0 ? <p className="text-sm text-muted-foreground">Aucune notification.</p> : (
            <ul className="space-y-3">
              {notifications.map((n) => (
                <li key={n.id} className={n.readAt ? "text-sm text-muted-foreground" : "text-sm"}>
                  {n.href ? <Link href={n.href} className="font-medium hover:underline">{n.title}</Link> : <span className="font-medium">{n.title}</span>} — {n.body}
                  <span className="block text-xs text-muted-foreground">{formatDate(n.createdAt, { dateStyle: "short", timeStyle: "short" })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
