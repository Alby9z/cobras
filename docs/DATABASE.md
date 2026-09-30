# Base de données

PostgreSQL 16, schéma dans `prisma/schema.prisma`, migrations SQL dans `prisma/migrations/`.

## Conventions

- Montants en **centimes** (`Int`), taux en **points de base** (`2000` = 20 %), devise `EUR`.
- Dates en **UTC** (`timestamptz` via Prisma) ; affichage en Europe/Paris.
- Énumérations centralisées ; libellés français dans `src/lib/labels.ts`.
- Snapshots : une commande copie adresses, prix, taux de TVA et remises ; une facture copie l'identité du
  vendeur, du client, les lignes et la ventilation de TVA. Modifier un produit ou un paramètre ne change
  jamais un document émis.
- Verrou optimiste : champ `version` sur `order` et `product`.

## Domaines

| Domaine | Tables principales |
|---|---|
| Identité | `user`, `session`, `account`, `verification`, `twoFactor`, `rateLimit` (Better Auth), `app_rate_limit`, `address`, `wishlist_item` |
| Catalogue | `product`, `product_image`, `product_relation`, `category`, `species`, `tax_rate` |
| Animal | `animal` (1–1 avec un produit de type ANIMAL), `animal_event` (historique) |
| Inventaire | `stock_reservation`, `inventory_movement` (ajout seul) |
| Commande | `cart`, `cart_item`, `order`, `order_item`, `order_event`, `coupon`, `shipping_rate` |
| Paiement | `payment`, `refund`, `stripe_event` |
| Facturation | `invoice` (immuable), `counter` (numérotation continue) |
| Conformité | `compliance_rule` (versionnée), `compliance_case`, `compliance_evaluation` (ajout seul), `document`, `order_document` |
| Communication | `email_log`, `notification` |
| Contenu | `page`, `faq`, `testimonial`, `setting`, `contact_request` |
| Traçabilité | `audit_log` (ajout seul) |

## Invariants garantis par la base

| Invariant | Mécanisme |
|---|---|
| Un animal n'a qu'une réservation vivante | index unique partiel `stock_reservation_one_live_per_animal` |
| Pas de survente | `CHECK (stockReserved <= stockOnHand)`, mises à jour conditionnelles |
| Une version active par code de règle | index unique partiel `compliance_rule_one_active_version` |
| Règle légale ⇒ référence ; règle active ⇒ validation | contraintes CHECK |
| Montants cohérents, remboursé ≤ payé ≤ total | contraintes CHECK sur `order` |
| Une commande par clé d'idempotence et par client | unique `(userId, idempotencyKey)` |
| Une facture par paiement et par type ; un avoir par remboursement | uniques |
| Journal d'audit, mouvements de stock, évaluations : ajout seul | déclencheurs `forbid_mutation` (UPDATE, DELETE, TRUNCATE) |
| Facture immuable (sauf état du PDF) | déclencheur `invoice_immutable` |
| Règle validée immuable | déclencheur `rule_immutable` |
| Isolation des données client | Row Level Security (voir SECURITY.md) |

`audit_log.actorId` et `inventory_movement.actorId` n'ont volontairement **pas** de clé étrangère : la
suppression d'un compte ne doit ni modifier ni bloquer un journal en ajout seul.

## Migrations

- `20260924090000_init` : schéma complet (généré par Prisma).
- `20260924090100_integrity_security` : contraintes, index partiels, déclencheurs, RLS, recherche
  (`unaccent`, `pg_trgm`, index trigrammes).

Les migrations de la phase 1 ont été **remplacées par une nouvelle base de référence** (hypothèse : la
phase 1 n'a pas été mise en production avec des données réelles). Si c'est le cas, ne pas appliquer ces
migrations telles quelles : un script de reprise de données est nécessaire.

Appliquer : `npm run db:migrate` (image `migrate` en production, rôle propriétaire).
Le CI vérifie que le schéma Prisma et les migrations concordent.

## Rôles

Voir `deploy/postgres-init/10-app-role.sh` : rôle propriétaire (migrations, sauvegardes) et rôle
d'exécution DML. Sur une base existante créée avant ce script, exécuter une fois son contenu SQL à la main
(`docker compose exec db psql -U $POSTGRES_USER $POSTGRES_DB`), puis renseigner `APP_DB_USER` /
`APP_DB_PASSWORD`.

## Données personnelles et conservation

Les durées de conservation (documents d'identité, comptes inactifs, journaux) ne sont **pas encore
automatisées** ; elles doivent être définies avec le DPO / juriste (factures : obligation comptable ;
documents d'identité : durée minimale nécessaire). Prévu dans la phase RGPD.
