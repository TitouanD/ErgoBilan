# Veille concurrentielle : octobre 2026

Rapport établi le 2026-10-12 à partir des sites publics des concurrents, de la presse et du code d'ErgoBilan (branche `dev`). Il sert de base au plan d'action.

**Limite de la méthode** : aucun outil d'audience (Similarweb, Semrush, Ahrefs) n'a été utilisé. Les volumes de trafic ne sont pas connus. Les canaux d'acquisition sont déduits de ce qui est visible : pages, blog, presse, déclarations des fondateurs. Les chiffres d'utilisateurs sont ceux que les concurrents publient, sans vérification indépendante.

## 1. Résumé

1. **ErgoExercices est le concurrent direct, pas Scielle.** Même cible exacte (ergothérapeute libéral en pédiatrie), un fondateur ergothérapeute en exercice, des bilans avec calcul automatique des normes, un espace famille et une conclusion rédigée par IA. Scielle est plus abouti et plus professionnel, mais l'ergothérapie n'y est qu'une extension récente (août 2026) d'un produit pensé pour l'orthophonie.
2. **ErgoBilan est invisible.** Il n'a pas de site public : la page d'accueil est l'écran de connexion, le titre est « ErgoBilan » et aucune page n'est indexable. Les deux concurrents tirent l'essentiel de leur trafic de pages et d'articles que Google peut lire. ErgoBilan ne peut pas être trouvé par une ergothérapeute qui cherche « logiciel bilan ergothérapie ».
3. **Le prix d'ErgoBilan est hors marché.** Le marché s'est fixé autour de **20 à 24 € par mois en illimité** (Scielle 23,99 € TTC, myCR 19,90 €, Neurobase illimité). ErgoBilan demande 19 € pour 2 bilans, 34 € pour 6 et 89 € pour 20. La mention « Le tarif le plus bas du marché » de la modale tarifaire est fausse aujourd'hui et doit être retirée.
4. **La confiance sur les données est l'argument de vente central du marché**, et ErgoBilan a un trou : l'IA passe par l'API Gemini de Google (modèle en préversion), sans garantie de traitement en Europe. Scielle (Amazon Bedrock dans l'UE, hébergement HDS) et myCR (Mistral, OVH HDS) en font leur argument principal. ErgoBilan a pourtant de vrais atouts sur ce terrain : données gardées sur le poste, pseudonymisation plus complète que celle de Scielle.
5. **ErgoBilan a une vraie avance produit sur le cœur clinique pédiatrique** : catalogue de tests avec zones, réévaluation comparée au bilan de référence avec graphiques, questionnaire parents, style appris. Aucun concurrent ne montre de réévaluation chiffrée avec évolution des scores. C'est ce différenciateur qu'il faut rendre visible.

## 2. Paysage

