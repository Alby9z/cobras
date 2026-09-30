"use client";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Lock } from "lucide-react";
import { beginCheckout, previewCheckout, type CheckoutPreview } from "@/server/actions/checkout";
import { Alert, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, Label, Textarea } from "@/components/ui/form";
import { formatPrice, cn } from "@/lib/utils";
import { documentTypeLabel, paymentStrategyLabel, shippingMethodLabel } from "@/lib/labels";
import { track } from "@/lib/analytics";
import type { ShippingMethod } from "@/generated/prisma/enums";

type Address = { id: string; label: string | null; firstName: string; lastName: string; line1: string; postalCode: string; city: string; country: string; isDefault: boolean };
type Rate = { id: string; name: string; method: ShippingMethod; priceCents: number; freeAboveCents: number | null; countries: string[] };

function PayButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={disabled || pending} aria-busy={pending}>
      <Lock className="h-4 w-4" aria-hidden /> {pending ? "Traitement…" : label}
    </Button>
  );
}

const STRATEGY_HELP: Record<string, string> = {
  PAY_IMMEDIATELY: "Le montant est prélevé à la validation du paiement.",
  AUTHORIZE_THEN_CAPTURE: "Votre carte est seulement autorisée : le montant n'est prélevé qu'après validation réglementaire. En cas de refus, l'autorisation est annulée.",
  DEPOSIT_THEN_BALANCE: "Un acompte est prélevé maintenant ; le solde vous sera demandé après validation réglementaire.",
  PAY_AFTER_COMPLIANCE: "Aucun paiement maintenant : la commande est d'abord vérifiée, puis vous recevrez un lien de paiement.",
};

