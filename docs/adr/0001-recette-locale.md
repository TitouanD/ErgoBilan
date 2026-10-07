# La recette tourne en local et publie un statut GitHub

La recette de l'interface (Playwright, voir [`VERIFICATION.md`](../VERIFICATION.md)) conditionne la fusion de `dev` dans `main`. Elle ne tourne pas dans GitHub Actions. Claude la lance en local, sur un checkout propre du dernier commit de `dev`, et publie le statut `recette` sur ce commit. Une règle de `main` exige ce statut.

Pourquoi :

- **Pas de clé secrète Supabase dans GitHub.** Se connecter au compte de test demande une clé secrète, avec des droits d'admin sur l'unique base, celle de production. Elle reste dans `.env.e2e.local`.
- **Les références visuelles sont rendues sous Windows**, comme les écrans que regarde Titouan. Une CI Linux aurait demandé un second jeu de références, car le rendu des polices diffère.
- **Ni minutes ni tokens dépensés à chaque commit de `dev`.** La recette tourne une fois, avant de fusionner la PR hebdomadaire.

Ce qu'on perd : une recette rouge n'est pas visible tant que Claude ne l'a pas lancée, et le statut atteste d'une exécution sur le poste, pas d'une machine neutre.

## Considered Options

- **CI GitHub Actions avec une clé dédiée `ci-recette`.** Écartée : c'est une clé d'admin chez un tiers, et des références Linux.
- **CI sans vraie connexion (Supabase entièrement simulé).** Écartée : on ne vérifie plus ni la connexion ni le catalogue réels.
