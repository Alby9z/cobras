"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Checkbox, Input, Label, Textarea } from "@/components/ui/form";
import {
  approveAction, cancelAction, fulfilAction, noteAction, refundAction, rejectAction, replayStripeEvent, requestDocumentsAction, reviewDocumentAction,
} from "@/server/actions/admin/orders";

export function ApproveForm({ orderId, blocked, canOverride }: { orderId: string; blocked: boolean; canOverride: boolean }) {
  return (
    <ActionForm action={approveAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <Label htmlFor="justification">Justification de la décision *</Label>
      <Textarea id="justification" name="justification" rows={3} required minLength={10} placeholder="Ex. identité et certificat vérifiés, adresse de détention conforme." />
      {blocked && canOverride && <Checkbox name="override" label="Déroger aux contrôles non satisfaits (justification détaillée obligatoire, décision tracée et signalée)" />}
      {blocked && !canOverride && <p className="text-sm text-danger">Des contrôles ne sont pas satisfaits : l&apos;approbation est impossible sans dérogation d&apos;un responsable conformité.</p>}
      <SubmitButton>Approuver</SubmitButton>
    </ActionForm>
  );
}

export function RejectForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={rejectAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <Label htmlFor="reason">Motif du refus (communiqué au client) *</Label>
      <Textarea id="reason" name="reason" rows={2} required minLength={10} />
      <SubmitButton variant="danger">Refuser et rembourser / annuler l&apos;autorisation</SubmitButton>
    </ActionForm>
  );
}

export function RequestDocsForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={requestDocumentsAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <Label htmlFor="message">Message au client *</Label>
      <Textarea id="message" name="message" rows={2} required placeholder="Ex. la copie du certificat est illisible, merci d'en déposer une nouvelle." />
      <SubmitButton variant="outline">Demander des documents</SubmitButton>
    </ActionForm>
  );
}

export function FulfilForm({ orderId, step, pickup, canOverride }: { orderId: string; step: "PREPARING" | "SHIPPED" | "DELIVERED" | "DELIVERY_FAILED"; pickup?: boolean; canOverride?: boolean }) {
  const labels = { PREPARING: "Passer en préparation", SHIPPED: pickup ? "Remis au client (retrait)" : "Marquer comme expédiée", DELIVERED: "Confirmer la livraison", DELIVERY_FAILED: "Signaler un échec de livraison" };
  return (
    <ActionForm action={fulfilAction} className="space-y-3 rounded-lg border border-border p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="step" value={step} />
      {step === "SHIPPED" && !pickup && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label htmlFor="carrier">Transporteur *</Label><Input id="carrier" name="carrier" required /></div>
          <div><Label htmlFor="tracking">N° de suivi *</Label><Input id="tracking" name="tracking" required /></div>
          <div><Label htmlFor="trackingUrl">URL de suivi</Label><Input id="trackingUrl" name="trackingUrl" type="url" /></div>
        </div>
      )}
      {step === "SHIPPED" && canOverride && <div><Label htmlFor="override">Dérogation (si le contrôle d&apos;expédition bloque)</Label><Input id="override" name="override" placeholder="Justification — laissez vide en temps normal" /></div>}
      {step === "DELIVERY_FAILED" && <div><Label htmlFor="note">Détail *</Label><Input id="note" name="note" required /></div>}
      <SubmitButton size="sm" variant={step === "DELIVERY_FAILED" ? "outline" : "default"}>{labels[step]}</SubmitButton>
    </ActionForm>
  );
}

export function RefundForm({ orderId, max, canFull }: { orderId: string; max: number; canFull: boolean }) {
  return (
    <ActionForm action={refundAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <div><Label htmlFor="amount">Montant (€, max {(max / 100).toFixed(2)})</Label><Input id="amount" name="amount" type="number" step="0.01" min="0.01" max={(max / 100).toFixed(2)} required /></div>
      <div><Label htmlFor="refund-reason">Motif *</Label><Input id="refund-reason" name="reason" required /></div>
      {canFull && <Checkbox name="full" label="Annulation complète : rembourser la totalité et remettre le stock en vente" />}
      <SubmitButton variant="danger" size="sm">Rembourser</SubmitButton>
    </ActionForm>
  );
}

export function CancelForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={cancelAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <div><Label htmlFor="cancel-reason">Motif d&apos;annulation *</Label><Input id="cancel-reason" name="reason" required /></div>
      <SubmitButton variant="outline" size="sm">Annuler la commande</SubmitButton>
    </ActionForm>
  );
}

export function NoteForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={noteAction} resetOnSuccess className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      <Label htmlFor="note-msg">Note / message</Label>
      <Textarea id="note-msg" name="message" rows={3} required />
      <Checkbox name="visible" label="Publier dans l'espace client (sinon note interne)" />
      <SubmitButton size="sm" variant="outline">Ajouter</SubmitButton>
    </ActionForm>
  );
}

export function DocumentReviewForm({ documentId }: { documentId: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ActionForm action={reviewDocumentAction} className="space-y-2">
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="decision" value="APPROVED" />
        <Label htmlFor={`exp-${documentId}`}>Date d&apos;expiration du document (si applicable)</Label>
        <Input id={`exp-${documentId}`} name="expiresAt" type="date" />
        <SubmitButton size="sm">Valider</SubmitButton>
      </ActionForm>
      <ActionForm action={reviewDocumentAction} className="space-y-2">
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="decision" value="REJECTED" />
        <Label htmlFor={`note-${documentId}`}>Motif du refus *</Label>
        <Input id={`note-${documentId}`} name="note" required />
        <SubmitButton size="sm" variant="danger">Refuser</SubmitButton>
      </ActionForm>
    </div>
  );
}

export function ReplayForm({ eventId }: { eventId: string }) {
  return (
    <ActionForm action={replayStripeEvent}>
      <input type="hidden" name="eventId" value={eventId} />
      <SubmitButton size="sm" variant="outline">Rejouer</SubmitButton>
    </ActionForm>
  );
}
