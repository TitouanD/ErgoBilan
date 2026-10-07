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
Un score saisi complété par tout ce qu'on en déduit : nom du sous-test et du test, échelle, z, percentile, zone et texte affiché. C'est ce que montrent les écrans, l'aperçu du bilan et le PDF, et ce qui est envoyé à l'IA.
_Éviter_ : sous-test scoré, score calculé

**Zone** :
Interprétation d'un score standardisé : difficulté (z ≤ -2), fragilité (-2 < z ≤ -1) ou dans la moyenne (z > -1). Elle est déduite du z, ou à défaut du percentile ; un score qualitatif n'a pas de zone.
_Éviter_ : niveau, couleur

### Bilans

**Bilan** :
L'évaluation d'un enfant par l'ergothérapeute, et le document qui en résulte et qui est remis à la famille : sections rédigées puis annexes de résultats. On le voit dans l'aperçu et on l'exporte en PDF. Un bilan est finalisé et rangé dans le dossier patient, où il reste figé ; celui qu'on rédige encore est le bilan en cours. Un bilan historique compte comme un bilan initial.
_Éviter_ : rapport, compte rendu, bilan formel, bilan validé

**Parcours** :
Façon de rédiger un bilan : initial (premier bilan, sections rédigées par l'IA), réévaluation (nouveaux scores comparés à un bilan de référence) ou historique (saisie d'un bilan fait hors de l'application, sans IA).
_Éviter_ : flow, mode, type de rapport

**Bilan en cours** :
Le bilan que l'ergothérapeute rédige en ce moment, dans l'un des trois parcours ; il n'y en a qu'un à la fois. On le démarre, on le reprend, on l'abandonne ou on le finalise.
_Éviter_ : session, session d'évaluation, évaluation courante

**Brouillon** :
Copie enregistrée d'un bilan en cours non finalisé, une par patient, qui permet de le reprendre plus tard.
_Éviter_ : sauvegarde, autosave (pour le brouillon lui-même)

**Brouillon périmé** :
Brouillon initial ou historique d'un patient qui a déjà un bilan ; il n'est plus repris tel quel, une réévaluation démarre à sa place.

**Bilan de référence** :
Le bilan le plus récent auquel une réévaluation se compare.
_Éviter_ : bilan précédent, ancien bilan

**Finaliser** :
Transformer le bilan en cours en bilan, rangé dans le dossier patient. Une fois le bilan enregistré, la finalisation est acquise, même si le nettoyage qui suit échoue.
_Éviter_ : valider, clôturer

**Abandonner** :
Quitter le bilan en cours sans le garder : son brouillon est supprimé.
_Éviter_ : annuler, quitter sans sauvegarder

### Patients

**Dossier patient** :
Tout ce que l'application garde d'un enfant : sa fiche, ses bilans, son brouillon et son rappel de réévaluation.
_Éviter_ : fichier patient, fiche (pour l'ensemble)

**Fiche patient** :
L'identité de l'enfant et son contexte (scolarité, famille). C'est la seule source de vérité de l'identité : une correction faite dans la fiche vaut aussi pour le brouillon.
_Éviter_ : profil, identité (pour la fiche entière)

### Suivi des patients

**Rappel de réévaluation** :
Échéance à laquelle un patient qui a au moins un bilan devrait être réévalué, six mois après son dernier bilan. Il est à venir avant l'échéance, à planifier pendant les six mois qui suivent, puis en retard ; l'ergothérapeute peut aussi le planifier, le reporter ou le marquer complété.
_Éviter_ : suivi, followup, relance

### Portail famille

**Portail famille** :
La page où la famille remplit, sans compte, le questionnaire que l'ergothérapeute lui a envoyé par un lien. Ses réponses ne sont lisibles qu'avec la clé contenue dans ce lien.
_Éviter_ : portail patient, formulaire

**Questionnaire famille** :
Les réponses d'une famille sur la fiche patient (identité, responsables, médical, motif), en attente sur le serveur jusqu'à leur import. Il est d'abord envoyé (lien créé, rien de rempli), puis rempli.
_Éviter_ : pending, dossier en attente, formulaire

**Importer un questionnaire** :
Créer un nouveau dossier patient à partir d'un questionnaire famille rempli, avec un brouillon de bilan initial. Le questionnaire est alors supprimé du serveur ; les corrections faites ensuite dans la fiche ne lui reviennent jamais.
_Éviter_ : synchroniser, récupérer

### IA

**Anonymisation** :
Garantie que ce que reçoit l'IA ne permet pas de réidentifier l'enfant ni ses proches. Les identifiants sont remplacés par des marqueurs (pseudonymisation) et les dates précises sont masquées ; la correspondance avec les vraies valeurs ne quitte pas le poste et sert à réhydrater le rapport.
_Éviter_ : chiffrement

**Pseudonymisation** :
Le moyen de l'anonymisation : remplacer chaque identifiant de la fiche patient par un marqueur, par exemple `{{PATIENT_PRENOM}}`.

**Réhydratation** :
Remettre les vraies valeurs à la place des marqueurs dans le texte renvoyé par l'IA, sur le poste de l'ergothérapeute.

**Mot suspect** :
Mot du texte libre qui pourrait encore identifier quelqu'un après la pseudonymisation (surnom, grand-parent, ville). L'ergothérapeute le masque ou l'autorise avant la génération, et ce choix reste sur le dossier du patient.
_Éviter_ : fuite, terme sensible

### Développement

**Recette** :
La batterie complète de tests de l'interface, fonctionnels et visuels, qui conditionne la mise en production (fusion de `dev` dans `main`). Un échec fonctionnel la bloque ; une différence visuelle est soumise à acceptation.
_Éviter_ : QA, validation, recette manuelle

**Vérification ciblée** :
La partie de la recette lancée pendant le développement sur les seuls parcours ou écrans qu'une modification touche.
_Éviter_ : QA locale, test rapide

**Référence visuelle** :
Capture acceptée d'un écran, à laquelle la recette compare son rendu. L'accepter à nouveau est le seul moyen d'entériner un changement visuel voulu.
_Éviter_ : baseline, snapshot
