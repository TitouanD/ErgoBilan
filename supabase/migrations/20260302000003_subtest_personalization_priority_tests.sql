-- =============================================================================
-- Migration: 20260302000003 — Subtest personalisation for priority tests
-- =============================================================================

-- ── PART 1 — Extend input_model CHECK constraints to include 'computed_items' ─
ALTER TABLE official_subtests DROP CONSTRAINT IF EXISTS official_subtests_input_model_check;
ALTER TABLE official_subtests DROP CONSTRAINT IF EXISTS official_subtests_input_model_domain_chk;
ALTER TABLE official_subtests
  ADD CONSTRAINT official_subtests_input_model_check
  CHECK (input_model = ANY (ARRAY[
    'numeric_4mode'::text,
    'qualitative_category'::text,
    'raw_only'::text,
    'custom_text'::text,
    'computed_items'::text
  ]));

-- ── PART 2 — Figure de Rey: richesse subtests → computed_items (18 éléments) ─
UPDATE official_subtests
SET
  input_model = 'computed_items',
  always_show_raw = false,
  input_config = jsonb_build_object(
    'defaultMetric', 'raw',
    'itemsAggregation', 'sum',
    'aggregationHint', 'Σ 18 éléments × 0 / 0.5 / 1 / 2 pts — max 36',
    'displayGroup', 'grid_3',
    'items', jsonb_build_array(
      jsonb_build_object('id','el_01','label','1 — Grande croix gauche (extérieure)','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_02','label','2 — Grand rectangle','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_03','label','3 — Croix diagonale intérieure','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_04','label','4 — Médiane horizontale','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_05','label','5 — Médiane verticale','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_06','label','6 — Petite croix (quadrant supérieur droit)','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_07','label','7 — Petit carré (sup. gauche, hors rectangle)','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_08','label','8 — Grand triangle (haut gauche)','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_09','label','9 — Petite croix au-dessus du triangle','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_10','label','10 — Petite perpendiculaire (bord inférieur)','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_11','label','11 — Cercle avec 3 points','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_12','label','12 — 5 lignes parallèles (dans triangle)','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_13','label','13 — Bande droite intérieure','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_14','label','14 — Losange (bord droit rectangle)','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_15','label','15 — Grand triangle (haut droit)','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_16','label','16 — Segment horizontal inf. (hors rectangle)','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_17','label','17 — Croix (bas, milieu)','type','number','min',0,'max',2,'decimals',1),
      jsonb_build_object('id','el_18','label','18 — Petit carré (inférieur gauche)','type','number','min',0,'max',2,'decimals',1)
    )
  )
WHERE id IN ('figure-rey__copie-richesse', 'figure-rey__memoire-richesse');

UPDATE official_subtests SET input_config = jsonb_build_object('defaultMetric', 'raw')
WHERE id IN ('figure-rey__copie-temps', 'figure-rey__memoire-temps',
             'figure-rey__copie-type', 'figure-rey__memoire-type');

-- ── PART 3 — DTVP-2: semantic ID rename + names / abbreviations / input_config ─
ALTER TABLE official_norms DROP CONSTRAINT IF EXISTS official_norms_subtest_id_fkey;

UPDATE official_subtests SET id='dtvp-2__form-constancy'     WHERE id='dtvp-2_constance_de_forme_4359d797';
UPDATE official_subtests SET id='dtvp-2__copying'            WHERE id='dtvp-2_copie_4359d797';
UPDATE official_subtests SET id='dtvp-2__visual-closure'     WHERE id='dtvp-2_fermeture_visuelle_4359d797';
UPDATE official_subtests SET id='dtvp-2__position-space'     WHERE id='dtvp-2_position_dans_l_espace_4359d797';
UPDATE official_subtests SET id='dtvp-2__quotient-mvpr'      WHERE id='dtvp-2_quotient_composite_4_sous_tests__4359d797';
UPDATE official_subtests SET id='dtvp-2__quotient-gvp'       WHERE id='dtvp-2_quotient_composite_8_sous_tests__4359d797';
UPDATE official_subtests SET id='dtvp-2__spatial-relations'  WHERE id='dtvp-2_relations_spatiales_4359d797';
UPDATE official_subtests SET id='dtvp-2__visual-motor-speed' WHERE id='dtvp-2_vitesse_visuo_motrice_4359d797';

