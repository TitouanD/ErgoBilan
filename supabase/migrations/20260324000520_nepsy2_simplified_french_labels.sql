-- Simplify NEPSY-II labels to common French clinical naming

update public.official_subtests as s
set name = v.name_fr
from (values
  ('nepsy-2__affect-recognition', 'Reconnaissance des affects'),
  ('nepsy-2__animal-sorting', 'Catégorisation'),
  ('nepsy-2__arrows', 'Flèches'),
  ('nepsy-2__auditory-attention-response-set', 'Attention auditive'),
  ('nepsy-2__block-construction', 'Cubes'),
  ('nepsy-2__body-part-naming-identification', 'Dénomination des parties du corps'),
  ('nepsy-2__clocks', 'Horloges'),
  ('nepsy-2__comprehension-of-instructions', 'Compréhension de consignes'),
  ('nepsy-2__design-copying', 'Copie de figures'),
  ('nepsy-2__design-fluency', 'Fluidité de dessin'),
  ('nepsy-2__fingertip-tapping', 'Tapotement des doigts'),
  ('nepsy-2__geometric-puzzles', 'Puzzles géométriques'),
  ('nepsy-2__imitating-hand-positions', 'Imitation de positions de mains'),
  ('nepsy-2__inhibition', 'Inhibition'),
  ('nepsy-2__list-memory', 'Mémoire de liste'),
  ('nepsy-2__list-memory-delayed', 'Mémoire de liste différée'),
  ('nepsy-2__manual-motor-sequences', 'Séquences motrices manuelles'),
  ('nepsy-2__memory-for-designs', 'Mémoire de figures'),
  ('nepsy-2__memory-for-designs-delayed', 'Mémoire de figures différée'),
  ('nepsy-2__memory-for-faces', 'Mémoire des visages'),
  ('nepsy-2__memory-for-faces-delayed', 'Mémoire des visages différée'),
  ('nepsy-2__memory-for-names', 'Mémoire des prénoms'),
  ('nepsy-2__memory-for-names-delayed', 'Mémoire des prénoms différée'),
  ('nepsy-2__narrative-memory', 'Mémoire narrative'),
  ('nepsy-2__oromotor-sequences', 'Séquences oro-motrices'),
  ('nepsy-2__phonological-processing', 'Phonologie'),
  ('nepsy-2__picture-puzzles', 'Puzzles d''images'),
  ('nepsy-2__repetition-of-nonsense-words', 'Répétition de pseudo-mots'),
  ('nepsy-2__route-finding', 'Orientation'),
  ('nepsy-2__sentence-repetition', 'Répétition de phrases'),
  ('nepsy-2__speeded-naming', 'Dénomination rapide'),
  ('nepsy-2__statue', 'Statue'),
  ('nepsy-2__theory-of-mind', 'Théorie de l''esprit'),
  ('nepsy-2__visuomotor-precision', 'Précision visuomotrice'),
  ('nepsy-2__word-generation', 'Production de mots'),
  ('nepsy-2__word-list-interference', 'Interférence de liste de mots')
) as v(id, name_fr)
where s.id = v.id
  and s.test_id = 'nepsy-2';
