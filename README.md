# Plateforme e-commerce reptiles

Boutique en ligne de reptiles, accessoires et équipements, avec contrôle réglementaire paramétrable,
examen humain des commandes d'animaux, inventaire atomique et facturation immuable.

État : **phase 2 — socle transactionnel**. Voir [Limites connues](#limites-connues).

## Stack

| Couche | Choix |
|---|---|
| Application | Next.js 15 (App Router, Server Actions), React 19, TypeScript strict |
| Traitements asynchrones | worker Node + BullMQ sur Redis 7 |
| Données | PostgreSQL 16, Prisma 7 (adaptateur `pg`), contraintes, déclencheurs, Row Level Security |
| Auth | Better Auth : Argon2id, vérification e-mail, 2FA TOTP (obligatoire pour le personnel) |
| Paiement | Stripe Checkout (paiement, autorisation/capture, acompte), webhooks idempotents |
| E-mails | Resend (gabarits versionnés, journal d'envoi) |
| Fichiers | S3 / Cloudflare R2 (bucket privé + public), ClamAV |
| Infra | Docker Compose (app, worker, PostgreSQL, Redis, ClamAV, Caddy, sauvegarde), GitHub Actions |

## Documentation

| Sujet | Document |
|---|---|
| Architecture, couches, flux | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Conformité : règles, moteur, décisions | [docs/COMPLIANCE.md](docs/COMPLIANCE.md) |
| Sécurité | [docs/SECURITY.md](docs/SECURITY.md) |
| Base de données, invariants, migrations | [docs/DATABASE.md](docs/DATABASE.md) |
| Routes HTTP et format d'erreur | [docs/API.md](docs/API.md) |
| Variables d'environnement | [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) |
| Tests | [docs/TESTING.md](docs/TESTING.md) |
| Sauvegardes / reprise après incident | [docs/BACKUPS.md](docs/BACKUPS.md), [docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md) |
| Décisions d'architecture | [docs/adr/](docs/adr/README.md) |
| Mise en production | [DEPLOYMENT.md](DEPLOYMENT.md) |

## Cycle d'une commande d'animal

1. Panier → **contrôle d'éligibilité** affiché avant validation (règles actives, âge, e-mail vérifié, destination, mode de livraison).
2. Commande créée dans une transaction : totaux et TVA calculés côté serveur, animal **réservé** (jamais deux fois).
3. Selon la stratégie : aucun paiement / autorisation carte / acompte / paiement complet.
4. Dépôt des documents exigés → antivirus → validation par la conformité.
5. **Décision humaine** tracée (approbation, refus motivé, dérogation réservée et justifiée).
6. Capture ou lien de paiement du solde → facture → préparation → expédition (suivi) → livraison.

Refus ou expiration : autorisation annulée ou remboursement, animal remis en vente, client informé.

## Rôles

`SUPER_ADMIN`, `ADMIN` (sans validation de règles ni dérogation), `COMPLIANCE_MANAGER`,
`SALES_MANAGER`, `SALES_AGENT`, `FULFILLMENT_MANAGER`, `WAREHOUSE_OPERATOR`, `CONTENT_MANAGER`,
`SUPPORT_AGENT`, `ACCOUNTANT`, `VIEWER`, `CUSTOMER` — détail des permissions dans
`src/lib/domain/permissions.ts`.

## Développement

Prérequis : Node 22, PostgreSQL 16, Redis 7 (ClamAV et un stockage S3 pour les dépôts de fichiers).

```bash
cp .env.example .env              # DATABASE_URL, REDIS_URL, BETTER_AUTH_SECRET, clés de test…
npm install
npm run db:migrate
npm run db:seed-admin -- vous@exemple.fr "Prénom" "Nom" 1985-01-31   # premier SUPER_ADMIN
npm run dev                       # application
npm run worker:dev                # worker (autre terminal)
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Puis, dans l'administration : Paramètres (identité légale, régime de TVA, stratégie de paiement), Taux
de TVA, Pages légales, Livraison, Espèces, **Règles de conformité** (à faire valider), Produits.
**Santé système** indique ce qui bloque encore la vente.

Contrôles :

```bash
npm run typecheck && npm run lint && npm test && npm run test:integration && npm run build
```

## Limites connues

- Intégrations **non testées contre les services réels** dans ce dépôt : Stripe, Resend, S3/R2, ClamAV
  (les tests d'intégration utilisent des doubles). À valider en préproduction avec des clés de test.
- Images Docker, sauvegarde et restauration non exécutées ici (pas de Docker dans l'environnement de
  développement) : à valider en préproduction.
- Non encore développés : CRM (pipeline, devis/audits de bout en bout), blog et versionnement des
  contenus, redirections 301 et gestion avancée des URL SEO, RGPD outillé (conservation, export,
  suppression), catégories de cookies détaillées, feature flags, tests de charge.
- Aucun contenu réglementaire, légal ou d'entreprise n'est pré-rempli : il doit être saisi et validé par
  l'exploitant.