UPDATE official_norms SET subtest_id='dtvp-2__form-constancy'     WHERE subtest_id='dtvp-2_constance_de_forme_4359d797';
UPDATE official_norms SET subtest_id='dtvp-2__copying'            WHERE subtest_id='dtvp-2_copie_4359d797';
UPDATE official_norms SET subtest_id='dtvp-2__visual-closure'     WHERE subtest_id='dtvp-2_fermeture_visuelle_4359d797';
UPDATE official_norms SET subtest_id='dtvp-2__position-space'     WHERE subtest_id='dtvp-2_position_dans_l_espace_4359d797';
UPDATE official_norms SET subtest_id='dtvp-2__quotient-mvpr'      WHERE subtest_id='dtvp-2_quotient_composite_4_sous_tests__4359d797';
UPDATE official_norms SET subtest_id='dtvp-2__quotient-gvp'       WHERE subtest_id='dtvp-2_quotient_composite_8_sous_tests__4359d797';
UPDATE official_norms SET subtest_id='dtvp-2__spatial-relations'  WHERE subtest_id='dtvp-2_relations_spatiales_4359d797';
UPDATE official_norms SET subtest_id='dtvp-2__visual-motor-speed' WHERE subtest_id='dtvp-2_vitesse_visuo_motrice_4359d797';

ALTER TABLE official_norms
  ADD CONSTRAINT official_norms_subtest_id_fkey
  FOREIGN KEY (subtest_id) REFERENCES official_subtests(id);

UPDATE official_subtests SET name='Coordination Oeil-Main', abbreviation='COM',
  input_config=jsonb_build_object('defaultMetric','raw') WHERE id='dtvp-2__eye-hand';
UPDATE official_subtests SET name='Figure-Fond', abbreviation='FF',
  input_config=jsonb_build_object('defaultMetric','raw') WHERE id='dtvp-2__figure-ground';
UPDATE official_subtests SET name='Constance de Forme', abbreviation='CF',
  input_config=jsonb_build_object('defaultMetric','raw') WHERE id='dtvp-2__form-constancy';
UPDATE official_subtests SET name='Copie', abbreviation='CO',
  input_config=jsonb_build_object('defaultMetric','raw') WHERE id='dtvp-2__copying';
UPDATE official_subtests SET name='Fermeture Visuelle', abbreviation='FV',
  input_config=jsonb_build_object('defaultMetric','raw') WHERE id='dtvp-2__visual-closure';
UPDATE official_subtests SET name='Position dans l''Espace', abbreviation='PE',
  input_config=jsonb_build_object('defaultMetric','raw') WHERE id='dtvp-2__position-space';
UPDATE official_subtests SET name='Relations Spatiales', abbreviation='RS',
  input_config=jsonb_build_object('defaultMetric','raw') WHERE id='dtvp-2__spatial-relations';
UPDATE official_subtests SET name='Vitesse Visuo-Motrice', abbreviation='VVM',
  input_config=jsonb_build_object('defaultMetric','raw') WHERE id='dtvp-2__visual-motor-speed';
UPDATE official_subtests SET
  name='Quotient Perception Motrice Reduite (4 sous-tests)', abbreviation='MVPR', unit='QS',
  input_config=jsonb_build_object('defaultMetric','standard') WHERE id='dtvp-2__quotient-mvpr';
UPDATE official_subtests SET
  name='Quotient Perception Visuelle Globale (8 sous-tests)', abbreviation='GVP', unit='QS',
  input_config=jsonb_build_object('defaultMetric','standard') WHERE id='dtvp-2__quotient-gvp';

