import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Alert, Card, PageHeader } from "@/components/ui/card";
import { AddressForm } from "@/components/address-form";
import { CheckoutForm } from "@/components/checkout-form";
import { ResendVerification } from "@/components/auth/resend-verification";
import { requireUser } from "@/server/session";
import { getCart } from "@/server/cart";
import { db } from "@/server/db";
import { toItemInput } from "@/server/compliance";
import { logisticMethods } from "@/lib/domain/eligibility";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Commande", robots: { index: false } };

export default async function CheckoutPage() {
  const user = await requireUser("/commande");
  const cart = await getCart();
  if (!cart || cart.items.length === 0) redirect("/panier");

  if (!user.emailVerified) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <PageHeader title="Vérifiez votre adresse email" />
        <Alert tone="warning">Pour des raisons réglementaires, votre adresse email doit être vérifiée avant de commander. Consultez le message que nous vous avons envoyé.</Alert>
        <div className="mt-6"><ResendVerification email={user.email} /></div>
      </div>
    );
  }

  const [addresses, rates, s] = await Promise.all([
    db.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }),
    db.shippingRate.findMany({ where: { active: true }, orderBy: [{ position: "asc" }, { priceCents: "asc" }] }),
    getSettings(),
  ]);
  const allowed = logisticMethods(cart.items.map((i) => toItemInput(i.product)));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ label: "Panier", href: "/panier" }, { label: "Commande" }]} />
      <PageHeader title="Finaliser la commande" />
      {addresses.length === 0 ? (
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Ajoutez votre adresse</h2>
          <p className="mb-4 text-sm text-muted-foreground">Pour un animal vivant, indiquez l&apos;adresse de détention : les restrictions géographiques s&apos;appliquent à cette adresse, y compris en cas de retrait sur place.</p>
          <AddressForm defaults={{ firstName: user.firstName, lastName: user.lastName, phone: user.phone }} />
        </Card>
      ) : (
        <>
          <CheckoutForm
            addresses={addresses}
            rates={rates}
            allowedMethods={allowed}
            pickupAddress={[s.addressLine, s.postalCode, s.city].filter(Boolean).join(" ") || undefined}
          />
          <p className="mt-6 text-sm"><Link href="/compte/adresses" className="text-primary underline">Ajouter ou modifier une adresse</Link></p>
        </>
      )}
    </div>
  );
}
