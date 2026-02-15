
-- Drop the stale overload that takes (text, text) instead of (uuid, text)
DROP FUNCTION IF EXISTS admin_norm_quality_check(text, text);
;
