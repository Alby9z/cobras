# Guide de déploiement

## 1. Prérequis

- Un VPS en UE (OVH, Scaleway, Hetzner) : 2 vCPU, **4 Go de RAM minimum** (ClamAV en utilise ~1,5 Go), Debian 12 / Ubuntu 24.04
- Un nom de domaine dont les enregistrements `A`/`AAAA` (domaine et `www`) pointent vers le serveur
- Comptes : Stripe (activé), Resend (domaine vérifié SPF/DKIM), Cloudflare R2 ou AWS S3

## 2. Services externes

**Stockage (R2)** — créer 3 buckets :
- `reptile-media` : accès public via un domaine personnalisé (ex. `media.exemple.fr`) → `NEXT_PUBLIC_MEDIA_URL`
- `reptile-private` : **aucun accès public** (documents clients, factures)
- `reptile-backups` : de préférence sur un autre compte ; activer le verrouillage d'objets si disponible

Créer une clé API limitée aux deux premiers buckets, et une autre pour les sauvegardes.

**Stripe** — Développeurs → Webhooks → endpoint `https://www.exemple.fr/api/stripe/webhook`,
événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`,
`payment_intent.amount_capturable_updated`, `payment_intent.payment_failed`, `payment_intent.canceled`,
`charge.refunded`. Copier le secret `whsec_…`. Valider d'abord tout le parcours en **mode test**
(paiement, autorisation puis capture, annulation, remboursement) sur une préproduction.
Activer Apple Pay / Google Pay (Paramètres → Moyens de paiement) et **vérifier le domaine Apple Pay**.
Faire confirmer par Stripe que la vente d'animaux vivants est acceptée pour votre compte.

**Resend** — vérifier le domaine d'envoi (SPF, DKIM, DMARC).

**Surveillance** — créer un check sur healthchecks.io (période 1 jour) → `HEALTHCHECK_URL`,
et une sonde de disponibilité (UptimeRobot, Better Stack) sur `https://www.exemple.fr/api/ready`
(base + Redis). La page **Administration → Santé système** montre aussi le battement de cœur du worker,
la file de travaux et la configuration manquante.

## 3. Serveur

```bash
# Docker
curl -fsSL https://get.docker.com | sh
# Pare-feu : seuls SSH, 80 et 443
ufw allow OpenSSH && ufw allow 80 && ufw allow 443/tcp && ufw allow 443/udp && ufw enable

git clone <dépôt> /opt/reptile-shop && cd /opt/reptile-shop
cp .env.example .env && chmod 600 .env
nano .env    # tout renseigner ; secrets : openssl rand -hex 32 (POSTGRES_PASSWORD, APP_DB_PASSWORD, REDIS_PASSWORD…)
docker compose up -d --build
docker compose logs -f app worker
```

Au premier démarrage, PostgreSQL exécute `deploy/postgres-init/10-app-role.sh` (volume vide
uniquement) : il crée le rôle d'exécution `APP_DB_USER`, limité au DML. **Sur une base existante**
(volume déjà initialisé), exécuter ce SQL une fois à la main — voir docs/DATABASE.md.

Premier administrateur (compte `SUPER_ADMIN`) :

```bash
docker compose run --rm -it migrate npx tsx scripts/create-admin.ts vous@exemple.fr "Prénom" "Nom" 1985-01-31
```

Se connecter et **activer la double authentification** (obligatoire pour tout le personnel ; sans elle,
l'administration redirige vers le profil). Puis, dans l'administration :
1. Taux de TVA (à confirmer avec l'expert-comptable)
2. Paramètres : identité légale (raison sociale, forme, SIRET, RCS, capital, adresse), régime de TVA,
   n° de TVA, TVA de la livraison, stratégie de paiement des animaux, délais de réservation
3. Pages légales : mentions légales, CGV, confidentialité (obligatoires pour vendre), puis les autres — à faire valider par un juriste
4. Tarifs de livraison
5. Espèces (catégorie réglementaire), puis **règles de conformité** saisies avec leurs références et
   validées par un `COMPLIANCE_MANAGER` ou le `SUPER_ADMIN`
6. Catégories, produits, animaux (statut « Disponible » après contrôle), FAQ
7. Comptes du personnel avec le rôle minimal nécessaire

**Santé système** liste les éléments bloquants : tant qu'il en reste, aucune commande n'est acceptée.

## 4. Google

- Search Console : propriété de domaine (DNS) ou balise → `GOOGLE_SITE_VERIFICATION`, puis soumettre `/sitemap.xml`
- GA4 : créer un flux Web → `NEXT_PUBLIC_GA_ID` (rebuild nécessaire). Marquer `purchase`, `generate_lead`, `quote_request`, `audit_request`, `sign_up` comme événements clés.
- Google Business Profile : renseigner les mêmes coordonnées que dans les Paramètres (cohérence NAP).

## 5. CI/CD

Secrets GitHub (environnement `production`) : `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`,
`DEPLOY_HOST_FINGERPRINT`, `DEPLOY_PATH`. Chaque push sur `main` : validation du schéma, migrations
sur base de test, typecheck, lint, tests unitaires et d'intégration (PostgreSQL + Redis), build de
l'application et du worker, audit npm, puis déploiement SSH (`app`, `worker`, `migrate`) avec contrôle
de disponibilité (`/api/ready`).

## 6. Sauvegardes et restauration

- Détail : docs/BACKUPS.md et docs/DISASTER_RECOVERY.md
- Quotidiennes (03:30 UTC) : dump PostgreSQL vérifié, rotation 14 jours, copie hors site, synchronisation des buckets (documents supprimés conservés dans `private-deleted/`)
- Alerte via `HEALTHCHECK_URL` en cas d'échec ou d'absence d'exécution
- Sauvegarde manuelle : `docker compose exec backup sh /backup.sh`
- Restauration : `./deploy/restore.sh backups/db-AAAAMMJJ-HHMMSS.dump`
- **Tester une restauration chaque trimestre** sur un serveur de préproduction.

## 7. Exploitation

| Action | Commande |
|---|---|
| Logs | `docker compose logs -f app worker` |
| Redémarrer le worker | `docker compose restart worker` |
| Mise à jour manuelle | `git pull && docker compose up -d --build` |
| Console SQL | `docker compose exec db psql -U $POSTGRES_USER $POSTGRES_DB` |
| Mise à jour des signatures antivirus | automatique (freshclam intégré à l'image) |
