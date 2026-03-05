-- =============================================================================
-- Migration : Corrections suite à l'audit du catalogue (05 mars 2026)
-- Basé sur : audit_catalog.md
-- Périmètre : NEPSY-2 (accents + sous-tests manquants), BRIEF-2 (Initiation),
--             MABC-2 (composites manquants), DTVP-2 (VMI), DTVP-A (renommage
--             composites), L'Espargot (restructuration).
-- =============================================================================


-- =============================================================================
-- 1. NEPSY-2 — Corrections d'accents (29 UPDATE)
-- =============================================================================

-- 1a. Mémoire de Figures (accents + "Differe" → "Différée", "Immediat" → "Immédiat")
UPDATE public.official_subtests
  SET name = 'Mémoire de Figures — Copie'
  WHERE id = 'nepsy-2_memoire_de_figures_mfc__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire de Figures — Différée Copie'
  WHERE id = 'nepsy-2_memoire_de_figures_mfdc__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire de Figures — Différée Score'
  WHERE id = 'nepsy-2_memoire_de_figures_mfds__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire de Figures — Différée Total'
  WHERE id = 'nepsy-2_memoire_de_figures_mfdt__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire de Figures — Score Immédiat'
  WHERE id = 'nepsy-2_memoire_de_figures_mfs__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire de Figures — Total'
  WHERE id = 'nepsy-2_memoire_de_figures_mft__58163a62';

-- 1b. Mémoire des Noms
UPDATE public.official_subtests
  SET name = 'Mémoire des Noms — Liste Complémentaire'
  WHERE id = 'nepsy-2_memoire_des_noms_lc__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire des Noms — Mémoire Perçue'
  WHERE id = 'nepsy-2_memoire_des_noms_mp__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire des Noms — Mémoire Perçue Différée'
  WHERE id = 'nepsy-2_memoire_des_noms_mpd__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire des Noms — Noms Différés Rappel'
  WHERE id = 'nepsy-2_memoire_des_noms_ndr__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire des Noms — Noms Différés Score'
  WHERE id = 'nepsy-2_memoire_des_noms_nds__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire des Noms — Total Erreurs'
  WHERE id = 'nepsy-2_memoire_des_noms_te__58163a62';

-- 1c. Mémoire des Visages
UPDATE public.official_subtests
  SET name = 'Mémoire des Visages — Différée'
  WHERE id = 'nepsy-2_memoire_des_visages_mvd__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire des Visages — Immédiat'
  WHERE id = 'nepsy-2_memoire_des_visages_mv__58163a62';

-- 1d. Mémoire Narrative
UPDATE public.official_subtests
  SET name = 'Mémoire Narrative — Rappel Libre'
  WHERE id = 'nepsy-2_memoire_narrative_l__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire Narrative — Rappel Libre Indicé'
  WHERE id = 'nepsy-2_memoire_narrative_li__58163a62';

UPDATE public.official_subtests
  SET name = 'Mémoire Narrative — Score Global'
  WHERE id = 'nepsy-2_memoire_narrative_mn__58163a62';

-- 1e. Dénomination Rapide
UPDATE public.official_subtests
  SET name = 'Dénomination Rapide — Alternance Couleurs'
  WHERE id = 'nepsy-2_denomination_rapide_deac__58163a62';

UPDATE public.official_subtests
  SET name = 'Dénomination Rapide — Nommage Couleurs'
  WHERE id = 'nepsy-2_denomination_rapide_denc__58163a62';

UPDATE public.official_subtests
  SET name = 'Dénomination Rapide — Score Combiné'
  WHERE id = 'nepsy-2_denomination_rapide_dr__58163a62';

-- 1f. Copie de Figures — Motricité
UPDATE public.official_subtests
  SET name = 'Copie de Figures — Motricité'
  WHERE id = 'nepsy-2_copie_de_figures_cfpm__58163a62';

-- 1g. Interférence de Liste de Mots
UPDATE public.official_subtests
  SET name = 'Interférence de Liste de Mots — Distracteur Score'
  WHERE id = 'nepsy-2_interference_de_liste_de_mots_ds__58163a62';

UPDATE public.official_subtests
  SET name = 'Interférence de Liste de Mots — Distracteur Total Erreurs'
  WHERE id = 'nepsy-2_interference_de_liste_de_mots_dte__58163a62';

UPDATE public.official_subtests
  SET name = 'Interférence de Liste de Mots — Nommage Erreurs'
  WHERE id = 'nepsy-2_interference_de_liste_de_mots_ine__58163a62';

UPDATE public.official_subtests
  SET name = 'Interférence de Liste de Mots — Nommage Intrusions'
  WHERE id = 'nepsy-2_interference_de_liste_de_mots_ini__58163a62';

UPDATE public.official_subtests
  SET name = 'Interférence de Liste de Mots — Total Erreurs'
  WHERE id = 'nepsy-2_interference_de_liste_de_mots_ite__58163a62';

-- 1h. Reconnaissance des Affects — Colère / Dégoût
UPDATE public.official_subtests
  SET name = 'Reconnaissance des Affects — Colère'
  WHERE id = 'nepsy-2_reconnaissance_des_affects_colere__58163a62';

UPDATE public.official_subtests
  SET name = 'Reconnaissance des Affects — Dégoût'
  WHERE id = 'nepsy-2_reconnaissance_des_affects_degout__58163a62';


