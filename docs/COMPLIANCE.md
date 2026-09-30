# Conformité réglementaire

## Principe

La plateforme **ne contient aucune règle juridique codée en dur**. Toutes les exigences (documents,
âge, zones interdites, modes de livraison, examen humain, interdiction de vente) sont des
`ComplianceRule` saisies dans l'administration, **sourcées et validées** par une personne habilitée.

Sans règle validée applicable à une espèce (directement ou via sa catégorie réglementaire), la vente
de cette espèce est **bloquée** (`RULES_NOT_CONFIGURED`) : mieux vaut refuser une vente que l'autoriser
sur une hypothèse.

> L'équipe doit faire valider le contenu des règles par un juriste ou l'autorité compétente (DDPP,
> préfecture). Le logiciel garantit la traçabilité et l'application ; il ne garantit pas l'exactitude
> juridique de ce qui y est saisi.

## Cycle de vie d'une règle

```
DRAFT ──(validation : compliance.rules.approve + note ≥ 10 car.)──> ACTIVE ──(retrait motivé)──> RETIRED
  ▲                                                                   │
  └──────────────────── « nouvelle version » (brouillon v+1) ─────────┘
```

- Une règle validée est **immuable** (déclencheur base). Toute modification passe par une nouvelle version ;
  à sa validation, la version précédente de même code est retirée automatiquement.
- Une seule version active par code (index unique partiel).
- Fondement : `LEGAL` (référence juridique **obligatoire** — contrainte base + validation) ou
  `COMMERCIAL_POLICY` (présentée comme une politique de la boutique, jamais comme une obligation légale).
- Chaque règle porte : juridiction, périmètre (espèce, catégorie réglementaire, types de produits),
  paramètres, message client, source officielle (URL), dates d'effet et de fin, auteur, validateur.

## Types de règles

| Type | Paramètres | Effet |
|---|---|---|
| `SALE_PROHIBITION` | zones (facultatif) | vente interdite (partout ou dans les zones) |
| `DOCUMENT_REQUIREMENT` | documents exigés, zones (facultatif) | documents à fournir et **valider** avant toute préparation |
| `AGE_REQUIREMENT` | âge minimum | âge calculé à la date d'évaluation depuis la date de naissance du compte |
| `GEO_RESTRICTION` | `DENY` ou `ALLOW_ONLY` + zones | refus selon pays / région / département / préfixe postal de l'adresse de livraison |
| `SHIPPING_RESTRICTION` | modes autorisés, jours d'expédition | limite les transporteurs et les jours d'expédition |
| `HUMAN_REVIEW` | — | examen humain obligatoire avant toute suite |

Zones : `FR` (pays), `FR/84` (région INSEE), `FR//69` (département), `FR///20` (préfixe postal).

## Moteur d'éligibilité

`evaluatePurchaseEligibility()` (`src/lib/domain/eligibility.ts`) est une fonction **pure et déterministe** :

- entrées : client (date de naissance, e-mail vérifié), destination résolue, mode de livraison, articles
  (type, espèce, catégorie), documents du client (statut, date d'expiration), règles actives, date ;
- sorties : `allowed`, motifs bloquants avec code et règle source, contrôles effectués, documents requis
  et manquants, modes de livraison autorisés, examen humain requis, `ruleSetVersion`.

`ruleSetVersion` (`RS-<nombre>-<empreinte>`) identifie exactement l'ensemble des versions de règles
appliquées : une décision reste explicable même après modification des règles.

Stades d'évaluation et effets :

| Stade | Moment | Effet si bloqué |
|---|---|---|
| CHECKOUT | création de commande | commande refusée, rien n'est réservé |
| PAYMENT | paiement reçu / autorisé | commande mise en examen / refusée |
| REVIEW | dépôt ou validation de document | met à jour les documents manquants |
| DECISION | décision humaine | approbation impossible sans dérogation |
| FULFILLMENT | avant expédition | expédition impossible |

Chaque évaluation est enregistrée dans `compliance_evaluation` (ajout seul).

## Dossier de conformité et décision

- Un `ComplianceCase` est ouvert à la première évaluation enregistrée de la commande ; il conserve la dernière évaluation et la version du jeu de règles.
- Documents : dépôt client → antivirus → `PENDING_REVIEW` → validation / refus motivé par
  `documents.review`. Un document expiré ou refusé ne satisfait pas l'exigence.
- **Approbation** : `compliance.review`, réévaluation au stade DECISION ; si un blocage subsiste,
  seule une **dérogation** (`compliance.override`, justification obligatoire, journalisée) permet de
  passer outre — testé.
- **Refus** : motif obligatoire ; annulation de l'autorisation de paiement ou remboursement, libération
  de l'animal, e-mail au client — testé.

## Stratégies de paiement

| Stratégie | Encaissement | Usage |
|---|---|---|
| `PAY_AFTER_COMPLIANCE` | rien à la commande ; lien de paiement après validation | le plus prudent |
| `AUTHORIZE_THEN_CAPTURE` | autorisation carte, capture après validation, annulation si refus | limité par la durée de validité d'une autorisation (≈ 7 jours, surveillée par le worker) |
| `DEPOSIT_THEN_BALANCE` | acompte, solde après validation | acompte non remboursable = **à faire valider juridiquement** |
| `PAY_IMMEDIATELY` | paiement complet | accessoires / cas sans risque |

Stratégie par défaut des animaux dans les Paramètres, surchargeable par produit ; dans un panier mixte,
la stratégie **la plus prudente** l'emporte.

## Données de référence à fournir par l'exploitant

Rien de ce qui suit n'est pré-rempli : identité légale (raison sociale, forme, SIRET, RCS, capital, TVA),
certificat de capacité / autorisation d'ouverture d'établissement le cas échéant, taux de TVA applicables,
catégories réglementaires des espèces, règles et leurs références, pages légales (CGV, mentions,
confidentialité). La page **Santé système** liste ce qui manque ; la vente reste bloquée tant qu'un élément
bloquant manque.
