
-- Fix score_type for tests where all subtests were incorrectly left as 'none'

-- 1. WISC-V subtests → scaled (M=10, SD=3, Wechsler standard)
UPDATE official_subtests os
SET score_type = 'scaled'
FROM official_tests ot
WHERE os.test_id = ot.id
  AND ot.name = 'WISC-V (sous-tests sélectionnés)';

-- 2. BHK Adolescent → standard (M=100, SD=15, same family as BHK enfant)
UPDATE official_subtests os
SET score_type = 'standard'
FROM official_tests ot
WHERE os.test_id = ot.id
  AND ot.name = 'BHK Adolescent';

-- 3. MVPT-4 "Score total" only → standard (M=100, SD=15)
--    Subscales are raw item counts, not standardised → kept as none
UPDATE official_subtests os
SET score_type = 'standard'
FROM official_tests ot
WHERE os.test_id = ot.id
  AND ot.name = 'MVPT-4'
  AND os.name = 'Score total';

-- 4. PDMS-2 individual subtests → scaled (M=10, SD=3 standard for subtest scores)
UPDATE official_subtests os
SET score_type = 'scaled'
FROM official_tests ot
WHERE os.test_id = ot.id
  AND ot.name = 'PDMS-2 (Peabody)';

-- 5. Vineland-3 domain scores → standard (M=100, SD=15)
UPDATE official_subtests os
SET score_type = 'standard'
FROM official_tests ot
WHERE os.test_id = ot.id
  AND ot.name ILIKE '%Vineland%';

-- 6. BOT-2 subtests → scaled (BOT-2 uses scale scores M=15 SD=5,
--    closest available type; no exact match exists in ErgoBilan)
UPDATE official_subtests os
SET score_type = 'scaled'
FROM official_tests ot
WHERE os.test_id = ot.id
  AND ot.name = 'BOT-2';

-- 7. TEA-Ch subtests → scaled (M=10, SD=3 scaled scores)
UPDATE official_subtests os
SET score_type = 'scaled'
FROM official_tests ot
WHERE os.test_id = ot.id
  AND ot.name = 'TEA-Ch';
;
