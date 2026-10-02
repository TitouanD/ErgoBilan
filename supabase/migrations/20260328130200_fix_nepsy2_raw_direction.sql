-- =============================================================================
-- Migration: Fix raw_direction for all NEPSY 2 subtests
-- Date: 2026-03-28
-- Problem:
--   All 44 NEPSY 2 subtests have raw_direction='auto', but 34 of them already
--   have norms → admin panel surfaces DIRECTION_AUTO_WITH_NORMS for each one.
--   The 'auto' fallback uses name-regex inference at score time, which is
--   fragile with French labels.
-- Method:
--   Empirical analysis of norm rows (correlation of raw_min vs standard_score
--   at extreme ends 1-3 vs 17-19) confirmed direction for all subtests with
--   active norms. Clinical logic applied for 0-norm subtests.
-- =============================================================================

-- ─── lower_better (time/error based — lower raw = higher scaled score) ────────
-- Confirmed empirically: low_ss_raw >> high_ss_raw
UPDATE public.official_subtests
SET raw_direction = 'lower_better'
WHERE id IN (
  'nepsy-2__speeded-naming',         -- Dénomination rapide       (347 vs 77)
  'nepsy-2__inhibition',             -- Inhibition                (168 vs 64)
  'nepsy-2__inhibition-commutation', -- Inhibition — Commutation  ( 45 vs  2)
  'nepsy-2__inhibition-inhibition',  -- Inhibition — Inhibition   (300 vs 85)
  'nepsy-2__visuomotor-precision',   -- Précision visuomotrice    (268 vs 18)
  'nepsy-2__inhibition-denomination' -- Inhibition — Dénomination (time score, 0 norms)
);
-- ─── higher_better (all remaining NEPSY 2 subtests) ──────────────────────────
UPDATE public.official_subtests
SET raw_direction = 'higher_better'
WHERE id IN (
  -- Subtests with 19 norms each (empirically confirmed or unambiguous direction)
  'nepsy-2__auditory-attention-response-set',    -- Attention auditive
  'nepsy-2__comprehension-of-instructions',      -- Compréhension de consignes
  'nepsy-2__arrows',                             -- Copie de figures — Processus global
  'nepsy-2__route-finding',                      -- Copie de figures — Processus local
  'nepsy-2__geometric-puzzles',                  -- Copie de figures — Processus moteur
  'nepsy-2__clocks',                             -- Copie de figures — Total
  'nepsy-2__block-construction',                 -- Dénomination des parties du corps
  'nepsy-2__design-fluency',                     -- Fluidité de dessin
  'nepsy-2__design-copying',                     -- Fluidité verbale
  'nepsy-2__imitating-hand-positions',           -- Imitation de positions de mains
  'nepsy-2__word-list-interference',             -- Interférence de liste de mots
  'nepsy-2__memory-for-designs-content',         -- Mémoire de figures — Contenu
  'nepsy-2__memory-for-designs',                 -- Mémoire de figures — Score total
  'nepsy-2__memory-for-designs-spatial',         -- Mémoire de figures — Spatial
  'nepsy-2__memory-for-designs-delayed-content', -- Mémoire de figures différée — Contenu
  'nepsy-2__memory-for-designs-delayed',         -- Mémoire de figures différée — Score total
  'nepsy-2__memory-for-designs-delayed-spatial', -- Mémoire de figures différée — Spatial
  'nepsy-2__list-memory',                        -- Mémoire de liste
  'nepsy-2__memory-for-names',                   -- Mémoire des prénoms
  'nepsy-2__memory-for-names-combined',          -- Mémoire des prénoms — Total combiné
  'nepsy-2__memory-for-faces',                   -- Mémoire des visages
  'nepsy-2__memory-for-faces-delayed',           -- Mémoire des visages différée
  'nepsy-2__phonological-processing',            -- Phonologie
  'nepsy-2__body-part-naming-identification',    -- Précision motrice
  'nepsy-2__word-generation',                    -- Production de mots
  'nepsy-2__affect-recognition',                 -- Reconnaissance des affects
  'nepsy-2__picture-puzzles',                    -- Répétition de phrases
  'nepsy-2__statue',                             -- Statue
  'nepsy-2__theory-of-mind',                     -- Théorie de l'esprit
  -- Subtests with 0 norms (clinical logic)
  'nepsy-2__animal-sorting',                     -- Catégorisation
  'nepsy-2__discrimination-digitale',            -- Discrimination digitale
  'nepsy-2__list-memory-delayed',                -- Mémoire de liste différée
  'nepsy-2__memory-for-names-delayed',           -- Mémoire des prénoms différée
  'nepsy-2__narrative-memory',                   -- Mémoire narrative
  'nepsy-2__repetition-of-nonsense-words',       -- Répétition de pseudo-mots
  'nepsy-2__manual-motor-sequences',             -- Séquences motrices manuelles
  'nepsy-2__oromotor-sequences',                 -- Séquences oro-motrices
  'nepsy-2__fingertip-tapping'                   -- Tapotement des doigts
);