|                       | **ErgoBilan**                                            | **Scielle**                                                                     | **ErgoExercices**                         | **myCR**                                             | **Neurobase**                              |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Cible                 | Ergo pédiatrie                                           | Orthophonie d'abord, puis kiné, ergo, psychomot, orthoptie                      | Ergo pédiatrie libérale                   | 7 professions, ergo adulte surtout                   | Neuropsy, psycho, psychomot, ergo          |
| Promesse              | Bilan rédigé à partir des scores                         | « Vos comptes-rendus en moins d'une minute »                                    | « Juste les outils qui servent »          | « 5 min au lieu de 30 »                              | « Diviser par deux le temps de rédaction » |
| Saisie                | Scores du catalogue, observations, questionnaire parents | Dictée, notes, import PDF de batteries (ortho seulement), questionnaire parents | Scores, observations                      | Dictée vocale, apps mobiles                          | Trames (160+)                              |
| Normes et zones       | Oui (z, NS, percentile, zones)                           | Scores recopiés tels quels                                                      | Oui, débloqué sur facture du test         | Non précisé                                          | Non précisé                                |
| Réévaluation comparée | **Oui, avec deltas et graphiques**                       | Bilan de renouvellement (texte)                                                 | Suivi patient, objectifs                  | Non                                                  | Non                                        |
| Espace famille        | Questionnaire parents                                    | Questionnaire parents                                                           | **Application famille complète**          | Non                                                  | Non                                        |
| Export                | PDF                                                      | PDF, DOCX, ODT, signature électronique                                          | Word à la charte                          | PDF, Word                                            | Non précisé                                |
| IA                    | Gemini (Google, API publique)                            | Amazon Bedrock, UE                                                              | Non précisé                               | Mistral                                              | Non précisé                                |
| Hébergement santé     | Données sur le poste ; Supabase pour le reste            | AWS Paris, HDS                                                                  | « France et Europe », pas d'HDS affiché   | OVH HDS                                              | Paris, HDS                                 |
| Prix                  | 19 € / 2 bilans, 34 € / 6, 89 € / 20                     | 23,99 € TTC/mois illimité, 199 € HT/an                                          | Formules Solo et Cabinet, prix non publié | Gratuit 1/mois, crédits dès 1,49 €, illimité 19,90 € | Illimité, prix non publié                  |
| Essai                 | 30 jours                                                 | 1 mois, sans carte                                                              | 14 jours, sans carte, dossier de démo     | 14 jours                                             | Démo personnalisée                         |
| Preuve sociale        | Aucune                                                   | 1 300+ pros, 23 000+ bilans, 3 témoignages, presse                              | Aucune (autorité du fondateur)            | 1 900+ comptes-rendus                                | 1 000+ pros, 19 000+ rapports, vidéos      |

## 3. Scielle

### Ce qu'ils font bien

