
-- Standardize BRIEF-2 score_type to 't-score' (2 rows have 't_score' instead)
UPDATE official_subtests SET score_type = 't-score'
WHERE test_id = 'brief-2' AND score_type = 't_score';
;