export function CheckoutForm({ addresses, rates, allowedMethods, pickupAddress }: { addresses: Address[]; rates: Rate[]; allowedMethods: ShippingMethod[]; pickupAddress?: string }) {
  const [addressId, setAddressId] = useState(addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? "");
  const address = addresses.find((a) => a.id === addressId);
  const usable = rates.filter((r) => allowedMethods.includes(r.method) && (r.method === "PICKUP" || (address && r.countries.includes(address.country))));
  const [rateId, setRateId] = useState(usable[0]?.id ?? "");
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [loading, start] = useTransition();
  const [state, action] = useActionState(beginCheckout, null);
  // Clé d'idempotence stable pour cette page : un double clic ou un rechargement ne crée pas deux commandes.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (!usable.some((r) => r.id === rateId)) setRateId(usable[0]?.id ?? "");
  }, [addressId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!addressId || !rateId) { setPreview(null); return; }
    start(async () => setPreview(await previewCheckout(addressId, rateId)));
  }, [addressId, rateId]);

  useEffect(() => { track("begin_checkout", { currency: "EUR" }); }, []);

  const ok = preview && !("error" in preview) ? preview : null;
  const blocked = !ok || ok.eligibility.reasons.length > 0;
  const payLabel = ok ? (ok.dueNowCents > 0 ? `${ok.strategy === "AUTHORIZE_THEN_CAPTURE" ? "Autoriser" : "Payer"} ${formatPrice(ok.dueNowCents)}` : "Envoyer ma commande pour validation") : "Payer";

  return (
    <form action={action} onSubmit={() => track("payment_started", { value: ok ? ok.dueNowCents / 100 : undefined, currency: "EUR" })} className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="space-y-8">
        <fieldset>
          <legend className="mb-3 text-lg font-semibold">1. Adresse de livraison / de détention</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {addresses.map((a) => (
              <label key={a.id} className={cn("cursor-pointer rounded-xl border-2 bg-card p-4 text-sm focus-within:outline-2 focus-within:outline-ring", a.id === addressId ? "border-primary" : "border-border")}>
                <input type="radio" name="addressId" value={a.id} checked={a.id === addressId} onChange={() => setAddressId(a.id)} className="sr-only" />
                {a.label && <span className="block font-semibold">{a.label}</span>}
                <span className="block">{a.firstName} {a.lastName}</span>
                <span className="block text-muted-foreground">{a.line1}, {a.postalCode} {a.city} ({a.country})</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-lg font-semibold">2. Mode de livraison</legend>
          {usable.length === 0 ? (
            <Alert tone="warning">Aucun mode de livraison n&apos;est disponible pour ces articles et cette adresse.</Alert>
          ) : (
            <div className="space-y-3">
              {usable.map((r) => (
                <label key={r.id} className={cn("flex cursor-pointer items-center justify-between gap-4 rounded-xl border-2 bg-card p-4 text-sm focus-within:outline-2 focus-within:outline-ring", r.id === rateId ? "border-primary" : "border-border")}>
                  <span>
                    <input type="radio" name="shippingRateId" value={r.id} checked={r.id === rateId} onChange={() => setRateId(r.id)} className="sr-only" />
                    <span className="block font-semibold">{r.name}</span>
                    <span className="block text-muted-foreground">{shippingMethodLabel[r.method]}{r.method === "PICKUP" && pickupAddress ? ` — ${pickupAddress}` : ""}</span>
                    {r.freeAboveCents != null && <span className="block text-xs text-muted-foreground">Offert dès {formatPrice(r.freeAboveCents)}</span>}
                  </span>
                  <span className="font-semibold">{r.priceCents ? formatPrice(r.priceCents) : "Gratuit"}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div>
          <Label htmlFor="note">Informations pour notre équipe (facultatif)</Label>
          <Textarea id="note" name="note" maxLength={1000} rows={3} />
        </div>
      </div>

      <Card className="h-fit space-y-4 lg:sticky lg:top-24" aria-busy={loading} aria-live="polite">
        <h2 className="text-lg font-semibold">Récapitulatif</h2>
        {!preview && loading && <div className="space-y-2" aria-hidden>{[1, 2, 3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-muted" />)}</div>}
        {preview && "error" in preview && <Alert tone="danger">{preview.error}</Alert>}
        {ok && (
          <>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt>Sous-total TTC</dt><dd>{formatPrice(ok.totals.subtotalCents)}</dd></div>
              {ok.totals.discountCents > 0 && <div className="flex justify-between text-success"><dt>Remise {ok.totals.couponApplied}</dt><dd>−{formatPrice(ok.totals.discountCents)}</dd></div>}
              <div className="flex justify-between"><dt>Livraison</dt><dd>{ok.totals.shipping.totalCents ? formatPrice(ok.totals.shipping.totalCents) : "Gratuite"}</dd></div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-bold"><dt>Total TTC</dt><dd>{formatPrice(ok.totals.totalCents)}</dd></div>
              <div className="flex justify-between text-xs text-muted-foreground"><dt>dont TVA</dt><dd>{formatPrice(ok.totals.taxCents)}</dd></div>
            </dl>
            <Alert>
              <p className="font-semibold">{paymentStrategyLabel[ok.strategy]}</p>
              <p className="mt-1">{STRATEGY_HELP[ok.strategy]}</p>
              {ok.dueNowCents > 0 && ok.dueNowCents < ok.totals.totalCents && <p className="mt-1 font-semibold">Maintenant : {formatPrice(ok.dueNowCents)} — ensuite : {formatPrice(ok.totals.totalCents - ok.dueNowCents)}</p>}
            </Alert>
            {ok.eligibility.requiredDocuments.length > 0 && (
              <Alert tone={ok.eligibility.requiredDocuments.every((d) => d.status === "APPROVED") ? "success" : "warning"}>
                <p className="font-semibold">Documents exigés pour cette commande</p>
                <ul className="mt-1 space-y-0.5">{ok.eligibility.requiredDocuments.map((d) => <li key={d.type}>{documentTypeLabel[d.type]} — {d.status === "APPROVED" ? "déjà validé" : d.status === "PENDING_REVIEW" ? "en cours de validation" : d.status === "EXPIRED" ? "expiré, à renouveler" : "à fournir après la commande"}</li>)}</ul>
              </Alert>
            )}
            {ok.eligibility.reasons.length > 0 && (
              <Alert tone="danger"><p className="font-semibold">Commande impossible :</p><ul className="mt-1 list-disc pl-5">{ok.eligibility.reasons.map((b, i) => <li key={i}>{b.message}</li>)}</ul></Alert>
            )}
          </>
        )}
        <Checkbox name="terms" required label={<>J&apos;ai lu et j&apos;accepte les <a href="/cgv" target="_blank" className="underline">conditions générales de vente</a>.</>} />
        {state?.error && <Alert tone="danger">{state.error}</Alert>}
        <PayButton disabled={blocked || loading || !rateId} label={payLabel} />
        {ok && ok.dueNowCents > 0 && <p className="text-center text-xs text-muted-foreground">Paiement sécurisé sur la page Stripe (carte, Apple Pay, Google Pay).</p>}
      </Card>
    </form>
  );
}
