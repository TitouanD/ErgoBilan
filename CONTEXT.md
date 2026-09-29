# ErgoBilan

Rédaction de bilans d'ergothérapie pédiatrique : l'ergothérapeute saisit les scores des tests passés par l'enfant, et l'application produit le rapport.

## Langage

### Scores

**Sous-test** :
Épreuve élémentaire d'un test du catalogue, qui reçoit un score ou une observation.
_Éviter_ : item, épreuve (pour le sous-test lui-même)

**Métrique** :
Forme sous laquelle un score standardisé est exprimé : note standard (NS), écart type (ET) ou rang percentile (%). Les trois se convertissent l'une en l'autre selon l'échelle du sous-test.
_Éviter_ : unité, mode

**Score saisi** :
La valeur tapée par l'ergothérapeute pour un sous-test, avec sa métrique (ou une catégorie qualitative). C'est la seule chose enregistrée ; le reste est recalculé.
_Éviter_ : score brut, résultat

**Score résolu** :
Un score saisi complété par tout ce qu'on en déduit : nom du sous-test et du test, échelle, z, percentile, zone et texte affiché. C'est ce que montrent les écrans, le rapport et le PDF, et ce qui est envoyé à l'IA.
_Éviter_ : sous-test scoré, score calculé

**Zone** :
Interprétation d'un score standardisé : difficulté (z ≤ -2), fragilité (-2 < z ≤ -1) ou dans la moyenne (z > -1). Elle est déduite du z, ou à défaut du percentile ; un score qualitatif n'a pas de zone.
_Éviter_ : niveau, couleur