-- =============================================================================
-- 2. NEPSY-2 — Sous-tests officiels manquants (6 INSERT)
-- =============================================================================

-- 2a. Domaine Langage
INSERT INTO public.official_subtests (id, test_id, name, score_type, input_model, organization_id)
VALUES
  ('nepsy-2__denom-parties-corps',   'nepsy-2', 'Dénomination des Parties du Corps', 'scaled', 'numeric_4mode', NULL),
  ('nepsy-2__repetition-pseudo-mots','nepsy-2', 'Répétition de Pseudo-Mots',          'scaled', 'numeric_4mode', NULL),
  ('nepsy-2__sequences-oro-motrices','nepsy-2', 'Séquences Oro-Motrices',             'scaled', 'numeric_4mode', NULL)
ON CONFLICT (id) DO NOTHING;

-- 2b. Domaine Sensori-moteur
INSERT INTO public.official_subtests (id, test_id, name, score_type, input_model, organization_id)
VALUES
  ('nepsy-2__discrimination-digitale','nepsy-2', 'Discrimination Digitale',       'scaled', 'numeric_4mode', NULL),
  ('nepsy-2__frappe-bout-doigts',     'nepsy-2', 'Frappe du Bout des Doigts',    'scaled', 'numeric_4mode', NULL)
ON CONFLICT (id) DO NOTHING;

-- 2c. Domaine Attention/FE — condition Inhibition (distincte de Dénomination)
INSERT INTO public.official_subtests (id, test_id, name, score_type, input_model, organization_id)
VALUES
  ('nepsy-2__inhibition-score',       'nepsy-2', 'Inhibition — Score Total',           'scaled',     'numeric_4mode', NULL),
  ('nepsy-2__inhibition-temps',       'nepsy-2', 'Inhibition — Inhibition (Temps)',     'scaled',     'numeric_4mode', NULL),
  ('nepsy-2__inhibition-ca',          'nepsy-2', 'Inhibition — Inhibition Cibles',      'percentile', 'numeric_4mode', NULL),
  ('nepsy-2__inhibition-erreurs',     'nepsy-2', 'Inhibition — Inhibition Erreurs',     'percentile', 'numeric_4mode', NULL)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 3. BRIEF-2 — Échelle "Initiation" manquante
-- =============================================================================
INSERT INTO public.official_subtests (id, test_id, name, score_type, input_model, organization_id)
VALUES
  ('brief-2__initiation', 'brief-2', 'Initiation', 't-score', 'numeric_4mode', NULL)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 4. MABC-2 — Scores composites manquants
--    (Équilibre et Score Total absents de la DB)
-- =============================================================================
INSERT INTO public.official_subtests (id, test_id, name, score_type, input_model, organization_id)
VALUES
  ('mabc-2__balance-composite', 'mabc-2', 'Équilibre',    'standard', 'numeric_4mode', NULL),
  ('mabc-2__total-score',       'mabc-2', 'Score Total',  'standard', 'numeric_4mode', NULL)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 5. DTVP-2 — Quotient Intégration Motrice Visuelle (VMI) manquant
--    (actuellement : GVP + MVPR ; le troisième quotient VMI est absent)
-- =============================================================================
INSERT INTO public.official_subtests (id, test_id, name, score_type, input_model, organization_id)
VALUES
  ('dtvp-2__quotient-vmi', 'dtvp-2',
   'Quotient Intégration Motrice Visuelle (VMI)',
   'standard', 'numeric_4mode', NULL)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 6. DTVP-A — Renommage des composites (noms fonctionnels → noms officiels)
-- =============================================================================

-- "Somme de 3 sous-tests" → "Quotient Motricité Réduite (MRP)"
UPDATE public.official_subtests
  SET name       = 'Quotient Motricité Réduite (MRP)',
      score_type = 'standard'
  WHERE id = 'dtvp-a__sum-3';

-- "Somme de 6 sous-tests" → "Quotient Perception Visuelle Globale (GVP)"
UPDATE public.official_subtests
  SET name       = 'Quotient Perception Visuelle Globale (GVP)',
      score_type = 'standard'
  WHERE id = 'dtvp-a__sum-6';


-- =============================================================================
-- 7. L'Espargot — Correction des sous-tests (copiés par erreur depuis EVIC)
--    Les sous-tests Copie / Dictée / Répétition sont issus de l'EVIC et ne
--    correspondent pas à la structure de L'Espargot (test graphomoteur Albaret).
--    On renomme selon la structure documentée (score global + deux indices).
-- =============================================================================

UPDATE public.official_subtests
  SET name = 'Score Global (Tracé)'
  WHERE id = 'espargot_copie_copie_58163a62';

UPDATE public.official_subtests
  SET name = 'Vitesse d''Exécution'
  WHERE id = 'espargot_repetition_repetit_58163a62';

-- "Dictée" n'a pas d'équivalent dans L'Espargot ; on la renomme en précision
UPDATE public.official_subtests
  SET name = 'Précision du Tracé'
  WHERE id = 'espargot_dictee_dictee_58163a62';


-- =============================================================================
-- 8. Nettoyage — orphelin DB (ancienne entrée EVIC privée)
--    À activer uniquement si l'ID n'est plus référencé dans official_norms.
--    Décommenter après vérification :
-- =============================================================================
-- DELETE FROM public.official_subtests WHERE test_id = 'priv_9ad49003_e836396c';
-- DELETE FROM public.official_tests     WHERE id      = 'priv_9ad49003_e836396c';
