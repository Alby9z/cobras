# ADR-008 — Garanties de sécurité et d'intégrité au niveau de la base

- Statut : acceptée (phase 2)

## Contexte
Un défaut applicatif ou un accès indû ne doit pas pouvoir falsifier l'audit, une facture, l'historique
de stock ou une décision de conformité, ni exposer les données d'un autre client.

## Décision
- Déclencheurs d'ajout seul (audit, mouvements de stock, évaluations) et d'immuabilité (factures, règles
  validées), y compris contre TRUNCATE ;
- contraintes CHECK et index partiels pour les invariants métier ;
- Row Level Security sur les tables personnelles, activée par `withUserScope` ;
- **rôle PostgreSQL d'exécution limité au DML**, distinct du propriétaire des migrations, pour que
  l'application ne puisse ni désactiver ces protections ni contourner la RLS.

## Conséquences
+ défense en profondeur vérifiée par des tests et un contrôle manuel sur PostgreSQL 16 ;
− les tests d'intégration doivent désactiver les déclencheurs pour vider les tables (base de test
  uniquement, rôle propriétaire) ;
− une base existante doit recevoir le rôle d'exécution manuellement (voir DATABASE.md).
