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

### Bilans

**Parcours** :
Façon de rédiger un bilan : initial (premier bilan, rapport généré par l'IA), réévaluation (nouveaux scores comparés à un bilan de référence) ou historique (saisie d'un bilan fait hors de l'application, sans IA).
_Éviter_ : flow, mode, type de rapport

**Bilan en cours** :
Le bilan que l'ergothérapeute rédige en ce moment, dans l'un des trois parcours ; il n'y en a qu'un à la fois. On le démarre, on le reprend, on l'abandonne ou on le finalise.
_Éviter_ : session, session d'évaluation, évaluation courante

**Brouillon** :
Copie enregistrée d'un bilan en cours non finalisé, une par patient, qui permet de le reprendre plus tard.
_Éviter_ : sauvegarde, autosave (pour le brouillon lui-même)

**Brouillon périmé** :
Brouillon initial ou historique d'un patient qui a déjà un bilan formel ; il n'est plus repris tel quel, une réévaluation démarre à sa place.

**Bilan formel** :
Bilan finalisé et enregistré dans le dossier du patient. Un bilan historique est un bilan formel initial.
_Éviter_ : rapport final, bilan validé

**Bilan de référence** :
Le bilan formel le plus récent auquel une réévaluation se compare.
_Éviter_ : bilan précédent, ancien bilan

**Finaliser** :
Transformer le bilan en cours en bilan formel. Une fois le bilan formel enregistré, la finalisation est acquise, même si le nettoyage qui suit échoue.
_Éviter_ : valider, clôturer

**Abandonner** :
Quitter le bilan en cours sans le garder : son brouillon est supprimé.
_Éviter_ : annuler, quitter sans sauvegarder
