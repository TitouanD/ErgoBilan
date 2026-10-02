-- Add ai_style_preferences column to practitioners table
-- Stores abstract AI writing style preferences learned from practitioner corrections.
-- Contains ONLY generic style rules (e.g., "prefer short sentences"), NEVER patient data.
-- Maximum 2000 characters, enforced by CHECK constraint.

ALTER TABLE practitioners
  ADD COLUMN IF NOT EXISTS ai_style_preferences text
  CONSTRAINT ai_style_preferences_max_length CHECK (char_length(ai_style_preferences) <= 2000);
COMMENT ON COLUMN practitioners.ai_style_preferences IS
  'Abstract AI writing style preferences learned from report corrections. No PII allowed.';
