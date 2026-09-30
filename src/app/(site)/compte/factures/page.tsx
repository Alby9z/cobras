import { Card, PageHeader } from "@/components/ui/card";
import { requireUser } from "@/server/session";
import { invoicesForUser } from "@/server/invoices";
import { formatDate, formatPrice } from "@/lib/utils";
import { invoiceKindLabelFr } from "@/lib/labels";

export const metadata = { title: "Mes factures" };

export default async function InvoicesPage() {
  const user = await requireUser("/compte/factures");
  const invoices = await invoicesForUser(user.id);
  return (
    <>
      <PageHeader title="Mes factures" />
      {invoices.length === 0 ? <Card><p className="text-muted-foreground">Aucune facture.</p></Card> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="p-3">Numéro</th><th className="p-3">Type</th><th className="p-3">Commande</th><th className="p-3">Date</th><th className="p-3">Montant</th><th className="p-3"><span className="sr-only">PDF</span></th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="p-3 font-medium">{i.number}</td>
                  <td className="p-3">{invoiceKindLabelFr[i.kind]}</td>
                  <td className="p-3">{i.order.number}</td>
                  <td className="p-3">{formatDate(i.issuedAt, { dateStyle: "medium" })}</td>
                  <td className="p-3">{formatPrice(i.totalCents)}</td>
                  <td className="p-3">{i.pdfStatus === "READY" ? <a href={`/api/invoices/${i.id}`} className="text-primary underline">Télécharger (PDF)</a> : <span className="text-muted-foreground">PDF en préparation</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
