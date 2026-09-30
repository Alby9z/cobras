# ADR-002 — Règles de conformité en données versionnées, jamais en code

- Statut : acceptée (phase 2)

## Contexte
La vente d'animaux dépend d'obligations qui varient par espèce, territoire et dans le temps. Coder ces
règles en dur obligerait à redéployer à chaque évolution et inviterait à inventer des références
juridiques.

## Décision
`ComplianceRule` en base : type, fondement (légal / politique commerciale), référence et source,
périmètre, paramètres, dates d'effet, **cycle brouillon → validée → retirée**, versions immuables.
Un moteur pur (`evaluatePurchaseEligibility`) produit une décision expliquée (motifs, contrôles,
documents) et une empreinte `ruleSetVersion`. Toute évaluation est stockée. Une espèce sans règle validée
n'est pas vendable.

## Conséquences
+ aucune donnée légale inventée par le logiciel ; chaque décision est traçable et reproductible ;
+ évolution des règles sans déploiement, avec validation par une personne habilitée ;
− la boutique ne peut pas vendre d'animaux tant que l'équipe n'a pas saisi et validé ses règles ;
− l'exactitude juridique repose sur les personnes qui valident.
