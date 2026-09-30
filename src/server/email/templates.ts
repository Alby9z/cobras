import "server-only";
import { formatPrice, siteUrl } from "@/lib/utils";
import { documentTypeLabel, orderStatusLabel } from "@/lib/labels";
import type { DocumentType, OrderStatus } from "@/generated/prisma/enums";

/** Contenu d'un e-mail (texte brut, échappé à la mise en page). */
export interface MailContent {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  table?: [string, string][];
  /** Message transactionnel ou commercial (lien de désinscription obligatoire pour ce dernier). */
  marketing?: boolean;
}

type Tpl<P> = { version: number; render: (p: P) => MailContent };
const t = <P,>(version: number, render: (p: P) => MailContent): Tpl<P> => ({ version, render });

/**
 * Modèles versionnés : incrémenter `version` à chaque modification de fond.
 * La version utilisée est enregistrée dans EmailLog.
 */
export const TEMPLATES = {
  ACCOUNT_CREATED: t(1, (p: { firstName: string }) => ({
    subject: "Votre compte est activé",
    heading: `Bonjour ${p.firstName}, votre compte est activé`,
    paragraphs: ["Votre adresse email est confirmée. Vous pouvez désormais passer commande, suivre vos commandes et déposer vos documents depuis votre espace client."],
    cta: { label: "Accéder à mon compte", url: siteUrl("/compte") },
  })),
  EMAIL_VERIFICATION: t(1, (p: { url: string }) => ({
    subject: "Confirmez votre adresse email",
    heading: "Confirmez votre adresse email",
    paragraphs: ["Pour activer votre compte, confirmez votre adresse email. Ce lien expire dans 24 heures.", "Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message."],
    cta: { label: "Confirmer mon email", url: p.url },
  })),
  PASSWORD_RESET: t(1, (p: { url: string }) => ({
    subject: "Réinitialisation de votre mot de passe",
    heading: "Réinitialisez votre mot de passe",
    paragraphs: ["Ce lien est valable 1 heure et ne peut être utilisé qu'une fois.", "Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé."],
    cta: { label: "Choisir un nouveau mot de passe", url: p.url },
  })),
  ORDER_CREATED: t(1, (p: { number: string; totalCents: number; strategyText: string }) => ({
    subject: `Commande ${p.number} enregistrée`,
    heading: "Votre commande est enregistrée",
    paragraphs: [p.strategyText, "Chaque commande d'animal fait l'objet d'une vérification réglementaire avant toute expédition."],
    table: [["Commande", p.number], ["Total TTC", formatPrice(p.totalCents)]],
    cta: { label: "Suivre ma commande", url: siteUrl(`/compte/commandes/${p.number}`) },
  })),
  PAYMENT_SUCCESS: t(1, (p: { number: string; amountCents: number; authorized: boolean }) => ({
    subject: p.authorized ? `Paiement autorisé — ${p.number}` : `Paiement reçu — ${p.number}`,
    heading: p.authorized ? "Paiement autorisé" : "Paiement confirmé",
    paragraphs: [p.authorized
      ? "Votre moyen de paiement a été autorisé. Le montant ne sera prélevé qu'après validation réglementaire de la commande ; en cas de refus, l'autorisation est annulée."
      : "Nous avons bien reçu votre paiement. Votre facture est disponible dans votre espace client."],
    table: [["Commande", p.number], ["Montant", formatPrice(p.amountCents)]],
    cta: { label: "Voir ma commande", url: siteUrl(`/compte/commandes/${p.number}`) },
  })),
  PAYMENT_FAILED: t(1, (p: { number: string }) => ({
    subject: `Paiement non abouti — ${p.number}`,
    heading: "Votre paiement n'a pas abouti",
    paragraphs: ["Aucun montant n'a été prélevé. Vous pouvez réessayer depuis votre espace client tant que la réservation est active."],
    cta: { label: "Réessayer le paiement", url: siteUrl(`/compte/commandes/${p.number}`) },
  })),
  INVOICE_AVAILABLE: t(1, (p: { number: string; invoiceNumber: string; amountCents: number }) => ({
    subject: `Facture ${p.invoiceNumber}`,
    heading: "Votre facture",
    paragraphs: [`Veuillez trouver ci-joint la facture ${p.invoiceNumber} relative à la commande ${p.number}.`],
    table: [["Montant TTC", formatPrice(p.amountCents)]],
    cta: { label: "Mes factures", url: siteUrl("/compte/factures") },
  })),
  DOCUMENT_REQUIRED: t(1, (p: { number: string; documents: DocumentType[]; message?: string }) => ({
    subject: `Documents à fournir — ${p.number}`,
    heading: "Des documents sont nécessaires",
    paragraphs: [`Pour poursuivre la commande ${p.number}, déposez les documents suivants : ${p.documents.map((d) => documentTypeLabel[d]).join(", ")}.`, ...(p.message ? [p.message] : [])],
    cta: { label: "Déposer mes documents", url: siteUrl("/compte/documents") },
  })),
  DOCUMENT_APPROVED: t(1, (p: { type: DocumentType }) => ({
    subject: `Document validé : ${documentTypeLabel[p.type]}`,
    heading: "Votre document est validé",
    paragraphs: [`Votre document « ${documentTypeLabel[p.type]} » a été contrôlé et validé.`],
    cta: { label: "Mes documents", url: siteUrl("/compte/documents") },
  })),
  DOCUMENT_REJECTED: t(1, (p: { type: DocumentType; note: string }) => ({
    subject: `Document refusé : ${documentTypeLabel[p.type]}`,
    heading: "Votre document n'a pas pu être validé",
    paragraphs: [`Motif : ${p.note}`, "Merci de déposer un nouveau document."],
    cta: { label: "Mes documents", url: siteUrl("/compte/documents") },
  })),
  COMPLIANCE_APPROVED: t(1, (p: { number: string; next: string }) => ({
    subject: `Commande ${p.number} validée`,
    heading: "Votre commande est validée",
    paragraphs: ["Les vérifications réglementaires sont terminées.", p.next],
    cta: { label: "Voir ma commande", url: siteUrl(`/compte/commandes/${p.number}`) },
  })),
  COMPLIANCE_REJECTED: t(1, (p: { number: string; reason: string; refundText: string }) => ({
    subject: `Commande ${p.number} non validée`,
    heading: "Votre commande ne peut pas être honorée",
    paragraphs: [`Motif : ${p.reason}`, p.refundText],
    cta: { label: "Voir ma commande", url: siteUrl(`/compte/commandes/${p.number}`) },
  })),
  BALANCE_DUE: t(1, (p: { number: string; amountCents: number; url: string; expiresText: string }) => ({
    subject: `Paiement à effectuer — ${p.number}`,
    heading: "Votre commande est validée : finalisez le paiement",
    paragraphs: ["Les contrôles réglementaires sont terminés. Réglez le montant restant pour déclencher la préparation.", p.expiresText],
    table: [["Montant", formatPrice(p.amountCents)]],
    cta: { label: "Payer", url: p.url },
  })),
  ORDER_PREPARING: t(1, (p: { number: string }) => ({
    subject: `Commande ${p.number} en préparation`,
    heading: "Votre commande est en préparation",
    paragraphs: ["Nous préparons votre commande. Vous recevrez un email à l'expédition."],
    cta: { label: "Voir ma commande", url: siteUrl(`/compte/commandes/${p.number}`) },
  })),
  ORDER_SHIPPED: t(1, (p: { number: string; carrier?: string | null; tracking?: string | null; trackingUrl?: string | null; pickup: boolean }) => ({
    subject: p.pickup ? `Commande ${p.number} prête à être retirée` : `Commande ${p.number} expédiée`,
    heading: p.pickup ? "Votre commande est prête" : "Votre commande est en route",
    paragraphs: [p.pickup ? "Votre commande vous attend. Présentez-vous avec une pièce d'identité." : "Votre commande a été remise au transporteur. Pensez à confirmer la réception depuis votre espace client."],
    table: p.pickup ? undefined : [["Transporteur", p.carrier ?? "—"], ["N° de suivi", p.tracking ?? "—"]],
    cta: p.trackingUrl ? { label: "Suivre le colis", url: p.trackingUrl } : { label: "Voir ma commande", url: siteUrl(`/compte/commandes/${p.number}`) },
  })),
  ORDER_DELIVERED: t(1, (p: { number: string }) => ({
    subject: `Commande ${p.number} livrée`,
    heading: "Réception confirmée",
    paragraphs: ["Merci pour votre confiance. Pour toute question sur la maintenance, notre équipe reste à votre disposition."],
    cta: { label: "Nous contacter", url: siteUrl("/contact") },
  })),
  REFUND_CREATED: t(1, (p: { number: string; amountCents: number; authorizationCanceled: boolean }) => ({
    subject: `Remboursement — commande ${p.number}`,
    heading: p.authorizationCanceled ? "Autorisation de paiement annulée" : "Remboursement effectué",
    paragraphs: [p.authorizationCanceled
      ? "L'autorisation de paiement a été annulée : aucun montant ne sera prélevé."
      : "Un remboursement a été émis sur votre moyen de paiement. Le délai d'apparition dépend de votre banque (généralement 5 à 10 jours ouvrés). Un avoir est disponible dans votre espace client."],
    table: [["Montant", formatPrice(p.amountCents)]],
  })),
  ORDER_STATUS: t(1, (p: { number: string; status: OrderStatus; message?: string }) => ({
    subject: `Commande ${p.number} : ${orderStatusLabel[p.status]}`,
    heading: orderStatusLabel[p.status],
    paragraphs: [`Le statut de votre commande ${p.number} a évolué.`, ...(p.message ? [p.message] : [])],
    cta: { label: "Voir ma commande", url: siteUrl(`/compte/commandes/${p.number}`) },
  })),
  ABANDONED_CART: t(1, (p: { firstName: string; items: string[]; unsubscribeUrl: string }) => ({
    subject: "Votre panier vous attend",
    heading: `${p.firstName}, votre panier est toujours là`,
    paragraphs: ["Les articles de votre panier ne sont pas réservés : chaque animal est un individu unique.", `Dans votre panier : ${p.items.join(", ")}.`],
    cta: { label: "Reprendre ma commande", url: siteUrl("/panier") },
    marketing: true,
  })),
  ADMIN_ALERT: t(1, (p: { subject: string; lines: string[]; path: string }) => ({
    subject: `[Admin] ${p.subject}`,
    heading: p.subject,
    paragraphs: p.lines,
    cta: { label: "Ouvrir l'administration", url: siteUrl(p.path) },
  })),
} as const;

export type TemplateName = keyof typeof TEMPLATES;
export type TemplateParams<N extends TemplateName> = Parameters<(typeof TEMPLATES)[N]["render"]>[0];
