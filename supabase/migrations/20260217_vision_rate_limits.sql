-- Create extraction_log table for vision/OCR extractions (separate from generation_log)
CREATE TABLE IF NOT EXISTS extraction_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for efficient rate limit checks
CREATE INDEX IF NOT EXISTS idx_extraction_log_user_created 
    ON extraction_log(user_id, created_at DESC);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_extraction_log_status 
    ON extraction_log(status, created_at DESC);

-- RLS policies for extraction_log
ALTER TABLE extraction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own extraction logs"
    ON extraction_log FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own extraction logs"
    ON extraction_log FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Function to check extraction rate limits (no credit consumption)
CREATE OR REPLACE FUNCTION check_extraction_rate_limit(p_max_per_hour INT DEFAULT 50)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_count INT;
    v_one_hour_ago TIMESTAMPTZ;
BEGIN
    -- Get current user
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Calculate time window
    v_one_hour_ago := now() - INTERVAL '1 hour';

    -- Count extractions in the last hour
    SELECT COUNT(*)
    INTO v_count
    FROM extraction_log
    WHERE user_id = v_user_id
      AND created_at >= v_one_hour_ago;

    -- Return true if within limit
    RETURN v_count < p_max_per_hour;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION check_extraction_rate_limit TO authenticated;

-- Add comment for documentation
COMMENT ON TABLE extraction_log IS 'Logs vision/OCR extraction requests (separate from AI report generation). No credit consumption.';
COMMENT ON FUNCTION check_extraction_rate_limit IS 'Checks if user is within extraction rate limit. Default: 50 per hour (higher than report generation).';