-- ── PART 4 — NEPSY-2: abbreviations + display names + defaultMetric ────────
UPDATE official_subtests SET name='Attention Auditive — Cibles Correctes',      abbreviation='AAC',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_attention_auditive_aac__58163a62';
UPDATE official_subtests SET name='Attention Auditive — Inhibitions Correctes',  abbreviation='AAI',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_attention_auditive_aai__58163a62';
UPDATE official_subtests SET name='Attention Auditive — Omissions',              abbreviation='AAO',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_attention_auditive_aao__58163a62';
UPDATE official_subtests SET name='Copie de Figures — Score Global',             abbreviation='CFPG',   input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_copie_de_figures_cfpg__58163a62';
UPDATE official_subtests SET name='Copie de Figures — Localisation',             abbreviation='CFPL',   input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_copie_de_figures_cfpl__58163a62';
UPDATE official_subtests SET name='Copie de Figures — Motricite',                abbreviation='CFPM',   input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_copie_de_figures_cfpm__58163a62';
UPDATE official_subtests SET name='Copie de Figures — Total',                    abbreviation='CFPT',   input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_copie_de_figures_cfpt__58163a62';
UPDATE official_subtests SET name='Denomination Rapide — Alternance Couleurs',   abbreviation='DEAC',   input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_denomination_rapide_deac__58163a62';
UPDATE official_subtests SET name='Denomination Rapide — Nommage Couleurs',      abbreviation='DENC',   input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_denomination_rapide_denc__58163a62';
UPDATE official_subtests SET name='Denomination Rapide — Score Combine',         abbreviation='DR',     input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_denomination_rapide_dr__58163a62';
UPDATE official_subtests SET name='Interference LM — Distracteur Score',         abbreviation='DS',     input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_interference_de_liste_de_mots_ds__58163a62';
UPDATE official_subtests SET name='Interference LM — Distracteur Total Erreurs', abbreviation='DTE',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_interference_de_liste_de_mots_dte__58163a62';
UPDATE official_subtests SET name='Interference LM — Nommage Erreurs',           abbreviation='INE',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_interference_de_liste_de_mots_ine__58163a62';
UPDATE official_subtests SET name='Interference LM — Nommage Intrusions',        abbreviation='INI',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_interference_de_liste_de_mots_ini__58163a62';
UPDATE official_subtests SET name='Interference LM — Total Erreurs',             abbreviation='ITE',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_interference_de_liste_de_mots_ite__58163a62';
UPDATE official_subtests SET name='Memoire de Figures — Copie',                  abbreviation='MFC',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_de_figures_mfc__58163a62';
UPDATE official_subtests SET name='Memoire de Figures — Differe Copie',          abbreviation='MFDC',   input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_de_figures_mfdc__58163a62';
UPDATE official_subtests SET name='Memoire de Figures — Differe Score',          abbreviation='MFDS',   input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_de_figures_mfds__58163a62';
UPDATE official_subtests SET name='Memoire de Figures — Differe Total',          abbreviation='MFDT',   input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_de_figures_mfdt__58163a62';
UPDATE official_subtests SET name='Memoire de Figures — Score Immediat',         abbreviation='MFS',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_de_figures_mfs__58163a62';
UPDATE official_subtests SET name='Memoire de Figures — Total',                  abbreviation='MFT',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_de_figures_mft__58163a62';
UPDATE official_subtests SET name='Memoire des Noms — Liste Complementaire',     abbreviation='LC',     input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_des_noms_lc__58163a62';
UPDATE official_subtests SET name='Memoire des Noms — Memoire Percue',           abbreviation='MP',     input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_des_noms_mp__58163a62';
UPDATE official_subtests SET name='Memoire des Noms — Memoire Percue Differee',  abbreviation='MPD',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_des_noms_mpd__58163a62';
UPDATE official_subtests SET name='Memoire des Noms — Noms Differes Rappel',     abbreviation='NDR',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_des_noms_ndr__58163a62';
UPDATE official_subtests SET name='Memoire des Noms — Noms Differes Score',      abbreviation='NDS',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_des_noms_nds__58163a62';
UPDATE official_subtests SET name='Memoire des Noms — Total Erreurs',            abbreviation='TE',     input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_des_noms_te__58163a62';
UPDATE official_subtests SET name='Memoire des Visages — Immediat',              abbreviation='MV',     input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_des_visages_mv__58163a62';
UPDATE official_subtests SET name='Memoire des Visages — Differe',               abbreviation='MVD',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_des_visages_mvd__58163a62';
UPDATE official_subtests SET name='Memoire Narrative — Rappel Libre',            abbreviation='MNL',    input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_narrative_l__58163a62';
UPDATE official_subtests SET name='Memoire Narrative — Rappel Libre Indice',     abbreviation='MNLI',   input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_narrative_li__58163a62';
UPDATE official_subtests SET name='Memoire Narrative — Score Global',            abbreviation='MN',     input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_memoire_narrative_mn__58163a62';
UPDATE official_subtests SET name='Reconnaissance des Affects — Colere',         abbreviation='RA-COL', input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_reconnaissance_des_affects_colere__58163a62';
UPDATE official_subtests SET name='Reconnaissance des Affects — Contentement',   abbreviation='RA-CT',  input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_reconnaissance_des_affects_content__58163a62';
UPDATE official_subtests SET name='Reconnaissance des Affects — Degout',         abbreviation='RA-DEG', input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_reconnaissance_des_affects_degout__58163a62';
UPDATE official_subtests SET name='Reconnaissance des Affects — Neutre',         abbreviation='RA-NEU', input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_reconnaissance_des_affects_neutre__58163a62';
UPDATE official_subtests SET name='Reconnaissance des Affects — Peur',           abbreviation='RA-PEU', input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_reconnaissance_des_affects_peur__58163a62';
UPDATE official_subtests SET name='Reconnaissance des Affects — Tristesse',      abbreviation='RA-TRI', input_config=jsonb_build_object('defaultMetric','raw') WHERE id='nepsy-2_reconnaissance_des_affects_triste__58163a62';

