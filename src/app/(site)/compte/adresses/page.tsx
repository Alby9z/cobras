import { Card, PageHeader, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AddressForm } from "@/components/address-form";
import { requireUser } from "@/server/session";
import { withUserScope } from "@/server/db";
import { deleteAddress } from "@/server/actions/account";

export const metadata = { title: "Mes adresses" };

export default async function AddressesPage() {
  const user = await requireUser("/compte/adresses");
  const addresses = await withUserScope(user.id, (tx) => tx.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }));
  return (
    <>
      <PageHeader title="Mes adresses" />
      <div className="space-y-4">
        {addresses.map((a) => (
          <details key={a.id} className="rounded-xl border border-border bg-card p-5">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3">
              <span className="font-semibold">{a.label || `${a.firstName} ${a.lastName}`}</span>
              <span className="text-sm text-muted-foreground">{a.line1}, {a.postalCode} {a.city}</span>
              {a.isDefault && <Badge>Par défaut</Badge>}
            </summary>
            <div className="mt-5"><AddressForm address={a} /></div>
            <form action={deleteAddress} className="mt-3"><input type="hidden" name="id" value={a.id} /><Button type="submit" variant="ghost" size="sm" className="text-danger">Supprimer cette adresse</Button></form>
          </details>
        ))}
        <Card><h2 className="mb-4 font-semibold">Nouvelle adresse</h2><AddressForm defaults={{ firstName: user.firstName, lastName: user.lastName, phone: user.phone }} /></Card>
      </div>
    </>
  );
}
