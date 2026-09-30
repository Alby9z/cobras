# Sécurité

Ce document décrit les protections **effectivement implémentées** et celles qui restent à la charge de
l'exploitation. Les éléments marqués « testé » sont couverts par un test automatisé du dépôt.

## Authentification

| Mesure | Détail |
|---|---|
| Mots de passe | Argon2id (Better Auth), 10 caractères minimum |
| Message d'échec | unique : « Email ou mot de passe incorrect. » (pas d'énumération de comptes) — testé (parcours E2E) |
| Vérification d'e-mail | exigée par le moteur d'éligibilité pour commander (motif bloquant) |
| Double authentification | TOTP ; **obligatoire pour tout compte du personnel** hors développement (`STAFF_REQUIRE_2FA`) : pages admin redirigées vers le profil, actions refusées (403) — testé |
| Sessions | cookies `HttpOnly`, `Secure` en HTTPS, `SameSite=Lax` ; toutes les sessions d'un utilisateur sont supprimées quand son rôle change ou qu'il est bloqué |
| Limitation de débit | connexion / inscription (Better Auth, stockage en base), plus limites applicatives par action (`RATE_LIMIT_*`) |
| Âge minimum de création de compte | `MINIMUM_ACCOUNT_AGE` : **politique commerciale** paramétrable, non présentée comme une obligation légale |
| Connexions du personnel | journalisées dans l'audit |

## Autorisation (RBAC)

- 12 rôles, 30 permissions (`src/lib/domain/permissions.ts`). Le rôle est **relu en base à chaque requête** ;
  il ne provient jamais du client.
- Pages admin : permission manquante → 404 (pas de divulgation). Actions / API : 403 normalisé — testé.
- Séparation des pouvoirs : `ADMIN` ne peut ni valider une règle de conformité ni déroger à une décision
  (`compliance.rules.approve`, `compliance.override` réservés à `COMPLIANCE_MANAGER` et `SUPER_ADMIN`).
- Un acteur ne peut ni attribuer ni retirer un rôle supérieur ou égal au sien, ni modifier son propre compte.
- Accès aux documents d'un autre client refusé même avec un identifiant valide — testé.

## Base de données

- **Deux rôles PostgreSQL** (`deploy/postgres-init/10-app-role.sh`) : le propriétaire du schéma sert aux
  migrations et sauvegardes ; l'application et le worker utilisent un rôle **limité au DML** (ni DDL, ni
  TRUNCATE, ni `BYPASSRLS`, non propriétaire). Vérifié manuellement sur PostgreSQL 16 : ce rôle ne peut
  ni désactiver un déclencheur, ni vider/supprimer une table, ni créer d'objet.
- Tables **en ajout seul** par déclencheur : `audit_log`, `inventory_movement`, `compliance_evaluation`
  (UPDATE/DELETE/TRUNCATE refusés) — testé.
- Factures **immuables** (seuls l'état et la clé du PDF peuvent évoluer) ; règles de conformité validées
  immuables — testé.
- Contraintes CHECK : stock réservé ≤ stock physique, montants cohérents, remboursé ≤ payé ≤ total,
  règle légale ⇒ référence juridique, règle active ⇒ validation.
- **Row Level Security** sur `address`, `order`, `document`, `notification`, `wishlist_item` : les requêtes
  exécutées « au nom du client » (`withUserScope`) ne voient que ses lignes. La RLS n'est effective qu'avec
  le rôle d'exécution non propriétaire (vérifié).
- Requêtes paramétrées uniquement (Prisma / gabarits `$queryRaw`).

## Paiements

- Clés Stripe côté serveur uniquement. Signature du webhook vérifiée ; événements dédoublonnés en base ;
  **l'état est relu chez Stripe** avant toute écriture (un événement falsifié ne peut rien encaisser).
- Montants recalculés côté serveur, jamais lus depuis le navigateur.
- Remboursements sérialisés (`pg_advisory_xact_lock`) : deux remboursements concurrents ne peuvent pas
  dépasser le montant payé — testé.

## Fichiers

- Taille maximale (`UPLOAD_MAX_MB`), type déterminé par **signature binaire** puis cohérence avec
  l'extension ; nom d'origine assaini, clé de stockage aléatoire.
- Dépôt en **quarantaine**, analyse ClamAV par le worker ; fichier infecté supprimé et signalé ;
  ClamAV indisponible ⇒ nouvelles tentatives puis `SCAN_FAILED` (jamais considéré comme sain).
- Bucket privé sans accès public ; téléchargement par URL signée de courte durée, après contrôle
  propriétaire ou permission `documents.read_sensitive`, et journalisé.
- Exports CSV : neutralisation des formules (`= + - @`), export journalisé.

## En-têtes et navigateur

CSP avec nonce par requête, HSTS (preload), `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy`, `X-Content-Type-Options`. Formulaires protégés par le mécanisme d'origine des
Server Actions de Next.js. Consentement cookies avant tout traceur analytique.

## Erreurs et journaux

- Réponses d'erreur normalisées `{ code, message, details, request_id }`, **sans trace technique**.
- Chaque requête reçoit un `x-request-id`, repris dans les journaux JSON et l'audit.
- Journaux : champs sensibles masqués par nom de clé (mots de passe, secrets, jetons, en-tête d'autorisation, cookies, carte, IBAN, clés d'API).

## Secrets

- Uniquement dans `.env` (`chmod 600`), jamais dans le dépôt (`.gitignore`), l'image Docker
  (`.dockerignore`) ou le bundle client (seules les variables `NEXT_PUBLIC_*` y figurent, et aucune n'est secrète).
- Variables validées au démarrage (`src/lib/env.ts`) : l'application refuse de démarrer si une valeur manque.
- Rotation : régénérer, mettre à jour `.env`, `docker compose up -d`. La rotation de `BETTER_AUTH_SECRET`
  déconnecte tous les utilisateurs.

## Reste à faire côté exploitation

- Pare-feu (SSH, 80, 443 uniquement), mises à jour système, accès SSH par clé.
- Verrouillage d'objets (object lock) sur le bucket de sauvegarde.
- Test d'intrusion externe avant ouverture, puis annuel.
- Revue trimestrielle des comptes du personnel et des rôles.
