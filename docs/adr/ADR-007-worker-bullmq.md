# ADR-007 — Traitements asynchrones : Redis + BullMQ, base de données comme source de vérité

- Statut : acceptée (phase 2) — remplace le déclenchement par cron HTTP de la phase 1

## Contexte
E-mails, PDF, antivirus, expirations et relances ne doivent ni ralentir ni faire échouer une requête
client, et doivent survivre aux pannes.

## Décision
File BullMQ sur Redis, processus `worker` distinct réutilisant les services métier. Les tâches planifiées
sont des *job schedulers* BullMQ. Les e-mails sont d'abord écrits dans `email_log` (clé de
déduplication, gabarit versionné) puis envoyés avec une clé d'idempotence fournisseur. Relances
exponentielles ; un balayage périodique remet en file ce qui est resté en attente en base. Battement de
cœur du worker dans Redis, visible dans Santé système.

## Conséquences
+ requêtes rapides, reprises automatiques, perte de Redis sans perte de données métier ;
− un service de plus à exploiter (Redis, avec AOF et `noeviction`).
