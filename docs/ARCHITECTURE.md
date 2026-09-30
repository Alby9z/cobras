# Architecture

## Vue d'ensemble

```
Navigateur ──HTTPS──> Caddy ──> app (Next.js 15, rendu serveur + Server Actions + routes API)
                                   │            │
                                   │            └──> Redis (file BullMQ) <── worker (Node, BullMQ)
                                   │                                          │
                                   └──────────> PostgreSQL 16 <───────────────┘
                                                     ▲
Stripe ──webhook──> /api/stripe/webhook ─────────────┘
Services externes : Stripe (paiement), Resend (e-mail), S3/R2 (fichiers), ClamAV (antivirus)
```

Un seul dépôt, deux processus déployés :

| Processus | Rôle | Point d'entrée |
|---|---|---|
| `app` | pages publiques, espace client, administration, API, webhook Stripe | `next start` / `server.js` (standalone) |
| `worker` | e-mails, PDF de factures, analyse antivirus, expiration des réservations, contrôle des autorisations de paiement, relances de panier, alertes métier, reprise des travaux perdus | `src/worker/index.ts` → `dist/worker.mjs` |

Le worker réutilise **les mêmes services métier** que l'application (`src/server/*`) : il n'existe pas
de seconde implémentation des règles.

## Couches

| Couche | Emplacement | Contenu | Dépendances autorisées |
|---|---|---|---|
| Domaine pur | `src/lib/domain/` | machine à états des commandes, moteur d'éligibilité, calcul des prix/TVA, stratégie de paiement, permissions, erreurs normalisées | aucune (ni base, ni réseau) → testé unitairement |
| Services | `src/server/*.ts` | commandes, inventaire, conformité, factures, documents, paiements Stripe, e-mails, audit, préparation à la vente | domaine, Prisma, fournisseurs |
| Fournisseurs | `src/server/stripe.ts`, `storage.ts`, `email/provider.ts`, `antivirus.ts`, `queue.ts`, `search.ts` | abstractions remplaçables (doubles de test injectables : `setStripeClient`, `setStorageProvider`, `setQueueDriver`) | SDK externes |
| Entrées | `src/server/actions/*` (Server Actions), `src/app/api/*` (routes), `src/worker` | validation (Zod), authentification, permission, appel d'un service, réponse normalisée | services |
| Interface | `src/app`, `src/components` | React Server Components, formulaires | entrées |

Règle : **aucune logique métier dans les composants ni dans les actions** ; une action valide, vérifie la
permission et appelle un service.

## Flux transactionnels

### Commande (checkout)

1. `beginCheckout` (Server Action) : permission client, limite de débit, clé d'idempotence (UUID généré par le formulaire).
2. `orders.checkout()` dans **une transaction** :
   - `assertSalesReady()` : refus si l'identité légale, la TVA, les pages légales ou la stratégie de paiement manquent ;
   - moteur d'éligibilité (stade CHECKOUT) avec les règles actives ; blocage si une règle l'interdit ;
   - calcul des totaux (centimes, TVA par ligne, arrondis déterministes) ;
   - création de la commande (numéro séquentiel), snapshot des adresses, des lignes et des taux ;
   - réservation atomique du stock (`UPDATE … WHERE disponible`) et, pour un animal, passage `AVAILABLE → RESERVED`
     (index unique partiel : un animal n'a qu'une réservation vivante) ;
   - enregistrement de l'évaluation de conformité (version du jeu de règles, codes de motif) ;
   - journal d'audit.
3. Selon la stratégie de paiement : session Stripe Checkout (paiement, autorisation, acompte) ou aucune
   (paiement après validation). Si Stripe échoue, la commande est annulée et le stock libéré.

### Paiement

Le webhook n'est jamais cru sur parole : chaque événement est enregistré (`stripe_event`, clé unique = id
Stripe), réclamé (`PROCESSING`), puis le PaymentIntent est **relu chez Stripe** (`applyPaymentIntent`) avant
toute écriture. Les montants sont comparés à la commande. Un événement déjà traité est ignoré ; un événement
en échec est rejouable depuis l'administration.

### Conformité

`ComplianceRule` versionnées (brouillon → validée → retirée). Le moteur (`evaluatePurchaseEligibility`)
retourne `allowed`, les motifs bloquants, les documents requis, les modes de livraison autorisés et
`ruleSetVersion`. Il est appelé aux stades CHECKOUT, PAYMENT, REVIEW, DECISION et FULFILLMENT ; chaque
évaluation est stockée (immuable). Voir [COMPLIANCE.md](COMPLIANCE.md).

### Machine à états

`src/lib/domain/order-state.ts` décrit chaque transition autorisée, l'acteur (SYSTEM / CUSTOMER / STAFF) et
la permission requise, plus des invariants (pas de préparation sans paiement complet ni validation de
conformité, pas d'expédition sans suivi sauf retrait, etc.). `orders.transition()` applique la transition
avec un **verrou optimiste** (`version`) : deux décisions concurrentes ne peuvent pas s'écraser.

### Travaux asynchrones

`enqueue(name, data, opts)` publie dans BullMQ après commit (les e-mails sont d'abord écrits dans
`email_log` avec une clé de déduplication, puis envoyés). Échecs : relances exponentielles, puis état
final visible dans l'administration ; le balayage périodique (`alerts.business`) remet en file les
travaux restés en attente (perte de Redis, redémarrage).

## Arborescence

```
prisma/                schéma + migrations SQL (contraintes, déclencheurs, RLS)
src/lib/domain/        règles métier pures (testées unitairement)
src/server/            services, fournisseurs, actions
src/worker/            processus worker
src/app/(site)/        site public et espace client
src/app/admin/         administration (navigation filtrée par permission)
src/app/api/           webhook Stripe, téléchargements signés, exports CSV, santé
tests/                 unitaires, intégration (PostgreSQL réel), parcours navigateur
deploy/                Caddy, init PostgreSQL, sauvegarde/restauration
docs/                  cette documentation + décisions d'architecture (adr/)
```
