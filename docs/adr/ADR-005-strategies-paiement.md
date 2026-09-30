# ADR-005 — Stratégies de paiement configurables

- Statut : acceptée (phase 2)

## Contexte
Encaisser avant de savoir si la vente est légalement possible expose à des remboursements, frais et
litiges ; ne rien encaisser expose aux commandes non honorées. Le choix est commercial et juridique.

## Décision
Quatre stratégies : paiement après validation, autorisation puis capture, acompte puis solde, paiement
immédiat. Défaut pour les animaux dans les Paramètres, surcharge par produit, **la plus prudente
l'emporte** dans un panier. Aucune stratégie par défaut n'est imposée par le logiciel : la vente est
bloquée tant qu'elle n'est pas choisie. Stripe Checkout en capture manuelle pour l'autorisation ;
le worker surveille l'expiration des autorisations.

## Conséquences
+ adaptable au cadre juridique réel de la boutique ;
− l'autorisation de carte est limitée dans le temps (≈ 7 jours chez Stripe) : examen de conformité à
  mener dans ce délai ;
− la non-restitution d'un acompte doit être validée juridiquement (non présumée par le logiciel).