-- ── PART 5 — M-ABC-2: defaultMetric + aggregationHint ─────────────────────
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw','aggregationHint','Nombre de reussites sur 5 essais (0-5)')
  WHERE id IN ('mabc-2__catch-one-hand','mabc-2__catch-two-hands','mabc-2__catch-bag','mabc-2__throw-bag','mabc-2__throw-target');
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw','aggregationHint','Meilleur temps (sec) sur 2 essais')
  WHERE id IN ('mabc-2__balance-one-leg-best','mabc-2__balance-one-leg-other','mabc-2__balance-two-boards',
               'mabc-2__tiptoe-walk','mabc-2__mat-jump','mabc-2__pegs-preferred','mabc-2__pegs-flip',
               'mabc-2__bead-threading','mabc-2__lacing','mabc-2__nuts-bolts');
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw','aggregationHint','Temps (sec) pour 12 pieces dans la tirelire')
  WHERE id IN ('mabc-2__coin-pref','mabc-2__coin-non-pref');
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw','aggregationHint','Nombre d''erreurs (sorties de piste)')
  WHERE id IN ('mabc-2__trail-band1','mabc-2__trail-band2','mabc-2__trail-band3');

-- ── PART 6 — BHK / BHK-Ado ────────────────────────────────────────────────
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw','aggregationHint','Score qualite global (items A-L) — plus bas = meilleure ecriture')
  WHERE id='bhk__quality';
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw','aggregationHint','Nombre de caracteres ecrits en 5 minutes')
  WHERE id='bhk__speed';
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw','aggregationHint','Score qualite global — consulter le guide de cotation BHK-ADO')
  WHERE id='bhk-ado__quality';
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw','aggregationHint','Nombre de lettres ecrites en 5 minutes')
  WHERE id='bhk-ado__speed';

-- ── PART 7 — EVIC ──────────────────────────────────────────────────────────
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw')
  WHERE id IN ('evic__copie','evic__dictee','evic__repetition','evic__automatisation');

-- ── PART 8 — Barrage-H + Test-Cloches ─────────────────────────────────────
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw')
  WHERE id IN ('barrage-h__cibles','barrage-h__temps');
UPDATE official_subtests SET input_config=jsonb_build_object('defaultMetric','raw','aggregationHint','Nombre de cloches entourees (max 35)')
  WHERE id='test-cloches__cibles';

-- ── VERIFICATION ───────────────────────────────────────────────────────────
DO $$
DECLARE v_check integer;
BEGIN
  SELECT COUNT(*) INTO v_check FROM official_subtests WHERE input_model='computed_items';
  RAISE NOTICE '[OK] computed_items subtests: %', v_check;

  SELECT COUNT(*) INTO v_check FROM official_subtests
  WHERE id IN ('figure-rey__copie-richesse','figure-rey__memoire-richesse')
    AND input_model='computed_items'
    AND jsonb_array_length(input_config->'items')=18;
  IF v_check <> 2 THEN
    RAISE EXCEPTION 'Figure de Rey 18-element config error: got %', v_check;
  END IF;
  RAISE NOTICE '[OK] Figure Rey richesse: 18-element computed_items verified';

  SELECT COUNT(*) INTO v_check FROM official_subtests WHERE id LIKE '%4359d797%';
  IF v_check > 0 THEN
    RAISE EXCEPTION 'DTVP-2 legacy priv_ IDs still present: %', v_check;
  END IF;
  RAISE NOTICE '[OK] DTVP-2 priv_ IDs fully removed';

  SELECT COUNT(*) INTO v_check FROM official_subtests
  WHERE test_id IN ('nepsy-2','mabc-2','bhk','bhk-ado','figure-rey','evic','dtvp-2','barrage-h','test-cloches')
    AND (input_config->>'defaultMetric') IS NOT NULL;
  RAISE NOTICE '[OK] Priority subtests with defaultMetric: %', v_check;
END $$;
