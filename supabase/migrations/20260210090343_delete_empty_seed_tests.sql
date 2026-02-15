
-- Delete the 14 empty seed tests (0 subtests, 0 norms, no sessions reference them)
DELETE FROM official_tests
WHERE author = 'seed'
  AND id IN (
    'bogdashina-senso',
    'caa',
    'children-kitchen-task',
    'dtvp-a',
    'ef2e',
    'evedp',
    'evic',
    'frostig',
    'manos',
    'manos-3',
    'profil-sensoriel',
    'reversal',
    'rtd-lacert',
    'sensot-dir'
  );
;
