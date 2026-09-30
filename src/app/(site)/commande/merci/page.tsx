import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TrackOnMount } from "@/components/analytics";
import { requireUser } from "@/server/session";
import { db } from "@/server/db";
import { formatPrice } from "@/lib/utils";
import { documentTypeLabel, orderStatusLabel } from "@/lib/labels";

export const metadata: Metadata = { title: "Merci pour votre commande", robots: { index: false } };
export const dynamic = "force-dynamic";

const orderInclude = { items: true } as const;

export default async function ThanksPage({ searchParams }: { searchParams: Promise<{ session_id?: string; commande?: string }> }) {
  const user = await requireUser();
  const { session_id, commande } = await searchParams;

  // Seules les commandes du client connecté sont lisibles (filtre userId systématique).
  const payment = session_id && session_id.length < 200
    ? await db.payment.findFirst({ where: { stripeCheckoutId: session_id, order: { userId: user.id } }, include: { order: { include: orderInclude } } })
    : null;
  const order = payment?.order
    ?? (commande && /^[A-Z0-9-]{3,40}$/.test(commande) ? await db.order.findFirst({ where: { number: commande, userId: user.id }, include: orderInclude }) : null);

  // Le statut affiché est celui enregistré par le serveur (webhook / relecture Stripe), jamais déduit de l'URL.
  const paymentLine = !order ? null
    : order.paymentStrategy === "PAY_AFTER_COMPLIANCE" && order.amountPaidCents === 0
      ? "Aucun paiement n'a été prélevé : vous serez invité à régler après validation de votre dossier."
      : order.amountPaidCents > 0
        ? `${formatPrice(order.amountPaidCents)} encaissés sur ${formatPrice(order.totalCents)}.`
        : order.amountAuthorizedCents > 0
          ? `${formatPrice(order.amountAuthorizedCents)} autorisés sur votre carte. Le montant ne sera prélevé qu'après validation de votre dossier ; en cas de refus, l'autorisation est annulée.`
          : "La confirmation du paiement peut prendre quelques secondes. Rafraîchissez la page ou consultez votre espace client.";

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <CheckCircle2 className="mx-auto h-14 w-14 text-success" aria-hidden />
      <h1 className="mt-4 font-display text-3xl font-semibold">Merci pour votre commande</h1>
      {order ? (
        <>
          <p className="mt-3 text-muted-foreground">Commande <strong>{order.number}</strong> — statut : {orderStatusLabel[order.status]}.</p>
          <p className="mt-2 text-sm text-muted-foreground">{paymentLine}</p>
          {order.requiredDocuments.length > 0 && (
            <Card className="mt-8 text-left">
              <h2 className="font-semibold">Prochaine étape : vos documents</h2>
              <p className="mt-2 text-sm text-muted-foreground">Pour que votre commande puisse être validée, déposez :</p>
              <ul className="mt-2 list-disc pl-5 text-sm">{order.requiredDocuments.map((d) => <li key={d}>{documentTypeLabel[d]}</li>)}</ul>
              <Button asChild className="mt-4"><Link href="/compte/documents">Déposer mes documents</Link></Button>
            </Card>
          )}
          {order.amountPaidCents > 0 && payment?.kind !== "BALANCE" && (
            <TrackOnMount name="purchase" params={{ transaction_id: order.number, currency: "EUR", value: order.totalCents / 100, shipping: order.shippingCents / 100, coupon: order.couponCode ?? undefined, items: order.items.map((i) => ({ item_id: i.productId, item_name: i.name, price: i.unitCents / 100, quantity: i.quantity })) }} />
          )}
        </>
      ) : (
        <p className="mt-3 text-muted-foreground">Votre commande est en cours d&apos;enregistrement. Retrouvez-la dans votre espace client.</p>
      )}
      <div className="mt-8 flex justify-center gap-3">
        <Button asChild variant="outline"><Link href={order ? `/compte/commandes/${order.number}` : "/compte/commandes"}>Suivre ma commande</Link></Button>
        <Button asChild><Link href="/catalogue">Continuer mes achats</Link></Button>
      </div>
    </div>
  );
}
