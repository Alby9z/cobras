import type {
  AnimalOrigin, AnimalStatus, ComplianceCaseStatus, ComplianceRuleType, DocumentStatus, DocumentType, OrderStatus, PaymentStrategy,
  ProductType, RegulatoryCategory, Role, RuleBasis, RuleStatus, Sex, ShippingMethod,
} from "@/generated/prisma/enums";

export const documentTypeLabel: Record<DocumentType, string> = {
  IDENTITY_DOCUMENT: "Pièce d'identité",
  ADDRESS_PROOF: "Justificatif de domicile",
  CERTIFICATE: "Certificat de capacité",
  AUTHORIZATION: "Autorisation préfectorale",
  DECLARATION: "Déclaration de détention",
  CITES_DOCUMENT: "Document CITES",
  REGULATORY_DOCUMENT: "Autre document réglementaire",
  OTHER: "Autre document",
};

export const regulatoryCategoryLabel: Record<RegulatoryCategory, string> = {
  SALE_ALLOWED: "Vente autorisée",
  SALE_ALLOWED_WITH_DOCUMENTS: "Vente autorisée sur justificatifs",
  DECLARATION_REQUIRED: "Déclaration obligatoire",
  CERTIFICATE_REQUIRED: "Certificat de capacité obligatoire",
  AUTHORIZATION_REQUIRED: "Autorisation obligatoire",
  RESTRICTED: "Vente restreinte (examen renforcé)",
  SALE_PROHIBITED: "Vente interdite",
};

export const ruleTypeLabel: Record<ComplianceRuleType, string> = {
  SALE_PROHIBITION: "Interdiction de vente",
  DOCUMENT_REQUIREMENT: "Documents exigés",
  AGE_REQUIREMENT: "Âge minimum",
  GEO_RESTRICTION: "Restriction géographique",
  SHIPPING_RESTRICTION: "Restriction d'expédition",
  HUMAN_REVIEW: "Examen humain renforcé",
};
export const ruleBasisLabel: Record<RuleBasis, string> = { LEGAL: "Obligation légale", COMMERCIAL_POLICY: "Politique commerciale" };
export const ruleStatusLabel: Record<RuleStatus, string> = { DRAFT: "Brouillon", ACTIVE: "Active", RETIRED: "Retirée" };

export const shippingMethodLabel: Record<ShippingMethod, string> = {
  PICKUP: "Retrait sur place",
  SPECIALIZED_CARRIER: "Transporteur spécialisé animaux vivants",
  STANDARD_PARCEL: "Colis standard",
};

export const orderStatusLabel: Record<OrderStatus, string> = {
  DRAFT: "Brouillon",
  PENDING_PAYMENT: "En attente de paiement",
  PAYMENT_AUTHORIZED: "Paiement reçu / autorisé",
  PAYMENT_FAILED: "Paiement échoué",
  COMPLIANCE_PENDING: "Contrôle de conformité",
  DOCUMENTS_REQUIRED: "Documents à fournir",
  DOCUMENTS_REVIEW: "Documents en vérification",
  COMPLIANCE_APPROVED: "Conformité approuvée",
  COMPLIANCE_REJECTED: "Conformité refusée",
  AWAITING_BALANCE: "Paiement du solde attendu",
  READY_FOR_FULFILLMENT: "Prête à préparer",
  PREPARING: "En préparation",
  SHIPPED: "Expédiée",
  DELIVERED: "Livrée",
  DELIVERY_FAILED: "Échec de livraison",
  CANCELLED: "Annulée",
  REFUND_PENDING: "Remboursement en cours",
  REFUNDED: "Remboursée",
};

export const caseStatusLabel: Record<ComplianceCaseStatus, string> = {
  OPEN: "Ouvert", AWAITING_DOCUMENTS: "Documents attendus", IN_REVIEW: "À examiner", APPROVED: "Approuvé", REJECTED: "Refusé",
};