- **Une promesse chiffrée et simple** : « moins d'une minute », « environ 10 h par mois gagnées ». Le prix est affiché sur l'accueil, en TTC et en HT, avec les variantes DOM, Belgique, Suisse et Canada.
- **La confiance comme produit.** Une page `/securite` précise et vérifiable : AWS Paris certifié HDS v2.0, Bedrock dans l'UE, données jamais utilisées pour l'entraînement, liste exacte de ce qui est masqué, DPA et certificats disponibles sur demande. Ils ont aussi 8 articles de blog sur le sujet (« HDS : ce que la certification prouve », « Anonymisation ou pseudonymisation », « Neuf questions avant de confier vos données patient à un logiciel »). Ces articles éduquent le lecteur puis le font comparer, et Scielle sort gagnant de la grille de critères qu'il a lui-même posée.
- **Le positionnement « secrétaire numérique »** : l'outil « ne conclut pas au-delà de vos notes ». Cette phrase répond à la peur n°1 des soignants face à l'IA.
- **Une page comparative** (`/comparatif-crbo`) qui ne cite aucun concurrent. Elle oppose trois approches : la rédaction à la main, ChatGPT et Scielle. C'est habile, sans risque juridique, et cela se référence sur « ChatGPT compte rendu ».
- **Des pages par métier** (`/blog/logiciel-compte-rendu-bilan-ergotherapie`) qui ciblent la requête d'achat « logiciel compte rendu bilan + métier ».
- **L'honnêteté sur les limites** : la page ergothérapie dit clairement ce que Scielle ne fait pas (pas d'import de feuilles de passation, pas de document pour la MDPH). Cela renforce la crédibilité.
- **Les fonctions de cabinet** : accès remplaçante limité dans le temps, transfert de dossier à une consœur avec consentement journalisé, plusieurs lieux d'exercice, notes de séance, courrier au médecin, signature électronique, exports DOCX et ODT.
- **La fidélisation** : abonnement annuel (environ 2 mois offerts), parrainage (-50 % pour la filleule, jusqu'à un mois offert au parrain), évolutions hebdomadaires annoncées.

### Comment ils obtiennent leur trafic

- **Le bouche-à-oreille avant tout.** Le fondateur déclare dans la presse n'avoir fait aucune publicité. 1 327 orthophonistes l'ont adopté en un an.
- **Une newsletter de la profession** : mention dans la newsletter Orthogestion (plus de 9 000 abonnés) en janvier 2026. C'est probablement leur décollage.
- **Le parrainage** donne un cadre et une récompense au bouche-à-oreille.
- **Le référencement naturel** : 42 articles, centrés sur les requêtes d'achat (« meilleur logiciel compte rendu orthophonique 2026 »), sur la réglementation récente (avenant 21, nouvel acte des kinés) et sur la confiance.
- **La presse régionale** (IMAZ PRESS, Info Outre-mer : Scielle est un produit réunionnais), qui fournit des liens entrants et de la crédibilité.
- **Aucun réseau social** visible et aucun cookie publicitaire, ce dont ils font un argument.

### Faiblesses en ergothérapie

- Seulement 2 articles sur l'ergothérapie, aucun sur la pédiatrie, **aucun test d'ergothérapie nommé** (ni BHK, ni M-ABC-2, ni Beery).
- Pas d'extraction des scores en ergothérapie, pas de calcul de normes ni de zones : les scores sont recopiés « dans leur format ».
- Pas de suivi chiffré de l'évolution entre deux bilans.
- Ils disent eux-mêmes que le contenu ergothérapie « manque encore d'ancienneté ».
- Le prénom ou le nom du patient est envoyé à l'IA.

**Lecture** : Scielle va gagner les ergothérapeutes généralistes par la notoriété et le prix. Il ne gagnera pas facilement l'ergothérapeute pédiatrique qui passe des tests étalonnés, tant que le cœur score, zones et évolution manque.

## 4. ErgoExercices

### Ce qu'ils font bien

- **L'autorité du fondateur** : Rémi Altina, ergothérapeute D.E., en libéral pédiatrique depuis 2015, ancien membre du bureau du SYNFEL (syndicat des ergothérapeutes libéraux), auteur de l'application _Les P'tits Monstres DYS_. Le produit est présenté comme « né d'un problème que j'avais tous les jours ». L'associé, Matthieu Theveniaud, vient du logiciel et de la santé libérale et s'occupe de la diffusion.
- **Une entrée gratuite qui génère du trafic** :
  - générateur d'exercices par IA « gratuit, sans inscription pour démarrer », exportable en PDF ou Word ;
  - convertisseur de scores standardisés « gratuit, sans compte », calculé dans le navigateur, avec une table de correspondance et un exemple rédigé. Il se référence sur des requêtes que tout ergothérapeute tape un jour (« convertir note standard percentile »).
- **L'Espace maison pour les familles** : application installable sur téléphone, sans compte pour le parent, avec exercices et consignes à cocher, carnet de liaison, jeux de clavier et diplômes à imprimer, notifications. C'est un **outil de fidélisation** (la famille voit la valeur du cabinet) et un **canal de visibilité** : chaque parent voit le nom de l'outil.
- **Un dossier de démonstration prérempli** dès la connexion, et un essai de 14 jours sans carte qui « s'arrête tout seul ».
- **Le respect des éditeurs de tests** : le calcul des zones d'un test ne se débloque que sur présentation de la facture d'achat. C'est une réponse propre à la question du droit d'auteur sur les étalonnages.
- **La pseudonymisation par conception** : le dossier ne contient que des initiales, le niveau scolaire et pas de date de naissance complète ; les noms réels sont demandés au moment de l'export Word et ne sont pas enregistrés.
- **Un contenu clinique de qualité, en pédiatrie** : 28 articles (trame de bilan pédiatrique, BHK, figure de Rey, douze conclusions commentées, MDPH, PAP/PPS/PPRE/PAI, dysgraphie, TDC ou dyspraxie). Ces articles répondent aux questions que se pose une ergothérapeute en pédiatrie, et chacun renvoie vers l'Espace Pro.

### Comment ils obtiennent leur trafic

- **Le référencement de contenu clinique**, en amont de l'achat : l'ergothérapeute cherche « cotation BHK » ou « aménagements dysgraphie », pas un logiciel. Seize articles sont datés du même jour (24 août 2026), ce qui laisse penser à une production assistée et à une poussée récente.
- **Les outils gratuits** comme aimant : le générateur et le convertisseur captent un trafic récurrent et mènent à l'Espace Pro.
- **Le réseau du fondateur** : syndicat, application DYS existante, notoriété locale.
- **La diffusion par les familles** grâce à l'Espace maison.
- Aucun réseau social, aucune newsletter ni aucun document téléchargeable visibles.

### Faiblesses

- **Aucun prix publié** (les formules Solo et Cabinet sont citées sans montant, `/tarifs` renvoie une erreur 404).
- Aucune preuve sociale : pas de témoignage ni de chiffre d'utilisateurs.
- Pas d'HDS affiché, IA non nommée.
- Une offre dispersée (exercices, bilans, suivi, famille), et une proposition de valeur de l'accueil qui parle d'exercices plutôt que de bilans.
- Pas de modèle ou de banque de phrases téléchargeable, alors que les articles en parlent.

**Lecture** : c'est le concurrent qui vise exactement la même ergothérapeute. Sa force, c'est la légitimité métier et le trafic gratuit. Sa faiblesse, c'est un produit de bilan jeune et peu démontré. Il faut s'attendre à ce qu'il progresse vite sur le bilan.

## 5. Autres acteurs à surveiller

- **myCR** (`mycr.fr/ergo`) : dictée vocale, applications iOS et Android, 74 tests annoncés (MIF, Barthel, COPM, PEDI, BOT-2…), Mistral et OVH HDS. **Tarification hybride** : 1 bilan gratuit par mois, crédits à l'unité dès 1,49 €, illimité à 19,90 €. C'est le modèle de prix le plus proche de celui d'ErgoBilan, mais 3 à 10 fois moins cher par bilan.
- **Neurobase** (`neurobase.app`) : partenariat avec Pearson (éditeur de tests), 160 trames, vulgarisation du compte rendu pour les familles, témoignages vidéo. L'accord avec un éditeur de tests est un levier de légitimité qu'aucun autre n'a.

## 6. ErgoBilan face au marché

### Atouts à mettre en avant

| Atout                                                                      | Qui l'a aussi                                           | Message possible                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Catalogue de tests pédiatriques avec z, note standard, percentile et zones | ErgoExercices (sous condition de facture)               | « Saisissez les scores, les zones se calculent »           |
| Réévaluation comparée au bilan de référence, deltas et graphiques          | Personne                                                | « Montrez les progrès de l'enfant en un coup d'œil »       |
| Questionnaire parents en ligne, chiffré de bout en bout                    | Scielle (questionnaire), ErgoExercices (espace famille) | « L'anamnèse remplie par la famille avant le rendez-vous » |
| Style appris à partir des corrections                                      | Scielle                                                 | « Le bilan s'écrit comme vous »                            |
| Données patient gardées sur le poste du praticien                          | Personne                                                | « Vos dossiers restent sur votre ordinateur »              |
| Pseudonymisation de tous les identifiants, prénom compris, avant l'IA      | Scielle masque moins (garde le prénom)                  | « L'IA ne voit jamais le nom de l'enfant »                 |
| Mode démo sans compte                                                      | ErgoExercices (dossier de démo après connexion)         | « Essayez sans créer de compte »                           |
| Image de marque du cabinet sur le PDF                                      | Scielle, ErgoExercices                                  | Attendu, pas différenciant                                 |

Les formulations sur les données doivent respecter la règle du projet : ne pas parler de chiffrement des données patient tant que P0-1 n'est pas fait, et parler de **pseudonymes**, pas d'anonymisation.

### Écarts à combler

**Visibilité (bloquant)**

- Aucun site vitrine : l'accueil est un formulaire de connexion avec le slogan « L'assistant clinique intelligent pour Ergothérapeutes ».
- `index.html` ne contient qu'un titre « ErgoBilan » et une description minimale. Il n'y a ni `robots.txt`, ni `sitemap.xml`, ni balises de partage (Open Graph), et le contenu est rendu en JavaScript.
- Aucun blog, aucun outil gratuit, aucune preuve sociale.

**Prix (bloquant)**

| Formule     | Prix             | Bilans   | Prix par bilan                     |
| ----------- | ---------------- | -------- | ---------------------------------- |
| Essentiel   | 19 €/mois        | 2        | 9,50 € (hors forfait 15 €)         |
| Performance | 34 €/mois        | 6        | 5,67 € (hors forfait 8 €)          |
| Expert      | 89 €/mois        | 20       | 4,45 € (hors forfait 5 €)          |
| Scielle     | 23,99 € TTC/mois | illimité | moins de 1 € à partir de 24 bilans |
| myCR        | 19,90 €/mois     | illimité | idem                               |

Une ergothérapeute en pédiatrie fait couramment 6 à 15 bilans par mois, en comptant les réévaluations. Chez ErgoBilan, elle paie 34 à 89 €, contre 24 € chez Scielle. L'argument de la modale « remboursé ×10 par le patient » ne tient pas en libéral non conventionné, où la famille paie le bilan elle-même. Enfin, la tooltip « Le tarif le plus bas du marché » est inexacte : c'est un risque de **pratique commerciale trompeuse** à retirer tout de suite.

**Confiance sur les données (important)**

- L'IA est appelée par l'API publique Gemini (`gemini-3-flash-preview`, API `v1beta`). Il faut vérifier le lieu de traitement et les conditions de non-entraînement. Face à « Bedrock UE » ou « Mistral », c'est l'objection que posera une ergothérapeute renseignée. Pistes : Gemini par Vertex AI en région UE, ou Mistral.
- Il n'existe pas de page sécurité publique qui explique simplement ce qui reste sur le poste, ce qui part vers l'IA et sous quelle forme.
- La question de l'HDS doit être tranchée et formulée : les données de santé restent sur le poste, et ce qui transite par Supabase (questionnaire parents) est chiffré côté client. Une analyse juridique est à prévoir avant toute affirmation publique.

**Fonctions attendues par le marché (secondaire)**

- Export Word (DOCX) : proposé par tous les concurrents, ErgoBilan ne fait que du PDF. Les ergothérapeutes retouchent souvent le bilan avant l'envoi à la MDPH ou à l'école.
- Dictée vocale des observations (Scielle, myCR).
- Accès remplaçante et transfert de dossier (Scielle, ErgoExercices). L'architecture locale le rend plus difficile, c'est à arbitrer.
- Documents dérivés : courrier au médecin, note pour l'école, synthèse vulgarisée pour la famille (Neurobase), aide au dossier MDPH (que Scielle ne fait pas).

## 7. Positionnement recommandé

**Être le logiciel de bilan de l'ergothérapeute en pédiatrie qui travaille avec des tests étalonnés.**

- Contre Scielle : « Scielle met en forme vos notes ; ErgoBilan comprend vos scores. » Zones calculées, évolution chiffrée entre deux bilans, catalogue de tests pédiatriques.
- Contre ErgoExercices : rester concentré sur le bilan, ne pas courir après les exercices. Faire mieux que lui sur la qualité du bilan, la réévaluation et la confiance, et rivaliser avec son contenu clinique.
- Sur la confiance : « Vos dossiers restent sur votre ordinateur. L'IA ne reçoit que des pseudonymes. » C'est un argument que personne d'autre ne peut tenir, à condition de régler la question du fournisseur d'IA.

## 8. Pistes pour le plan d'action

Classées par effet attendu et par effort. À trier ensemble.

### Tout de suite (quelques heures)

1. Retirer « Le tarif le plus bas du marché » et « remboursé ×10 » de `PricingModal.tsx`.
2. Compléter `index.html` : titre et description ciblés (« Logiciel de bilan d'ergothérapie pédiatrique »), Open Graph, `robots.txt`.
3. Vérifier les conditions de l'API Gemini utilisée (lieu de traitement, entraînement, durée de conservation) et noter le résultat dans `docs/AI_PIPELINE.md`.

### Court terme (2 à 4 semaines)

4. **Revoir la grille tarifaire** : une formule illimitée autour de 24 à 29 € par mois (voire légèrement au-dessus de Scielle, justifiée par la spécialisation), un abonnement annuel, et éventuellement un bilan gratuit par mois ou un bilan à l'unité pour l'usage occasionnel. Vérifier d'abord le coût réel d'une génération Gemini pour valider la marge.
5. **Site vitrine statique** (pages pré-rendues, séparées de l'application) : accueil avec promesse chiffrée, prix visible, page sécurité, page comparative « à la main / ChatGPT / ErgoBilan » sur le modèle de Scielle, accès direct au mode démo.
6. **Page sécurité** honnête et précise, dans les limites des règles du projet.
7. **Parrainage** simple (un mois offert de part et d'autre), branché sur Stripe.

### Moyen terme (1 à 3 mois)

8. **Un outil gratuit qui génère du trafic** : un convertisseur de scores (le calcul existe déjà dans `utils/scoring.ts`) ou une fiche de cotation par test, accessibles sans compte, chacun renvoyant vers le mode démo.
9. **Contenu clinique en pédiatrie** : une page par test du catalogue (BHK, M-ABC-2, Beery, DTVP…) avec ce que le bilan en dit et un exemple de texte ; des guides (MDPH, aménagements scolaires, réévaluation). Il vaut mieux 10 bonnes pages par test que 40 articles génériques.
10. **Export DOCX** du bilan.
11. **Preuve sociale** : obtenir 3 à 5 témoignages signés des testeuses, puis afficher le nombre de bilans générés.
12. **Relais métier** : newsletter ou annonce auprès de l'ANFE, du SYNFEL, des IFE (instituts de formation), et des groupes d'ergothérapeutes libéraux. C'est l'équivalent pour ErgoBilan de la newsletter Orthogestion qui a lancé Scielle.

### À étudier

13. Changer de fournisseur d'IA pour un traitement garanti en Europe (Vertex AI UE ou Mistral).
14. Enrichir le portail parents : synthèse vulgarisée du bilan, consignes à la maison. C'est la réponse à l'Espace maison d'ErgoExercices, sans en faire une application d'exercices.
15. Contacter les éditeurs de tests (ECPA/Pearson, Hogrefe) pour un partenariat ou, au minimum, une politique claire sur les étalonnages, comme le fait ErgoExercices.
16. Mettre en place un outil de mesure d'audience sans cookie (Plausible ou Vercel Analytics) dès la mise en ligne de la vitrine, pour suivre l'effet de chaque action.

## Sources

- Scielle : [accueil](https://scielle.com/), [sécurité](https://scielle.com/securite), [comparatif](https://scielle.com/comparatif-crbo), [blog](https://scielle.com/blog), [page ergothérapie](https://scielle.com/blog/logiciel-compte-rendu-bilan-ergotherapie), [meilleur logiciel orthophonique](https://scielle.com/blog/meilleur-logiciel-compte-rendu-orthophonique), [histoire](https://scielle.com/blog/histoire-de-scielle)
- Presse : [IMAZ PRESS](https://imazpress.com/toute-l-actu/ortophoniste-appli), [Info Outre-mer](https://infooutremer.fr/la-reunion-scielle-lapplication-locale-qui-veut-alleger-le-travail-administratif-des-orthophonistes/)
- ErgoExercices : [accueil](https://www.ergo-exercices.fr/), [Espace Pro](https://www.ergo-exercices.fr/espace-pro), [Espace maison](https://www.ergo-exercices.fr/espace-maison), [convertisseur](https://www.ergo-exercices.fr/outils/convertisseur-scores-standardises), [blog](https://www.ergo-exercices.fr/blog), [qui sommes-nous](https://www.ergo-exercices.fr/qui-sommes-nous), [choisir un logiciel](https://www.ergo-exercices.fr/blog/choisir-logiciel-bilan-ergotherapie), [trame pédiatrie](https://www.ergo-exercices.fr/blog/rediger-bilan-ergotherapique-pediatrie-trame)
- Autres : [myCR ergo](https://mycr.fr/ergo/), [Neurobase](https://www.neurobase.app/)
- ErgoBilan : `components/app/LandingPage.tsx`, `components/shared/PricingModal.tsx`, `index.html`, `docs/AI_PIPELINE.md`, `docs/DATA_MODEL.md`
