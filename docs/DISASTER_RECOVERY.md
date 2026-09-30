# Reprise après incident

Objectifs indicatifs (à valider avec l'exploitant) : **RPO 24 h** (sauvegarde quotidienne), **RTO 4 h**
(reconstruction d'un serveur). Pour un RPO plus court, ajouter l'archivage continu des WAL
(pgBackRest / WAL-G) — non inclus.

## 1. Incident applicatif (l'app ou le worker ne démarre plus)

1. `docker compose ps` puis `docker compose logs --tail 200 app worker`.
2. `/api/health` (processus) et `/api/ready` (base + Redis) ; **Administration → Santé système** pour les
   dépendances et la configuration.
3. Revenir à la version précédente : `git checkout <commit précédent> && docker compose up -d --build app worker`.
   Une migration déjà appliquée ne se défait pas automatiquement : les migrations doivent rester
   compatibles avec la version précédente (ajouts d'abord, suppressions dans une version ultérieure).

## 2. Paiements en suspens

- Événements Stripe en `FAILED` : **Paiements** → « Rejouer » (idempotent), ou attendre le renvoi par Stripe.
- En cas de doute sur une commande : le tableau de bord Stripe fait foi ; renvoyer l'événement webhook
  correspondant depuis Stripe (le traitement relit l'état du PaymentIntent et est idempotent).
- Autorisations proches de l'expiration : alertes du worker (`authorizations.check`).

## 3. Perte de Redis

Aucune donnée métier n'est perdue (tout est en base). Redémarrer `redis` puis `worker` : les tâches
planifiées sont recréées au démarrage et le balayage périodique remet en file les e-mails, PDF et
analyses restés en attente.

## 4. Corruption ou perte de la base

```bash
docker compose stop app worker
./deploy/restore.sh backups/db-AAAAMMJJ-HHMMSS.dump    # ou récupérer le dump depuis le bucket de sauvegarde
docker compose up -d
```

Après restauration :
- vérifier `/api/ready`, se connecter à l'administration ;
- **rapprocher les paiements Stripe** postérieurs à l'heure du dump (tableau de bord Stripe → rejouer les
  événements webhook de la période, qui seront traités de façon idempotente) ;
- vérifier la numérotation des factures (le compteur est restauré avec la base ; aucune facture émise après
  le dump ne doit être réémise avec un autre numéro — rapprocher avec les PDF du bucket privé) ;
- informer les clients concernés si des commandes ont été perdues.

## 5. Perte totale du serveur

1. Nouveau VPS (UE), Docker, pare-feu (voir DEPLOYMENT.md).
2. Récupérer le dépôt et le `.env` depuis le coffre.
3. `docker compose up -d db` (volume vide → le script d'initialisation crée le rôle applicatif).
4. Copier le dernier dump, `./deploy/restore.sh …`.
5. Les fichiers sont dans le stockage objet (non affecté) ; si le bucket est perdu, le recopier depuis le
   bucket de sauvegarde (`rclone sync bk:…/private src:…`).
6. `docker compose up -d`, DNS si l'IP a changé, puis les vérifications du §4.

## 6. Fuite de secret

1. Révoquer / régénérer immédiatement le secret concerné (Stripe, Resend, S3, base, `BETTER_AUTH_SECRET`).
2. Mettre à jour `.env`, `docker compose up -d`.
3. Consulter le journal d'audit (exports, accès aux documents, connexions du personnel) et les journaux
   du fournisseur.
4. Violation de données personnelles : notification à la CNIL sous 72 h si nécessaire (avec le DPO).