export const documentStatusLabel: Record<DocumentStatus, string> = {
  PENDING_SCAN: "Analyse antivirus en cours",
  PENDING_REVIEW: "En attente de validation",
  APPROVED: "Validé",
  REJECTED: "Refusé",
  INFECTED: "Rejeté (menace détectée)",
  SCAN_FAILED: "Analyse impossible — renvoyez le fichier",
};

export const sexLabel: Record<Sex, string> = { MALE: "Mâle", FEMALE: "Femelle", UNKNOWN: "Non sexé" };
export const productTypeLabel: Record<ProductType, string> = { ANIMAL: "Animal", ACCESSORY: "Accessoire", EQUIPMENT: "Équipement" };
export const animalStatusLabel: Record<AnimalStatus, string> = {
  AVAILABLE: "Disponible", RESERVED: "Réservé", ALLOCATED: "Attribué (payé)", PREPARING: "En préparation", SHIPPED: "Expédié",
  SOLD: "Vendu", RETURNED: "Retourné", QUARANTINED: "Quarantaine", UNAVAILABLE: "Indisponible",
};
export const animalOriginLabel: Record<AnimalOrigin, string> = {
  CAPTIVE_BRED: "Né en captivité", CAPTIVE_BRED_OWN: "Né dans notre élevage", RANCHED: "Ranching", WILD_CAUGHT: "Prélevé dans la nature", UNKNOWN: "Non renseignée",
};
export const paymentStrategyLabel: Record<PaymentStrategy, string> = {
  PAY_IMMEDIATELY: "Paiement immédiat",
  AUTHORIZE_THEN_CAPTURE: "Autorisation puis encaissement après validation",
  DEPOSIT_THEN_BALANCE: "Acompte puis solde après validation",
  PAY_AFTER_COMPLIANCE: "Paiement après validation",
};
export const roleLabel: Record<Role, string> = {
  SUPER_ADMIN: "Super-administrateur", ADMIN: "Administrateur", COMPLIANCE_MANAGER: "Responsable conformité", SALES_MANAGER: "Responsable commercial",
  SALES_AGENT: "Commercial", FULFILLMENT_MANAGER: "Responsable logistique", WAREHOUSE_OPERATOR: "Préparateur", CONTENT_MANAGER: "Responsable contenus",
  SUPPORT_AGENT: "Support client", ACCOUNTANT: "Comptabilité", VIEWER: "Lecture seule", CUSTOMER: "Client",
};

export const reasonLabel: Record<string, string> = {
  EMAIL_NOT_VERIFIED: "Email non vérifié",
  SPECIES_PROHIBITED: "Espèce interdite",
  PRODUCT_PROHIBITED: "Produit interdit",
  RULES_NOT_CONFIGURED: "Règles non configurées",
  ANIMAL_WITHOUT_SPECIES: "Animal sans espèce",
  ANIMAL_NOT_AVAILABLE: "Animal indisponible",
  AGE_REQUIREMENT_NOT_MET: "Âge insuffisant",
  DESTINATION_NOT_ALLOWED: "Destination interdite",
  DESTINATION_UNRESOLVED: "Destination non reconnue",
  SHIPPING_METHOD_NOT_ALLOWED: "Mode de livraison interdit",
  NO_COMMON_SHIPPING_METHOD: "Aucun mode de livraison commun",
  SHIP_DAY_NOT_ALLOWED: "Jour d'expédition interdit",
  MISSING_REQUIRED_DOCUMENT: "Document manquant",
  DOCUMENT_EXPIRED: "Document expiré",
  DOCUMENT_REJECTED: "Document refusé",
  DOCUMENT_PENDING_REVIEW: "Document en attente de validation",
};

export const invoiceKindLabelFr: Record<"INVOICE" | "DEPOSIT_INVOICE" | "BALANCE_INVOICE" | "CREDIT_NOTE", string> = {
  INVOICE: "Facture", DEPOSIT_INVOICE: "Facture d'acompte", BALANCE_INVOICE: "Facture de solde", CREDIT_NOTE: "Avoir",
};
