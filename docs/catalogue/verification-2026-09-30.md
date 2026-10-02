# Vérification du catalogue contre les protocoles publiés (2026-09-30, #50)

Passe réelle demandée dans #50 : chaque sous-test des 42 tests officiels en base (`official_subtests`, `organization_id is null`, lu en lecture seule le 2026-09-30) est comparé au protocole publié (éditeur, manuel, articles, fiches de cotation), source à l'appui. Verdicts : **RÉEL**, **INVENTÉ** (absent du protocole), **DOUTEUX** ; puis sous-tests réels manquants et échelles contredites par une source. Aucune correction n'est appliquée ici : elles passeront par une migration relue (`supabase/migrations/`), et les choix cliniques restent à trancher par Titouan.

> **État au 2026-10-02** : la migration `20261001100300_catalogue_corrections.sql`, appliquée le 2026-10-02, a corrigé les points marqués « Corrigé le 2026-10-02 » ci-dessous : les 7 sous-tests inventés (Cloches omissions gauche et droite, NEPSY-2 discrimination digitale et précision motrice, Alouette indice d'efficience CTL, TIHM shift et rotation) sont retirés ; EViC (nom, auteurs Lefévère et Galbiati 2007, unité MPM) et Lespargot (lettres par minute) sont rectifiés. Elle corrige aussi d'autres écarts certains (DTVP-2, MABC-2, échelles, ordres d'affichage, catégories ; liste dans l'en-tête de la migration). La migration `20261002120000_catalogue_ajouts.sql`, appliquée le 2026-10-02 (#90), a ajouté les manquants sourcés : DTVP-3 et DTVP-A (indices), PDMS-2 (quotients), TEA-Ch Sky Search DT, Profil Sensoriel 2 (sections comportementales), NEPSY-2 (Horloges, Puzzles géométriques et d'images, Orientation, Réponses associées), Barrage des H (oublis, fausses alarmes, stratégie), SPM Taste and Smell, MABC-2 zig-zag autre jambe, Vineland-3 (sous-domaines en notes v, Internalisé, Externalisé). Restent **ouverts** : sous-tests douteux, BOT-2, points « à confirmer », stratégie des Cloches (sans liste publiée, notée en observation), Jebsen-Taylor par main et total, et les manquants hors de #90 (Alouette, Reversal, TIHM, Frostig, EGP, WISC-V).

## Vérification du catalogue, lot A (issue #50)

Données lues en base (lecture seule, `official_subtests` avec `organization_id is null`) le 2026-09-30. Chaque verdict renvoie à une source. « Non vérifié » veut dire qu'aucune source accessible n'a permis de trancher.

Légende :

- **RÉEL** : présent dans le protocole publié.
- **INVENTÉ** : absent du protocole.
- **DOUTEUX** : la mesure existe, mais sous une autre forme ou dans une autre version du test.

---

### test-cloches (Test des Cloches, Gauthier, Dehaut et Joanette 1989)

| id                                   | nom                              | verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| test-cloches\_\_cibles               | Nombre de cloches repérées (/35) | **RÉEL** : « Score : noter le nombre de cloches barrées (x/35) » (ODEDYS 2, consigne de l'épreuve). La version adulte donne aussi « total number of circled bells … maximum score is 35 » (StrokEngine).                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| test-cloches\_\_temps-total-secondes | Temps total (secondes)           | **RÉEL** : « Noter le temps mis par l'enfant, s'il est inférieur à 2 minutes » (ODEDYS 2). Le protocole adulte relève lui aussi le temps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| test-cloches\_\_omissions-gauche     | Omissions hémichamp gauche       | **Corrigé le 2026-10-02** (migration `20261001100300_catalogue_corrections.sql`) : retiré. **INVENTÉ pour l'usage pédiatrique.** La version enfant (ODEDYS 2, Cogni-Sciences Grenoble) ne cote que le nombre de cloches /35, le temps et la stratégie, sans omissions par côté. **Nuance** : le protocole **adulte** de Gauthier (1989), fait pour dépister la négligence spatiale unilatérale (NSU), compare les omissions de la moitié gauche et de la moitié droite de la feuille (« an omission of 6 or more bells on the right or left half of the page indicates USN », StrokEngine). La mesure existe donc chez l'adulte, pas dans la cotation pédiatrique. |
| test-cloches\_\_omissions-droite     | Omissions hémichamp droit        | **Corrigé le 2026-10-02** (migration `20261001100300_catalogue_corrections.sql`) : retiré. **INVENTÉ pour l'usage pédiatrique**, avec la même nuance que ci-dessus.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Manquant** : la **stratégie d'exploration**, une donnée qualitative. L'examinateur trace sur la fiche de positionnement l'ordre suivi par l'enfant d'une cloche à l'autre. ODEDYS 2 : « Noter la stratégie de recherche employée… Score : noter le nombre de cloches barrées (x/35) et la stratégie ».

**Échelle** : `cibles` est en `standard`. ODEDYS 2 publie une moyenne et un écart-type par classe (par exemple score /35 et temps), ce qui rend un z-score possible. Rien ne contredit ce choix. Le temps est en `none`, alors que les mêmes tables donnent aussi une moyenne et un écart-type pour le temps.

Sources :

- ODEDYS 2, Cogni-Sciences, IUFM de Grenoble, 2005, épreuve « 11. Les cloches » : https://www.dyslexie.lu/ODEDYS2.pdf
- StrokEngine, Bells Test : https://strokengine.ca/en/assessments/bells-test/ (référence : Gauthier, Dehaut et Joanette, 1989, _Int. J. Clin. Neuropsychol._ 11, 49-54)

---

### barrage-h (Barrage des H, Lefévère et Galbiati, CHU Bicêtre 2006, d'après Diller et Weinberg 1977)

| id                  | nom                      | verdict                                                                                                                                                      |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| barrage-h\_\_cibles | Nombre de cibles barrées | **RÉEL** : colonne « Bonnes réponses / 34 » de la feuille de passation, et tableau « Nombre de cibles barrées » par classe. À noter : le maximum est **34**. |
| barrage-h\_\_temps  | Temps total (secondes)   | **RÉEL** : colonne « Temps (secondes) » ; l'épreuve est limitée à 3 minutes.                                                                                 |

**Manquants** (feuille de passation) :

- **Oublis** (omissions) ;
- **Fausses alarmes** (confusions de lettres) ;
- **Stratégie par intervalle** (30 s-1 min, 1-2 min, 2-3 min) : anarchique, linéaire avec ou sans retour à la ligne, en colonne avec ou sans retour en haut. C'est une donnée qualitative.

**Échelle** : les deux sous-tests sont en `standard`. Les auteurs écrivent que leurs données « ne constituent qu'une APPROCHE et [ne sont] en aucun cas un ÉTALONNAGE » (30 enfants par classe). Des moyennes et des écarts-types existent, mais un z-score présenté comme normé serait trompeur. Ce n'est pas une contradiction franche, plutôt un point de vigilance.

Source :

- Lefévère et Galbiati, _Test d'exploration visuelle, Barrage des H_, CHU Bicêtre, juin 2006 : https://cnrlapepiniere.fr/wp-content/uploads/sites/20/2024/06/EVAL-EXPLORATION-TEST-BARRAGE-DES-H.pdf (copie : http://www.geppe.free.fr/IMG/pdf/2006_06_-_LEFEVERE_et_GALBIATI_-_TEST_DES_H-ssf.pdf)

---

### bhk (BHK enfant, Charles, Soppelsa et Albaret 2004, ECPA)

| id             | nom                | verdict                                                                                          |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| bhk\_\_quality | Qualité            | **RÉEL** : analyse « à partir de 13 items » (score de dégradation), selon la fiche Pearson ECPA. |
| bhk\_\_speed   | Vitesse (car/5min) | **RÉEL** : vitesse d'écriture en caractères copiés en 5 minutes (fiche Pearson ECPA).            |

**Manquant** : aucun score chiffré. Pearson mentionne « un ensemble de signes cliniques », qui relève de l'observation.

Source : https://www.pearsonclinical.fr/bhk-echelle-devaluation-rapide-de-lecriture-chez-lenfant

---

### bhk-ado (BHK Ado, Soppelsa et Albaret 2013, ECPA)

| id                 | nom                | verdict                                                              |
| ------------------ | ------------------ | -------------------------------------------------------------------- |
| bhk-ado\_\_quality | Qualité            | **RÉEL** : qualité mesurée par **9 critères** qualitatifs.           |
| bhk-ado\_\_speed   | Vitesse (car/5min) | **RÉEL** : fréquence d'inscription (caractères écrits en 5 minutes). |

**Manquant** : aucun.

Sources :

- Pearson ECPA, fiche BHK Ado : https://www.pearsonclinical.fr/bhk-ado-echelle-devaluation-rapide-de-lecriture-chez-ladolescent-2
- Pearson Canada, BHK Ado : https://www.pearsonclinical.ca/store/caassessments/en/c/%C3%89chelle-d%27%C3%A9valuation-rapide-de-l%27%C3%A9criture-chez-l%27adolescent/p/P100008317.html

Le contenu vient de l'extrait de recherche de ces pages : « correction porte sur la fréquence d'inscription (nombre de caractères écrits en 5 minutes) et la qualité … 9 critères ».

---

### alouette (Alouette-R, Lefavrais 1967, révision 2005, ECPA)

Variables du test (UNADREO, fiche Alouette-R 2005) : « temps de lecture, nombre de mots lus, nombres d'erreurs produites, indice de précision et de vitesse de lecture ».

Formules (Champagne et al. 2024) :

- CM (précision) = (M − E) / M × 100 ;
- CTL (vitesse) = (M − E) / TL × 180.

| id                                  | nom                       | verdict                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| alouette\_\_temps-de-lecture        | Temps de lecture          | **RÉEL** (TL, 3 minutes au plus).                                                                                                                                                                                                                                                                                                                                                                         |
| alouette\_\_nombre-d-erreurs        | Nombre d'erreurs          | **RÉEL** (E).                                                                                                                                                                                                                                                                                                                                                                                             |
| alouette\_\_indice-de-pr-cision     | Indice de précision       | **RÉEL** (CM).                                                                                                                                                                                                                                                                                                                                                                                            |
| alouette\_\_indice-de-vitesse       | Indice de vitesse         | **RÉEL** : c'est le CTL.                                                                                                                                                                                                                                                                                                                                                                                  |
| alouette\_\_indice-d-efficience-ctl | Indice d'efficience (CTL) | **Corrigé le 2026-10-02** (migration `20261001100300_catalogue_corrections.sql`) : retiré. **INVENTÉ en tant que sous-test distinct.** Il n'y a que deux indices, CM et CTL, et le CTL **est** l'indice de vitesse. Un « indice d'efficience » à part n'existe pas dans le protocole : c'est un doublon de `indice-de-vitesse`. Il faut n'en garder qu'un, nommé par exemple « Indice de vitesse (CTL) ». |

**Manquants** :

- **Nombre de mots lus (M)**, variable de base du protocole ;
- **Âge de lecture**, score dérivé du test, qui intéresse surtout l'orthophoniste.

Les **mots correctement lus (C = M − E)** peuvent aussi s'ajouter, facultativement.

Sources :

- UNADREO, fiche Alouette-R 2005 : https://www.unadreo.org/wp-content/uploads/2020/11/Alouette-2005.pdf
- Champagne et al. (2024), _Alouette-R normative data for French-speaking school-aged children living in Quebec_, IJLCD : https://onlinelibrary.wiley.com/doi/10.1111/1460-6984.13076 (formules CM et CTL, citées d'après l'extrait de recherche)

---

### reversal (Reversal Test, Edfeldt 1955, étalonnage français ECPA 1966-1970)

Cotation (feuille de Lefévère et Galbiati, CHU Bicêtre 2007, conforme au protocole Edfeldt) : 84 paires, total des erreurs, et erreurs par type :

- GD /20 : non-barrage d'une paire inversée gauche/droite, erreur « en miroir » ;
- HB /6 : non-barrage d'une paire inversée haut/bas ;
- GD+HB /5 : non-barrage d'une paire inversée dans les deux sens ;
- Id /42 : barrage d'une paire identique ;
- Dif /11 : non-barrage d'une paire différente.

L'étalonnage de 1966 s'exprime en score sur 84 (moyenne 68,38, écart-type 11,61), soit 84 moins les erreurs.

| id                                       | nom                          | verdict                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| reversal\_\_nombre-de-r-ponses-correctes | Nombre de réponses correctes | **RÉEL** : score /84.                                                                                                                                                                                                                                                                            |
| reversal\_\_nombre-d-inversions          | Nombre d'inversions          | **DOUTEUX** : le protocole ne définit pas de score « inversions ». Il cote les erreurs par type (GD, HB, GD+HB, Id, Dif). Le libellé mélange les erreurs en miroir (GD, HB, GD+HB) sans dire lesquelles. Mieux vaut le remplacer par le total des erreurs et, si utile, par les types d'erreurs. |

**Manquants** :

- **Total des erreurs** ;
- éventuellement le détail par type : **GD, HB, GD+HB, Id, Dif**.

Source : Lefévère et Galbiati, _Reversal Test, étude sur 129 enfants valides du CP au CE2_, CHU Bicêtre, septembre 2007 : http://www.geppe.free.fr/IMG/pdf/2007_09_-_LEFEVERE_G_GALBIATI_C_-_passation_reversal_test_-_valides_CP_CE1_CE2.pdf

---

### evic (EVIC)

**Corrigé le 2026-10-02** (migration `20261001100300_catalogue_corrections.sql`) : nom « EViC (Évaluation de la Vitesse de frappe au Clavier) », auteurs Lefévère et Galbiati (2007), mesure en MPM au lieu de « ERREURS ».

**Le nom et l'auteur du test en base sont faux.** La base indique « Évaluation de l'Écriture Infantile et Cursive » et l'auteur « Lurçat & Veispour ». L'EViC est en réalité l'**Évaluation de la Vitesse de frappe au Clavier**, de G. Lefévère et C. Galbiati (unité de rééducation neuropsychologique infantile du CHU du Kremlin-Bicêtre, 2007). Le référentiel Occitadys la cite ainsi. Aucune source n'a été trouvée pour « Lurçat & Veispour ».

| id                 | nom        | verdict                                                                                                                                                                                                                                        |
| ------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| evic\_\_copie      | Copie      | **RÉEL** : épreuve de copie (5 min) au clavier. **Mais la mesure est fausse** : `rawValueLabel` vaut « ERREURS », alors que le protocole mesure une **vitesse** (caractères espaces compris, puis MPM = C / 30). Il ne compte pas les erreurs. |
| evic\_\_dictee     | Dictée     | **RÉEL** : dictée (5 min), mesurée en MPM (C / 30). Même remarque sur « ERREURS ».                                                                                                                                                             |
| evic\_\_repetition | Répétition | **RÉEL** : répétition du mot « lames » (3 min), mesurée en MPM (nombre de mots / 3). Même remarque.                                                                                                                                            |

**Manquants** : aucun sous-test chiffré. La fiche contient aussi des observations qualitatives : doigts utilisés, séparation du clavier en deux moitiés, stratégie de copie lettre à lettre, mot à mot ou phrase à phrase, usage excessif de la touche Suppr. Elle rappelle pour référence la vitesse manuscrite (BHK et Lespargot).

**Échelle** : `none`. Le document n'a pas d'étalonnage, ce qui est cohérent. L'unité « pts » est fausse : il faut **MPM** (mots par minute).

Sources :

- Lefévère et Galbiati, _EViC : consignes et feuille de passation_, février 2007 : http://www.geppe.free.fr/IMG/pdf/2007_02_-_LEFEVERE_GWENAELLE_-_EViC_consignes_et_feuille_passation.pdf
- Occitadys, _Listing des outils d'évaluation, ergothérapie_ : https://occitadys.fr/images/Docs/referentiel-ergotherapie.pdf

---

### charlop-atwell (Échelle de coordinations motrices de Charlop-Atwell, 1980, adaptation française d'Albaret et Noack 1994)

| id                                | nom             | verdict                                                                                                                                                                              |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| charlop-atwell\_\_score-objectif  | Score objectif  | **RÉEL** : « objective subtest based on accuracy of performance » (Charlop et Atwell 1980) ; score objectif du manuel français.                                                      |
| charlop-atwell\_\_score-subjectif | Score subjectif | **RÉEL** : « subjective subtest, based on quality of performance ».                                                                                                                  |
| charlop-atwell\_\_score-total     | Score total     | **RÉEL** : la fiche de notation française donne un score objectif, un score subjectif et un score total. Moyennes de 4 à 6 ans : objectif 21 à 31, subjectif 20 à 26, total 42 à 57. |

**Manquants** : aucun score global. Les 6 items (pantin, saut avec demi-tour, cloche-pied, animal préhistorique, moulinets avec foulards, équilibre sur la pointe des pieds) pourraient être saisis à part si Titouan le souhaite. Ce n'est pas obligatoire.

Sources :

- Charlop et Atwell (1980), _Percept. Mot. Skills_ 50:1291-1308 : https://pubmed.ncbi.nlm.nih.gov/7413401
- Albaret et Noack, manuel français (Université Toulouse III) : https://medecine.univ-tlse3.fr/medias/fichier/maneul-de-l-echelle-de-coordination-motrice-de-charlopt-atwell_1594281518798-pdf?ID_FICHE=1002474&INLINE=FALSE et https://medecine.univ-tlse3.fr/medias/fichier/echelle-de-coordinations-motrices-de-charlop-atwell_1594037824470-pdf?ID_FICHE=1002474&INLINE=FALSE (contenu cité d'après l'extrait de recherche)

---

### espargot (test des « lenteurs de l'écriture » de Lespargot, Marquet-Guillois et Truscelli 1981, réétalonnage d'Alexandre 2007)

Le protocole comprend trois épreuves : « dictée et copie d'un texte et écriture répétitive d'un même mot », de 5 minutes chacune. Il y a quatre textes selon le niveau scolaire. La vitesse se mesure en **lettres par minute**.

**Corrigé le 2026-10-02** (migration `20261001100300_catalogue_corrections.sql`) : vitesse en lettres par minute au lieu de « SEC. ». L'échelle (`scaled`, non vérifiée) reste ouverte.

| id                                   | nom        | verdict   |
| ------------------------------------ | ---------- | --------- |
| espargot_repetition_repetit_58163a62 | Répétition | **RÉEL**. |
| espargot_dictee_dictee_58163a62      | Dictée     | **RÉEL**. |
| espargot_copie_copie_58163a62        | Copie      | **RÉEL**. |

**Manquants** : aucun.

**Remarques** :

- `rawValueLabel` vaut « SEC. » (secondes), alors que la mesure est une vitesse en lettres par minute (ou lettres en 5 minutes). Les sources contredisent ce libellé.
- `score_type` vaut `scaled`. Non vérifié : je n'ai pas eu accès à la forme des normes d'Alexandre (2007), ni à leur éventuelle conversion en notes standard.
- Le nom du test en base est « Lespargot », mais l'id `espargot` est tronqué. Ce n'est pas bloquant.

Sources :

- SOS-Écriture, _Les élèves écrivent-ils réellement plus vite aujourd'hui ?_ (description du test de Lespargot, Marquet-Guillois et Truscelli) : http://www.sos-ecriture.fr/2019/03/les-eleves-ecrivent-ils-reellement-plus.html
- GEPPE, Alexandre A., textes du bilan « Les lenteurs de l'écriture », réétalonnage paru dans _ergOThérapies_ n° 27 (2007) : http://www.geppe.free.fr/article.php3?id_article=174
- Occitadys (N = 626, auteurs Lespargot et Alexandre) : https://occitadys.fr/images/Docs/referentiel-ergotherapie.pdf

---

### ozeretzki (« Découpage d'Ozeretzki »)

**Non vérifié dans l'ensemble.** Je n'ai trouvé aucune fiche de cotation publiée de l'épreuve de découpage d'Ozeretski telle que l'utilisent les ergothérapeutes français. La tradition Oseretsky (Lincoln-Oseretsky, puis Bruininks-Oseretsky) contient bien un item « cutting out a circle with **preferred hand** ». Un rapport de psychomotricité toulousain cite le « découpage des cercles d'Oseretsky ».

| id                                    | nom                                    | verdict                                                                                                                                                                                                                      |
| ------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ozeretzki\_\_decoupage-cercle         | Temps de découpage, main dominante     | **Non vérifié** : l'item existe avec la main préférée ; la cotation par le temps n'est pas confirmée.                                                                                                                        |
| ozeretzki\_\_temps-main-non-dominante | Temps de découpage, main non dominante | **DOUTEUX, probablement inventé** : dans les versions trouvées, l'item de découpage se fait avec la main préférée seulement. Aucune source ne décrit un découpage avec la main non dominante. À faire confirmer par Titouan. |
| ozeretzki\_\_decoupage-qualite        | Qualité de découpage                   | **Non vérifié** : plausible, car le Bruininks-Oseretsky cote la précision (écarts au trait), mais aucune fiche ne le confirme pour la version française.                                                                     |

Sources :

- Buros, _Lincoln-Oseretsky Motor Development Scale_ : https://marketplace.unl.edu/buros/test-reviews/alphabetical-list/lincoln-oseretsky-motor-development-scale-the.html
- Sloan (1955), PubMed : https://pubmed.ncbi.nlm.nih.gov/13251453/
- Rapport de bilan psychomoteur, Université Toulouse III : https://medecine.univ-tlse3.fr/medias/fichier/bilan-psychomoteur_1594283229691-pdf?ID_FICHE=1002474&INLINE=FALSE (« découpage des cercles d'Oseretsky », cité d'après l'extrait de recherche)

---

### tihm (Test of In-Hand Manipulation, Case-Smith 2000)

Définition du test (Pont, Wallen, Bundy et Case-Smith 2008, AJOT) : « a five-task test that uses a 9-hole pegboard to examine **2 key components** of in-hand manipulation: **rotation and translation with stabilization** … The test does not examine all aspects of in-hand manipulation ». Cotation : critères de temps, de chutes, de stabilisations et de qualité (Tiffin-Richards et al. 2014, qui citent le test). Dans la tâche de rotation, l'enfant retourne des chevilles à 180° du bout des doigts, ce qui est une rotation complexe. Dans les tâches de translation, il prend des chevilles dans la paume puis les replace.

| id                               | nom                                   | verdict                                                                                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tihm\_\_translation              | Translation doigts vers paume         | **DOUTEUX** : la translation fait partie du test, mais le TIHM la cote par tâche chronométrée (translation avec stabilisation), pas comme deux composantes séparées. L'article souligne même une « limited sensitivity to … finger-to-palm and palm-to-finger translation ». |
| tihm\_\_translation-paume-doigts | Translation paume vers doigts         | **DOUTEUX** : même remarque.                                                                                                                                                                                                                                                 |
| tihm\_\_shift                    | Shift (translation linéaire digitale) | **Corrigé le 2026-10-02** (migration `20261001100300_catalogue_corrections.sql`) : retiré. **INVENTÉ** : le TIHM n'examine que la rotation et la translation avec stabilisation. Le « shift » appartient à la taxonomie d'Exner, pas à ce test.                              |
| tihm\_\_rotation                 | Rotation simple                       | **Corrigé le 2026-10-02** (migration `20261001100300_catalogue_corrections.sql`) : retiré. **INVENTÉ** : la rotation du TIHM consiste à retourner une cheville à 180°, ce qui est une rotation complexe. La rotation simple n'est pas une tâche du test.                     |
| tihm\_\_rotation-complexe        | Rotation complexe                     | **RÉEL** : la tâche de rotation des chevilles.                                                                                                                                                                                                                               |

**Manquants** :

- **temps par tâche** (les 5 tâches chronométrées) ;
- éventuellement **chutes** et **stabilisations**.

Le libellé exact des 5 tâches est dans le manuel, que je n'ai pas eu : non vérifié. **Conclusion** : les sous-tests en base suivent la taxonomie d'Exner (translation, shift, rotation simple ou complexe), pas la structure du TIHM.

Sources :

- Pont et al. (2008), AJOT 62(4):384-392 : https://pubmed.ncbi.nlm.nih.gov/18712001/
- Tiffin-Richards et al. (2014), SAJOT (description des tâches du TIHM) : https://scielo.org.za/scielo.php?script=sci_arttext&pid=S2310-38332014000200006

---

### purdue-pegboard (Purdue Pegboard, Tiffin 1948, Lafayette)

Le test donne « Five separate test scores … right hand; left hand; both hands; right plus left plus both hands; and assembly ». Les trois premières épreuves durent 30 s, l'assemblage 60 s.

| id                            | nom                                | verdict                                             |
| ----------------------------- | ---------------------------------- | --------------------------------------------------- |
| purdue\_\_dominant            | Main dominante (30 s)              | **RÉEL** : l'enfant commence avec la main préférée. |
| purdue\_\_non-dominant        | Main non dominante (30 s)          | **RÉEL**.                                           |
| purdue\_\_bilateral           | Deux mains (30 s)                  | **RÉEL**.                                           |
| purdue\_\_assembly            | Assemblage (60 s)                  | **RÉEL**.                                           |
| purdue\_\_right-left-both-sum | Somme droite + gauche + deux mains | **RÉEL**.                                           |

**Manquants** : aucun.

**Remarque** : les normes sont données par main droite et main gauche, pas par main dominante et main non dominante. C'est un détail de présentation, sans erreur de contenu.

Sources :

- StrokEngine, Purdue Pegboard Test : https://strokengine.ca/en/assessments/purdue-pegboard-test-ppt/
- Manuel Lafayette 32020A : https://www.limef.com/downloads/MAN-32020A-forpdf-rev0.pdf

---

### jebsen-taylor (Jebsen-Taylor Hand Function Test, 1969)

Le test comprend 7 sous-tests, « performed on both non-dominant and dominant hands ». Chaque score est un temps en secondes, plafonné à 120 s. Le score total est la somme des temps.

| id                             | nom                    | verdict                                     |
| ------------------------------ | ---------------------- | ------------------------------------------- |
| jebsen-taylor\_\_feeding       | Alimentation simulée   | **RÉEL**.                                   |
| jebsen-taylor\_\_writing       | Écriture               | **RÉEL**.                                   |
| jebsen-taylor\_\_checkers      | Empilement de jetons   | **RÉEL**.                                   |
| jebsen-taylor\_\_large-light   | Grands objets légers   | **RÉEL** (boîtes vides).                    |
| jebsen-taylor\_\_large-heavy   | Grands objets lourds   | **RÉEL** (boîtes lestées à 1 lb).           |
| jebsen-taylor\_\_small-objects | Petits objets communs  | **RÉEL**.                                   |
| jebsen-taylor\_\_card-turning  | Retournement de cartes | **RÉEL** (simulation de tourner des pages). |

**Manquants** :

- **La séparation par main** : chaque sous-test se passe main non dominante d'abord, puis main dominante. La base n'a qu'une valeur par sous-test.
- **Le score total** (somme des temps).

**Ordre** : l'ordre du protocole est écriture, cartes, petits objets, alimentation simulée, jetons, objets légers, objets lourds. En base, l'alimentation simulée vient en premier.

Source : Shirley Ryan AbilityLab, Rehabilitation Measures, Jebsen-Taylor : https://www.sralab.org/rehabilitation-measures/jebsen-taylor-hand-function-test

---

### grip-strength (Force de préhension, Jamar)

Normes pédiatriques de Mathiowetz et al. (1986), 6 à 19 ans : quatre mesures, la préhension au dynamomètre **Jamar**, puis les pinces **tip**, **key** et **palmar** au **pinch gauge**.

| id                             | nom                | verdict                                                                    |
| ------------------------------ | ------------------ | -------------------------------------------------------------------------- |
| grip-strength\_\_dominant      | Main dominante     | **RÉEL**.                                                                  |
| grip-strength\_\_non-dominant  | Main non dominante | **RÉEL**.                                                                  |
| grip-strength\_\_pinch-lateral | Pince latérale     | **RÉEL** (key pinch), mais la mesure se fait au pinch gauge, pas au Jamar. |
| grip-strength\_\_pinch-tip     | Pince pulpaire     | **RÉEL** (tip pinch), au pinch gauge.                                      |
| grip-strength\_\_pinch-three   | Tripode (3 doigts) | **RÉEL** (palmar pinch ou three-jaw chuck), au pinch gauge.                |

**Manquant** : les normes de pince sont données **par main**, droite et gauche. La base n'a qu'une valeur par pince, sans préciser la main.

**Remarque sur le nom** : le test s'appelle « (Jamar) », alors que trois sous-tests sur cinq se mesurent avec un autre appareil, le pinch gauge. C'est un point de libellé.

Sources :

- Mathiowetz, Wiemer et Federman (1986), _Grip and pinch strength: norms for 6- to 19-year-olds_, AJOT 40(10):705-711 : https://pubmed.ncbi.nlm.nih.gov/3777107/
- Même article, sur le site de l'AOTA : https://research.aota.org/ajot/article/40/10/705/1551/Grip-and-Pinch-Strength-Norms-for-6-to-19-Year

## Vérification du catalogue, lot B (issue #50)

Base lue le 2026-09-30, en lecture seule (`official_subtests`, `organization_id is null`). Rappel des échelles de l'app (docs/SCORING_CATALOG.md §4) : `scaled` = NS m=10 σ=3 ; `standard` = m=100 σ=15 ; `t-score` = m=50 σ=10 ; il n'existe **pas** d'échelle m=15 σ=5.

Légende : **RÉEL** = existe dans le protocole publié ; **INVENTÉ** = absent du protocole ; **DOUTEUX** = existe en partie, mal nommé, fusionné, mal rangé ou non coté dans le test.

Synthèse : aucun sous-test franchement inventé dans ce lot, au sens du cas « hémichamp » des Cloches. Les défauts sont structurels : BOT-2 est saisi au niveau des items et non des sous-tests, il manque des composites (DTVP-3, DTVP-A, PDMS-2, BOT-2, Frostig), l'EGP a des items fusionnés ou éclatés, et le MVPT-4 a des domaines sans norme.

---

### mabc-2 (MABC-2, ECPA 2016)

Source principale : fiche officielle Pearson France « MABC-2 vs MABC-3 » (liste des 8 tâches par groupe d'âge, noms français).

| id                                                               | Verdict                                                                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| coin-pref, coin-non-pref (Tirelire)                              | RÉEL : GA1 DM1 « Mettre des jetons dans une tirelire » (mains préférée et non préférée).                                               |
| bead-threading (Enfiler les cubes)                               | RÉEL : GA1 DM2 « Enfiler des cubes ».                                                                                                  |
| trail-band1                                                      | RÉEL : GA1 DM3 « Suivre le Trajet 1 ».                                                                                                 |
| catch-bag                                                        | RÉEL : GA1 VA1 « Attraper le sac lesté ».                                                                                              |
| throw-bag                                                        | RÉEL : GA1 VA2 « Lancer le sac lesté sur le tapis ».                                                                                   |
| balance-one-leg-best / -other                                    | RÉEL : GA1 EQ1 « Se tenir en équilibre sur une jambe ».                                                                                |
| tiptoe-walk                                                      | RÉEL : GA1 EQ2 « Marcher sur la pointe des pieds ».                                                                                    |
| mat-jump (Sauter)                                                | RÉEL : GA1 EQ3 « Sauter sur les tapis ».                                                                                               |
| pegs-preferred / -non-preferred                                  | RÉEL : GA2 DM1 « Placer les chevilles ».                                                                                               |
| lacing                                                           | RÉEL : GA2 DM2 « Enfiler le lacet ».                                                                                                   |
| trail-band2                                                      | RÉEL : GA2 DM3.                                                                                                                        |
| catch-two-hands                                                  | RÉEL : GA2 VA1 « Attraper à deux mains ».                                                                                              |
| throw-bag-mat                                                    | RÉEL : GA2 VA2 « Lancer le sac lesté sur le tapis ».                                                                                   |
| balance-board-best / -other                                      | RÉEL : GA2 EQ1 « Se tenir en équilibre sur une planche ».                                                                              |
| heel-to-toe-forward                                              | RÉEL : GA2 EQ2 « Marcher talons-pointes en avant ».                                                                                    |
| hop-mat-one-leg / -other-leg                                     | RÉEL : GA2 EQ3 « Sauter à cloche-pied sur les tapis ». Le manuel parle de « meilleure jambe / autre jambe », pas de jambe préférée.    |
| pegs-flip / pegs-flip-non-pref                                   | RÉEL : GA3 DM1 « Retourner les chevilles ».                                                                                            |
| nuts-bolts                                                       | RÉEL : GA3 DM2 « Faire un triangle avec des écrous et des boulons ».                                                                   |
| trail-band3                                                      | RÉEL : GA3 DM3.                                                                                                                        |
| catch-one-hand / -non-pref                                       | RÉEL : GA3 VA1 « Attraper avec une main » (meilleure main / autre main).                                                               |
| throw-target                                                     | RÉEL : GA3 VA2 « Lancer la balle sur la cible ».                                                                                       |
| balance-two-boards                                               | RÉEL : GA3 EQ1 « Se tenir en équilibre sur deux planches ».                                                                            |
| heel-to-toe-backward                                             | RÉEL : GA3 EQ2 « Marcher talons-pointes à reculons ».                                                                                  |
| zigzag-hop                                                       | RÉEL : GA3 EQ3 « Sauter en zig-zag ». La tâche se fait sur chaque jambe (meilleure jambe / autre jambe) mais n'a qu'une ligne en base. |
| manual-dexterity-total, aiming-catching-total, balance-composite | RÉEL : notes standard des 3 composantes.                                                                                               |
| total-score                                                      | RÉEL.                                                                                                                                  |

**Manquant** : `zigzag-hop` pour l'autre jambe (GA3 EQ3), par symétrie avec `hop-mat-one-leg`/`-other-leg` en GA2. Les notes par item des tâches à deux mains ou deux jambes sont moyennées (PMC5983505).

**Échelle** : `total-score` est en `standard` (m=100). Or la note totale du test MABC-2 est une note standard m=10, σ=3, comme les items et les composantes (PMC5983505 : « component standard scores (CSS) and total standard scores (TS) … mean of 10, SD = 3 »). Elle devrait être en `scaled`.

**Remarque** : la MABC-3 (Pearson France, 2025 ; 10 tâches, groupes d'âge 3-6, 7-11, 12-25 ans) remplace la MABC-2. Le catalogue n'a que la MABC-2. Autre point sans lien avec la vérification : des `display_order` sont en double (12, 13, 19).

Sources :

- https://www.pearsonclinical.fr/mwdownloads/download/link/id/1872 (MABC-2 vs MABC-3, Pearson France)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC5983505/
- https://www.pearsonclinical.fr/mabc-2

---

### bot-2 (BOT-2, Pearson)

Structure officielle : 8 sous-tests, 53 items, 4 composites et une composite motrice totale. Les sous-tests donnent des **notes d'échelle m=15, σ=5**. Les composites donnent des **notes standard m=50, σ=10** (rapport type Pearson). Les items ne donnent que des points bruts, sans norme par item.

La base contient 19 lignes. Ce sont des **items** (parfois fusionnés), pas les 8 sous-tests. Plusieurs sont rangés dans le mauvais sous-test.

| id                                                    | Verdict                                                                                                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| coloring                                              | RÉEL (item) : « Filling in Shapes » (cercle, étoile), Fine Motor Precision.                                                                                                |
| copy-complex « Copie d'étoiles/figures complexes »    | DOUTEUX : fusion d'items de Fine Motor **Integration** (copier une étoile, des cercles superposés, des crayons superposés), rangée à tort dans « Précision motrice fine ». |
| copy-shapes « cercles, carrés, losanges »             | DOUTEUX : même problème (items de copie de FMI fusionnés, rangés en FMP).                                                                                                  |
| cutting                                               | RÉEL (item) : « Cutting Out a Circle », FMP.                                                                                                                               |
| folding                                               | RÉEL (item) : « Folding Paper », mais c'est un item de **FMP**, pas de l'intégration motrice fine où la base le range.                                                     |
| beads « Enfiler des perles »                          | RÉEL (item) : « Stringing Blocks » (des blocs, pas des perles), Manual Dexterity.                                                                                          |
| transfer                                              | RÉEL (item) : « Transferring Pennies », MD.                                                                                                                                |
| cards                                                 | RÉEL (item) : « Sorting Cards », MD.                                                                                                                                       |
| dribbling                                             | RÉEL (item) : Upper-Limb Coordination (dribble à une main, dribble en alternant les mains : 2 items).                                                                      |
| throw-catch « Lancer/Attraper »                       | DOUTEUX : fusion de plusieurs items d'ULC (lâcher et rattraper, rattraper une balle lancée à 1 ou 2 mains, lancer sur cible).                                              |
| finger-tapping « Tapoter doigts/pieds simultanément » | RÉEL (item) : « Tapping Feet and Fingers », qui relève de la **Bilateral Coordination**, alors que la base le range en « Coordination membres supérieurs ».                |
| jumping-jacks                                         | RÉEL (item) : Bilateral Coordination.                                                                                                                                      |
| side-hops                                             | RÉEL (item) : « One-legged / Two-legged Side Hop », qui relève de **Running Speed and Agility**, alors que la base le range en « Coordination bilatérale ».                |
| line-stand                                            | RÉEL (item) : « Standing on One Leg on a Line », Balance.                                                                                                                  |
| balance-beam « Poutre yeux ouverts/fermés »           | RÉEL (items fusionnés) : « Standing on One Leg on a Balance Beam, eyes open / eyes closed », Balance.                                                                      |
| shuttle-run                                           | RÉEL (item) : Running Speed and Agility.                                                                                                                                   |
| pushups, situps, broad-jump                           | RÉEL (items) : Strength (knee or full push-ups, sit-ups, standing long jump).                                                                                              |

**Manquants** :

- Les 8 sous-tests normés : Fine Motor Precision (7 items), Fine Motor Integration (8), Manual Dexterity (5), Upper-Limb Coordination (7), Bilateral Coordination (7), Balance (9), Running Speed and Agility (5), Strength (5).
- Les composites : Fine Manual Control, Manual Coordination, Body Coordination, Strength and Agility, Total Motor Composite.
- Items absents de la base : Drawing Lines through Paths, Connecting Dots, Making Dots in Circles, Placing Pegs, Stepping Sideways over a Balance Beam, One-legged Stationary Hop, Wall Sit, V-up, les items de marche sur ligne ou sur poutre, Touching Nose, Jumping in Place, Pivoting Thumbs and Index Fingers, etc.

**Échelle** : `scaled` (NS m=10, σ=3) sur des items est contredit par la source. Les items n'ont pas de note normée. Les sous-tests sont en m=15, σ=5, échelle absente de l'app. Les composites sont en m=50, σ=10, donc `t-score` dans l'app.

**Recommandation** : remplacer les 19 items par les 8 sous-tests et les 5 composites. Il faudra une échelle m=15/σ=5, ou `none` en attendant.

Sources :

- https://www.pearsonassessments.com/content/dam/school/global/clinical/us/assets/bot-2/bot-2-complete-form-sample-report.pdf (« Scale scores (mean = 15, standard deviation = 5) … Standard scores (mean = 50, standard deviation = 10) »)
- https://www.sralab.org/rehabilitation-measures/bruininks-oseretsky-test-motor-proficiency-second-edition (8 sous-tests et nombre d'items)
- https://www.otschoolhouse.com/single-post/ots-06 (items de FMP, FMI et MD)
- https://cdn-links.lww.com/permalink/mpg/c/mpg_2022_08_16_so_21-1075_sdc2.pdf (items de RSA et de Strength, via la recherche)

---

### pdms-2 (PDMS-2, Pro-Ed)

| id                                                                                        | Verdict                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| reflexes, stationary, locomotion, object-manipulation, grasping, visual-motor-integration | RÉEL : les 6 sous-tests. Reflexes ne concerne que les enfants de moins de 1 an ; Object Manipulation est administré à partir de 12 mois. |

**Manquants** : les quotients Gross Motor Quotient (GMQ), Fine Motor Quotient (FMQ) et Total Motor Quotient (TMQ), qui sont des quotients m=100, σ=15, donc `standard`.

**Échelle** : `scaled` convient (notes standard des sous-tests m=10, σ=3).

**Remarque** : les libellés sont en anglais. Le PDMS-3 (2023) existe.

Sources :

- https://www.sralab.org/rehabilitation-measures/peabody-developmental-motor-scales-second-edition
- https://proedinc.com/Downloads/13767_PDMS-2detail.pdf

---

### dcdq-f (DCDQ'07, version française)

| id                        | Verdict                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| controle-durant-mouvement | RÉEL : « Control During Movement », /30.                                                                                                          |
| motricite-fine-ecriture   | RÉEL : « Fine Motor/Handwriting », /20.                                                                                                           |
| coordination-globale      | RÉEL : « General Coordination », /25.                                                                                                             |
| total                     | RÉEL : total /75, avec des seuils par âge (5-7 ans : 15-46 = indication de TDC, 47-75 = probablement pas de TDC ; 8-9 ans : 56 ; 10-15 ans : 58). |

**Manquants** : aucun.

**Échelle** : `none` est correct (score brut à seuils).

Sources :

- https://www.dcdq.ca/uploads/pdf/DCDQAdmin-Scoring-02-20-2012.pdf
- https://onlinelibrary.wiley.com/doi/full/10.1111/j.1365-2214.2012.01425.x

---

### np-mot (NP-MOT, Vaivre-Douret, ECPA 2006)

| id                                                                                                                                      | Verdict                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tonus, motricit-globale, lat-ralit, praxies, gnosies-tactiles, habilet-oculo-manuelle, orientation-spatiale, rythme, attention-auditive | RÉEL : les 9 fonctions de la batterie : tonus, motricité globale (dynamique et statique), latéralité, praxies manuelles, gnosies tactiles digitales, habileté oculo-manuelle, orientation spatiale, rythme, attention auditive. |

**Manquants** : aucun au niveau des fonctions. Chaque fonction comporte des épreuves (par ex. tonus passif et actif) qui ne sont pas détaillées : non vérifié au niveau des épreuves.

**Remarque sans lien avec la vérification** : les id sont tronqués (`lat-ralit`, `habilet-…`, `motricit-…`).

Sources :

- https://www.pearsonclinical.fr/np-mot-batterie-devaluations-des-fonctions-neuro-psychomotrices-de-lenfant
- https://www.sciencedirect.com/science/article/abs/pii/S0987705319302643

---

### manos-3 (Man.O.S 3.0, ANFE)

Man.O.S 3.0 fusionne le Man.O.S (Lefévère-Renard, 2012, CE1-CM1) et le Man.O.S 2.0 (Hamdi Bourgois, 2021, CM2-6e).

| id                                                                               | Verdict                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| taille-crayon, gomme, ciseaux, colle, compas, equerre (manipulation et résultat) | RÉEL : épreuves communes, avec deux scores par épreuve (manipulation et résultat).                                                                                             |
| regle-souligner, regle-construire « CE1/CE2 »                                    | RÉEL : règle du Man.O.S initial (« un exercice de soulignement et un autre de construction »). Le libellé « CE1/CE2 » n'est pas vérifié : l'étalonnage initial couvre CE1-CM1. |
| regle-relier, regle-mesurer « CM2/6e »                                           | RÉEL : règle du Man.O.S 2.0 (« relier 2 points et mesurer »).                                                                                                                  |
| rapporteur « 6e »                                                                | RÉEL : sixième uniquement.                                                                                                                                                     |
| total-manipulation, total-resultat                                               | RÉEL : l'étalonnage porte sur les notes globales de manipulation et de résultat.                                                                                               |
| temps                                                                            | RÉEL : tâches chronométrées dans le 2.0.                                                                                                                                       |

**Manquants** : aucun identifié. Le manuel 3.0 est payant : le découpage exact par niveau n'est pas vérifié.

Sources :

- https://anfe.fr/wp-content/uploads/2022/02/Poster-JNE-Hamdi-Bourgeois-Test-MANOS-extension-et-etalonnage-aux-CM2-6eme.pdf (liste des épreuves, versions 1 et 2.0)
- https://anfe.fr/product/man-os-3-0/

---

### beery-vmi (Beery VMI 6)

| id                 | Verdict                     |
| ------------------ | --------------------------- |
| vmi                | RÉEL : test principal.      |
| visual-perception  | RÉEL : test complémentaire. |
| motor-coordination | RÉEL : test complémentaire. |

**Manquants** : aucun.

**Échelle** : `standard` (m=100, σ=15) est correct.

Sources :

- https://support.pearson.com/usclinical/s/article/Beery-VMI-Explain-the-Different-Tests-Offered
- https://www.pearsonassessments.com/en-us/Store/Professional-Assessments/Motor-Sensory/Beery-Buktenica-Developmental-Test-of-Visual-Motor-Integration-%7C-Sixth-Edition/p/100000663

---

### dtvp-2 (DTVP-2, Pro-Ed)

| id                                                                                                                      | Verdict                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| eye-hand, position-space, copying, figure-ground, spatial-relations, visual-closure, visual-motor-speed, form-constancy | RÉEL : les 8 sous-tests.                                                                                                  |
| quotient-gvp, quotient-mvpr, quotient-vmi                                                                               | RÉEL : les 3 quotients composites (General Visual Perception, Motor-Reduced Visual Perception, Visual-Motor Integration). |

**Remarque** : le libellé « Perception Motrice Réduite » traduit mal le nom. Il faut dire « Perception visuelle à motricité réduite ».

**Manquants** : aucun.

Sources :

- https://scielo.org.za/pdf/sajot/v42n2/06.pdf
- https://www.scribd.com/document/633239517/DTVP-2-Examiner-s-manual-pdf

---

### dtvp-3 (DTVP-3, Pro-Ed)

| id                                                                            | Verdict                  |
| ----------------------------------------------------------------------------- | ------------------------ |
| eye-hand-coordination, copying, figure-ground, visual-closure, form-constancy | RÉEL : les 5 sous-tests. |

**Manquants** : les 3 composites Visual-Motor Integration, Motor-Reduced Visual Perception et General Visual Perception (indices m=100, donc `standard`).

**Remarque** : les libellés sont en anglais.

Sources :

- https://www.sralab.org/rehabilitation-measures/developmental-test-visual-perception-third-edition
- https://www.proedinc.com/Products/13700/dtvp3-developmental-test-of-visual-perception--third-edition.aspx

---

### dtvp-a (DTVP-A, Pro-Ed)

| id                                                                                              | Verdict                  |
| ----------------------------------------------------------------------------------------------- | ------------------------ |
| copying, figure-ground, visual-motor-search, visual-closure, visual-motor-speed, form-constancy | RÉEL : les 6 sous-tests. |

**Manquants** : les indices General Visual Perception Index, Motor-Reduced Visual Perception Index (Figure-Ground, Visual Closure, Form Constancy) et Visual-Motor Integration Index (Copying, Visual-Motor Search, Visual-Motor Speed).

**Remarque** : la DTVP-A:2 (2e édition) existe.

Sources :

- https://www.wpspublish.com/dtvp-a-developmental-test-of-visual-perceptionadolescent-and-adult
- https://www.wpspublish.com/dtvp-a-2-developmental-test-of-visual-perception-adolescent-and-adult-second-edition.html

---

### frostig (Test de développement de la perception visuelle, Frostig, ECPA 1973)

| id                                                                                                       | Verdict                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| coordination-oculo-motrice, figure-fond, constance-de-forme, position-dans-l-espace, relations-spatiales | RÉEL : les 5 sous-tests (coordination visuo-motrice, discrimination figure-fond, constance de forme, positions dans l'espace, relations spatiales). |

**Manquant** : le quotient perceptif global (m=100, σ=15), donc `standard`.

Sources :

- https://www.libantestseditions.com/product.php?lang=fr&id=55
- https://www.libantestseditions.com/pdf/tests_fr/3db5b6fcef935912.pdf
- https://www.sudoc.fr/072806133

---

### mvpt-4 (MVPT-4, Academic Therapy / WPS)

| id                                                                                            | Verdict                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| score-total                                                                                   | RÉEL : le MVPT-4 ne fournit qu'**un seul score total** (45 items, score brut 0-45, converti en note standard).                                                                    |
| discrimination-visuelle, figure-fond, m-moire-visuelle, closure-visuelle, relations-spatiales | DOUTEUX : ce sont les 5 construits théoriques qui ont servi à construire les items, pas des sous-tests notés ou normés. Ils ne peuvent servir qu'à des observations qualitatives. |

**Manquants** : aucun.

Sources :

- https://www.sralab.org/rehabilitation-measures/motor-free-visual-perception-test-4
- https://www.theraplatform.com/blog/1000/motor-free-visual-perception-test-4-mvpt-4 (« provides clinicians with one total score »)

---

### figure-rey (Figure complexe de Rey, Rey 1959 ; Wallon et Mesmin, ECPA 2009)

La cotation porte, en copie comme en mémoire, sur le type de construction, la richesse et l'exactitude (18 éléments, /36) et la durée.

| id                      | Verdict                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| type-copie              | RÉEL.                                                                                                                                                                 |
| richesse-copie          | RÉEL (/36).                                                                                                                                                           |
| temps-copie             | RÉEL.                                                                                                                                                                 |
| reproduction-memoire    | DOUTEUX : c'est l'en-tête de la phase de mémoire, qui fait doublon avec les deux lignes suivantes.                                                                    |
| type-reproduction       | RÉEL.                                                                                                                                                                 |
| richesse-reproduction   | RÉEL.                                                                                                                                                                 |
| copie-modele (`scaled`) | DOUTEUX : semble faire doublon avec `richesse-copie` (score de copie). Aucune source ne donne de « copie du modèle » en NS m=10 : les normes de Rey sont en centiles. |

**Manquants** : non vérifié pour le temps de reproduction de mémoire. La figure B (enfants de 4 à 8 ans, Wallon et Mesmin) n'est pas dans le catalogue.

Sources :

- https://www.ergo-exercices.fr/blog/figure-de-rey-cotation-interpretation
- https://search.worldcat.org/title/800177870 (Wallon et Mesmin 2009, FCR-A et FCR-B)

---

### egp (Examen Géronto-Psychomoteur, Michel, Soppelsa, Albaret, Hogrefe)

Test pour les **plus de 60 ans**, à vérifier dans un catalogue pédiatrique. Il comporte 17 items notés chacun sur 6, pour un total de 102.

| id                                                | Verdict                                                                                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| equilibre-statique                                | DOUTEUX : le protocole a **2 items**, « Coordination statique I » et « Coordination statique II ».                                                                               |
| equilibre-dynamique                               | DOUTEUX : 2 items, « Coordination dynamique I » et « II ».                                                                                                                       |
| mobilisations-articulaires-ms / -mi               | RÉEL (items 5 et 6).                                                                                                                                                             |
| motricite-fine-ms / -mi                           | RÉEL (items 7 et 8).                                                                                                                                                             |
| praxies                                           | RÉEL (item 9).                                                                                                                                                                   |
| connaissance-parties-corps                        | RÉEL (item 10).                                                                                                                                                                  |
| vigilance                                         | RÉEL (item 11).                                                                                                                                                                  |
| memoire-perceptive                                | RÉEL (item 12).                                                                                                                                                                  |
| sphere-spatiale                                   | RÉEL (item 13).                                                                                                                                                                  |
| memoire-verbale                                   | RÉEL (item 14).                                                                                                                                                                  |
| perceptions                                       | RÉEL (item 15, « Perception »).                                                                                                                                                  |
| sphere-temporelle                                 | RÉEL (item 16).                                                                                                                                                                  |
| communication-verbale / communication-non-verbale | DOUTEUX : le protocole n'a qu'**un item** « 17. Communication ». Le découpage verbal / non verbal ne figure pas dans la liste des items : ce seraient au mieux des sous-parties. |
| score-global                                      | RÉEL (/102).                                                                                                                                                                     |

**Manquants** : la séparation Coordination statique I/II et Coordination dynamique I/II.

Sources :

- https://www.toulouse-brique.com/divers/Cecile/Bilan%202/10%20G%C3%A9rontopsychomotricit%C3%A9/EGP/Examen-G%C3%A9ronto-Psychomoteur.pdf (support d'enseignement, liste des 17 items et cotation /102)
- https://www.hogrefe.com/fr/shop/examen-geronto-psychomoteur.html
- https://www.researchgate.net/publication/319448265_Examen_Geronto_Psychomoteur_EGP

## Vérification du catalogue, lot C (issue #50)

Base lue en lecture seule (`official_subtests`, `organization_id is null`), le 30/09/2026. Verdicts :

- **RÉEL** : présent dans le protocole publié (source citée) ;
- **INVENTÉ** : absent du protocole ;
- **DOUTEUX** : existe peut-être, mais nom, forme ou doublon à revoir ;
- « non vérifié » : je n'ai pas trouvé de source.

---

### nepsy-2 (NEPSY-II, ECPA)

Référence : la version française compte 31 subtests répartis en 6 domaines (l'américaine en a 32 : « Body Part Naming » n'a pas été adapté). Sources [1] [2] [3].

| id                                                            | Verdict     | Commentaire                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| attention-auditive                                            | RÉEL        | Subtest « Attention auditive et réponses associées » [1] [3]. La partie **Réponses associées** manque (voir plus bas).                                                                                                                                                                                                                             |
| categorisation                                                | RÉEL        | Animal Sorting, appelé « Catégorisation » en français [1].                                                                                                                                                                                                                                                                                         |
| comprehension-de-consignes                                    | RÉEL        | [1] [3]                                                                                                                                                                                                                                                                                                                                            |
| copie-de-figures-processus-global / -local / -moteur / -total | RÉEL        | La cotation « Design Copying Process » donne une note étalonnée pour le total et pour les processus moteur, global et local [3]. L'ECPA cite « CFP Motricité / Global / Local » [2].                                                                                                                                                               |
| cubes                                                         | RÉEL        | [1] [2]                                                                                                                                                                                                                                                                                                                                            |
| denomination-rapide                                           | RÉEL        | [1] [3]                                                                                                                                                                                                                                                                                                                                            |
| **discrimination-digitale**                                   | **INVENTÉ** | **Corrigé le 2026-10-02** (migration `20261001100300_catalogue_corrections.sql`) : retiré. Finger Discrimination vient de la NEPSY de 1998 et a été **retirée** de la NEPSY-II : « Finger Discrimination has been dropped from the NEPSY–II » [3]. Elle ne figure pas non plus dans la liste française [1].                                        |
| fleches                                                       | RÉEL        | [1] [2]                                                                                                                                                                                                                                                                                                                                            |
| fluidite-de-dessin                                            | RÉEL        | [1] [2]                                                                                                                                                                                                                                                                                                                                            |
| imitation-de-positions-de-mains                               | RÉEL        | [1] [2]                                                                                                                                                                                                                                                                                                                                            |
| inhibition                                                    | DOUTEUX     | Le subtest existe [1] [3], mais on obtient les scores par condition (dénomination, inhibition, commutation), qui sont déjà en base [3]. Cette ligne générique fait doublon.                                                                                                                                                                        |
| inhibition-commutation / -denomination / -inhibition          | RÉEL        | [3]                                                                                                                                                                                                                                                                                                                                                |
| interference-de-liste-de-mots                                 | RÉEL        | [1] [3]                                                                                                                                                                                                                                                                                                                                            |
| memoire-de-figures-contenu / -spatial / -score-total          | RÉEL        | Memory for Designs : « spatial and content memory » [3]                                                                                                                                                                                                                                                                                            |
| memoire-de-figures-differee-contenu / -spatial / -score-total | RÉEL        | Memory for Designs Delayed [3]. Je n'ai pas vérifié que la version différée se décompose aussi en contenu et spatial.                                                                                                                                                                                                                              |
| memoire-de-liste / memoire-de-liste-differee                  | RÉEL        | List Memory / List Memory Delayed [3]. Absents de la liste française abrégée [1] (qui cite une « Mémoire de liste de mots ») : à confirmer dans le manuel ECPA.                                                                                                                                                                                    |
| memoire-des-prenoms / memoire-des-prenoms-differee            | RÉEL        | Memory for Names / Delayed [1] [3]                                                                                                                                                                                                                                                                                                                 |
| memoire-des-prenoms-total-combine                             | DOUTEUX     | Non vérifié : les sources consultées ne mentionnent pas de note combinant le rappel immédiat et le rappel différé.                                                                                                                                                                                                                                 |
| memoire-des-visages / memoire-des-visages-differee            | RÉEL        | [3]. La note combinée de la NEPSY de 1998 a été retirée, ce qui confirme qu'il faut bien deux lignes.                                                                                                                                                                                                                                              |
| memoire-narrative                                             | RÉEL        | [1] [3]                                                                                                                                                                                                                                                                                                                                            |
| phonologie                                                    | RÉEL        | « Processus phonologiques » [1] [3]                                                                                                                                                                                                                                                                                                                |
| **precision-motrice**                                         | **INVENTÉ** | **Corrigé le 2026-10-02** (migration `20261001100300_catalogue_corrections.sql`) : retiré. Aucun subtest de ce nom dans la NEPSY-II. Le domaine sensorimoteur compte seulement Tapping, Imitation de positions de mains, Séquences motrices manuelles et Précision visuomotrice [1] [3]. Cette ligne fait doublon avec « Précision visuomotrice ». |
| precision-visuomotrice (note composite)                       | RÉEL        | Combined score de Visuomotor Precision [3]                                                                                                                                                                                                                                                                                                         |
| pv-duree-execution                                            | RÉEL        | « scaled score for total completion time » [3]                                                                                                                                                                                                                                                                                                     |
| pv-score-erreurs / pv-levers-crayon                           | RÉEL        | « percentile ranks for total errors and total pencil lifts » [3]                                                                                                                                                                                                                                                                                   |
| production-de-mots                                            | RÉEL        | Word Generation [1] [3]                                                                                                                                                                                                                                                                                                                            |
| reconnaissance-des-affects                                    | RÉEL        | [1] [3]                                                                                                                                                                                                                                                                                                                                            |
| repetition-de-phrases                                         | RÉEL        | [1] [3] (âges 3 à 6 ans seulement)                                                                                                                                                                                                                                                                                                                 |
| repetition-de-pseudo-mots                                     | RÉEL        | [1] [3]                                                                                                                                                                                                                                                                                                                                            |
| sequences-motrices-manuelles                                  | RÉEL        | [1] [3]                                                                                                                                                                                                                                                                                                                                            |
| sequences-oro-motrices                                        | RÉEL        | [1] [3]                                                                                                                                                                                                                                                                                                                                            |
| statue                                                        | RÉEL        | [1] [3] (âges 3 à 6 ans)                                                                                                                                                                                                                                                                                                                           |
| tapotement-des-doigts                                         | RÉEL        | Fingertip Tapping. Le nom français ECPA est « Tapping » (répétitif et séquentiel) [2] : le libellé est à corriger.                                                                                                                                                                                                                                 |
| theorie-de-lesprit                                            | RÉEL        | [1] [3]                                                                                                                                                                                                                                                                                                                                            |

**Manquants (réels) :**

- **Horloges** (Clocks) [1] [2] [3]
- **Puzzles géométriques** [1] [2] [3]
- **Puzzles d'images** [1] [2] [3]
- **Orientation** (Route Finding) [1] [2] [3]
- **Réponses associées**, deuxième tâche d'Attention auditive, qui a sa propre note : « scores are provided separately for Auditory Attention and for Response Set » [3]

**Échelle :** `memoire-narrative` est en `none`, mais le manuel indique une note étalonnée pour le rappel libre et indicé (« a single scaled score combining performance across both free and cued recall ») [3].

Sources :

1. Recherche de synthèse : listes des 31 subtests, par exemple https://www.cairn.info/le-bilan-avec-la-nepsy-ii--9782100788088-page-55.htm et https://lebilanpsychologique.com/nepsy-ii (ce dernier site est peu fiable, je ne l'utilise pas comme preuve)
2. ECPA/Pearson France, « La NEPSY-II dans le bilan psychomoteur » : https://www.pearsonclinical.fr/mwdownloads/download/link/id/930
3. Pearson, NEPSY-II Clinical and Interpretive Manual, chap. 2 « Design and Purpose » : https://www.pearsonclinical.ca/content/dam/school/global/clinical/us/assets/nepsy-ii/nepsy-ii-design-and-purpose.pdf

---

### tea-ch (TEA-Ch, ECPA)

Référence : la version française compte 9 épreuves : Recherche dans le ciel, Coups de fusil, Les petits hommes verts, Faire deux choses à la fois, Carte géographique, Écouter deux choses à la fois, Marche-Arrête, Mondes contraires, Transmission de codes [1].

| id                | Verdict | Commentaire                   |
| ----------------- | ------- | ----------------------------- |
| sky-search        | RÉEL    | Recherche dans le ciel        |
| score             | RÉEL    | Coups de fusil                |
| score-dual-task   | RÉEL    | Écouter deux choses à la fois |
| walk-don-t-walk   | RÉEL    | Marche-Arrête                 |
| code-transmission | RÉEL    | Transmission de codes         |
| creature-counting | RÉEL    | Les petits hommes verts       |
| map-mission       | RÉEL    | Carte géographique            |
| opposite-worlds   | RÉEL    | Mondes contraires             |

**Manquant :** **Faire deux choses à la fois** (Sky Search DT) [1].

**Remarque :** les libellés sont en anglais alors que la version utilisée en France a ses noms français [1].

Source : https://www.pearsonclinical.fr/tea-ch-test-devaluation-de-lattention-chez-lenfant

---

### wisc-v (WISC-V, ECPA)

Référence : 15 subtests, dont 10 principaux et 5 secondaires [1]. Les secondaires sont Information, Compréhension, Arithmétique, Séquence lettres-chiffres et Barrage [2].

| id                                                                                                                             | Verdict                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| similitudes, vocabulaire, cubes, puzzles-visuels, matrices, balances, m-moire-des-chiffres, m-moire-des-images, code, symboles | RÉEL : ce sont les 10 subtests principaux [1] [2] |

**Manquants :**

- **Subtests secondaires** : Information, Compréhension, Arithmétique, Séquence lettres-chiffres, Barrage [2].
- **Indices** : ICV, IVS, IRF, IMT, IVT et QIT [2] ; indices supplémentaires IRQ, IMTA, INV, IAG et ICC [2]. Ce sont des notes composites, pas des subtests : à ajouter si le catalogue doit porter les indices.

Sources :

1. https://www.pearsonclinical.fr/presentation/wisc5
2. Tableau récapitulatif des indices et subtests du WISC-V français : https://kidzetfamily.fr/wp-content/uploads/WISC-pdf-1.pdf (source secondaire, qui concorde avec la structure Pearson : https://support.pearson.com/usclinical/s/article/WISC-V-Subtests-and-the-Scales-Primary-Ancillary-and-Complementary-Indexes)

---

### brief-2 (BRIEF-2, Hogrefe, adaptation française de 2025)

Référence : les formes Parent et Enseignant comptent 9 échelles cliniques (Inhibit, Self-Monitor, Shift, Emotional Control, Initiate, Working Memory, Plan/Organize, Task-Monitor, Organization of Materials), 3 indices (BRI, ERI, CRI) et le GEC [1] [2]. La forme auto-évaluation compte 7 échelles et remplace Initiate, Task-Monitor et Organization of Materials par Task Completion [2]. Noms français : Inhibition, Contrôle de soi, Flexibilité, Contrôle émotionnel, Initiation, Mémoire de travail, Planification/Organisation, Contrôle de la tâche, Organisation du matériel ; indices de régulation comportementale, émotionnelle et cognitive ; score composite exécutif global [3].

| id                                                                                                                               | Verdict | Commentaire                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| inhibit, self-monitor, shift, emotional-control, initiation, working-memory, plan-organize, task-monitor, organization-materials | RÉEL    | [1] [3]                                                                                                                                     |
| task-completion                                                                                                                  | DOUTEUX | Échelle réelle, mais propre à la forme **auto-évaluation** [2]. Mélangée aux échelles Parent/Enseignant, elle ne correspond à aucune forme. |
| bri, eri, cri, gec                                                                                                               | RÉEL    | [1] [3]                                                                                                                                     |
| negativity, inconsistency, infrequency                                                                                           | RÉEL    | Échelles de validité [1]. La version française mentionne explicitement « Rareté » (Infrequency) [3].                                        |

**Manquants :** aucun pour la forme hétéro-évaluation.

**Échelle :** les trois échelles de validité sont en `t-score`, ce qui est **faux**. « T scores are not generated for the Inconsistency scale », et de même pour Negativity et Infrequency [1]. Elles se notent en score brut avec une classification (Acceptable, Questionable, etc.).

**Remarque :** les libellés sont en anglais alors que Hogrefe publie des noms français [3].

Sources :

1. PAR, rapport d'interprétation type, forme Parent : https://www.parinc.com/docs/default-source/product-resources/brief2-parent-form-interpretive-report-sample-(002).pdf
2. PAR, présentation de la BRIEF-2 : https://www.parinc.com/products/BRIEF-2
3. Hogrefe France, fiche BRIEF-2 : https://www.hogrefe.com/fr/shop/media/downloads/sample-reports/FRA5605311_p.pdf et https://www.hogrefe.com/fr/shop/inventaire-d-evaluation-comportementale-des-fonctions-executives.html

---

### profil-sensoriel-2 (Profil Sensoriel 2, ECPA)

Référence : rapport de résultats officiel du PS2 Enfant [1].

- Quadrants : Recherche, Évitement, Sensibilité, Enregistrement.
- Sections sensorielles : Traitement auditif, visuel, tactile, relatif au mouvement, relatif à la position du corps, sensoriel oral.
- Sections comportementales : Conduites, Réponses socio-émotionnelles, Réponses attentionnelles.

| id                                                     | Verdict  |
| ------------------------------------------------------ | -------- |
| seeking, avoiding, sensitivity, registration           | RÉEL [1] |
| auditory, visual, touch, movement, body-position, oral | RÉEL [1] |

**Manquants :**

- **Conduites**, **Réponses socio-émotionnelles**, **Réponses attentionnelles** (sections comportementales) [1].
- Facteurs scolaires : seulement avec le questionnaire scolaire, qui est une forme distincte. Non vérifié en détail.

Source : ECPA, exemple de rapport PS2 Enfant : https://www.pearsonclinical.fr/mwdownloads/download/link/id/1575

---

### spm (Sensory Processing Measure / SPM-2, WPS)

Référence : Social Participation, Vision, Hearing, Touch, Taste and Smell, Body Awareness, Balance and Motion, Planning and Ideas, plus le total des systèmes sensoriels [1] [2].

| id                                                                                                                          | Verdict      |
| --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| social-participation, vision, hearing, touch, body-awareness, balance-and-motion, planning-and-ideas, total-sensory-systems | RÉEL [1] [2] |

**Manquant :** **Taste and Smell** (goût et odorat) [1] [2].

**Échelle :** toutes les lignes sont en `none`, alors que chaque échelle se convertit en **note T** (moyenne 50, écart-type 10) avec les zones typique, difficultés modérées et difficultés sévères [2].

Sources :

1. WPS : https://www.wpspublish.com/spm-2
2. Shirley Ryan AbilityLab, RehabMeasures « Sensory Processing Measure » : https://www.sralab.org/rehabilitation-measures/sensory-processing-measure

---

### vineland-3

Référence : domaines Communication, Vie quotidienne (Daily Living Skills), Socialisation et Motricité (facultative, jusqu'à 9 ans), plus l'ABC. Le comportement inadapté (Maladaptive Behavior) donne des échelles Internalisé et Externalisé en notes v (moyenne 15, écart-type 3), ainsi que des items critiques [1].

| id                                                                                           | Verdict | Commentaire                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| adaptive-behavior-composite, communication, daily-living-skills, socialization, motor-skills | RÉEL    | [1]                                                                                                                                                                                                                                       |
| maladaptive-behavior                                                                         | DOUTEUX | La section existe, mais elle n'a pas de note standard de domaine : on obtient un indice de comportement inadapté (facultatif) et des notes v Internalisé et Externalisé [1]. Elle est classée en `standard` avec les domaines adaptatifs. |

**Manquants :**

- Sous-domaines (notes v) : Réceptif, Expressif, Écrit ; Personnel, Domestique, Communauté ; Relations interpersonnelles, Jeu et loisirs, Adaptation ; Motricité fine, Motricité globale [1].
- Internalisé et Externalisé [1].

**Remarque :** en France, l'ECPA publie la **Vineland-II**. La Vineland-3 n'existe qu'en français canadien (CDN-F, 2022) ; l'adaptation pour la France était en cours d'étalonnage en 2024-2025 [2]. Il faut vérifier que c'est bien la version voulue.

Sources :

1. Pearson, rapport type Vineland-3 (formulaire d'entretien complet) : https://www.pearsonassessments.com/content/dam/school/global/clinical/us/assets/vineland-3/vineland-3-comprehensive-interview-form-sample-report.pdf
2. https://cote-a-cote-inclusion.com/outils/vineland-3-echelle-devaluation-du-comportement-socio-adaptatif/ et https://www.pearsonclinical.fr/vineland-ii-echelle-devaluation-du-comportement-socio-adaptatif-de-vineland

---

### pedi-cat

| id                                                           | Verdict                           |
| ------------------------------------------------------------ | --------------------------------- |
| daily-activities, mobility, social-cognitive, responsibility | RÉEL : ce sont les 4 domaines [1] |

**Manquants :** aucun.

**Remarque sur l'échelle :** l'outil fournit des notes normatives (percentiles et notes T, moyenne 50, écart-type 10) et des notes critériées (échelle de 20 à 80) [1]. Le choix de `none` peut se défendre si l'on saisit la note critériée ; si c'est la note normative qui est saisie, l'échelle adaptée est la note T.

Source : https://www.sralab.org/rehabilitation-measures/pediatric-evaluation-disability-inventory-computer-adaptive-test

---

### copm

| id                        | Verdict                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| performance, satisfaction | RÉEL : moyennes de 1 à 10 sur au plus 5 problèmes prioritaires [1] |

**Manquants :** aucun. L'importance (1 à 10) sert à choisir les problèmes et ne donne pas de score.

Source : https://www.sralab.org/rehabilitation-measures/canadian-occupational-performance-measure

---

### amps

| id                     | Verdict                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| adl-motor, adl-process | RÉEL : mesures d'habileté motrice et opératoire en AVQ, en logits (seuils de 2,0 et 1,0) [1] |

**Manquants :** aucun.

Source : https://strokengine.ca/en/assessments/assessment-of-motor-and-process-skills-amps/

---

### lotca

| id                                                                                                                         | Verdict                                               |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| orientation, perception-visuelle, perception-spatiale, praxies-motrices, organisation-visuo-motrice, op-rations-cognitives | RÉEL : ce sont les 6 domaines de la LOTCA, 2e éd. [1] |

**Manquants :** aucun pour la LOTCA standard. L'attention et la mémoire ne sont des domaines que dans la LOTCA-G, version gériatrique [1].

Sources : https://strokengine.ca/en/assessments/loewenstein-occupational-therapy-cognitive-assessment-lotca/ et https://link.springer.com/rwe/10.1007/978-0-387-79948-3_1817

---

### mmse

| id                                                                                                              | Verdict  |
| --------------------------------------------------------------------------------------------------------------- | -------- |
| orientation-time, orientation-space, memory-registration, attention-calc, recall, language, construction, total | RÉEL [1] |

Barème : orientation dans le temps /5, dans l'espace /5, apprentissage /3, attention et calcul /5, rappel /3, langage /8, copie /1, total /30.

**Manquants :** aucun.

Source : https://strokengine.ca/en/assessments/mini-mental-state-examination-mmse/ et https://en.wikipedia.org/wiki/Mini%E2%80%93mental_state_examination

---

### moca

Référence : 7 domaines notés sur 30 : visuospatial/exécutif, dénomination, attention, langage, abstraction, rappel différé, orientation. Les essais d'apprentissage des mots **ne rapportent aucun point** [1] [2].

| id                                                                                              | Verdict | Commentaire                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| visuospatial-exec, naming, attention, language, abstraction, delayed-recall, orientation, total | RÉEL    | [1] [2]                                                                                                                                                                                                                                                                                                                                |
| memory-score                                                                                    | DOUTEUX | L'encodage (essais 1 et 2) n'est pas noté [1] [2], donc un score « Mémoire » distinct du rappel différé n'existe pas dans la MoCA classique. Si la ligne représente le **MIS** (Memory Index Score, indice de 0 à 15 des versions 8.x, avec rappel indicé), il faut la renommer ainsi. Sinon, elle fait doublon avec `delayed-recall`. |

**Manquants :** aucun.

Sources :

1. MoCA, consignes de passation et de cotation, version 8.1 : https://studylib.net/doc/27531684/moca-8.1.8.2-english
2. https://strokengine.ca/en/assessments/montreal-cognitive-assessment-moca/

---

### quick-dash

| id                               | Verdict                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| total, work-module, sport-module | RÉEL : score d'incapacité et de symptômes sur 11 items, plus les modules facultatifs Travail et Sport/Arts du spectacle (4 items chacun), tous sur 0 à 100 [1] |

**Manquants :** aucun.

Source : Institute for Work & Health, cotation QuickDASH : https://dash.iwh.on.ca/sites/dash/files/downloads/QuickDASH_scoring_2010.pdf et https://dash.iwh.on.ca/scoring
