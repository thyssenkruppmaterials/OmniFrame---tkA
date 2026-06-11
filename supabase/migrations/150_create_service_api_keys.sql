-- File: supabase/migrations/150_create_service_api_keys.sql
-- Service API Keys for internal service-to-service authentication
-- Created: January 27, 2026
-- Part of: Comprehensive Authentication Security Overhaul - Phase 1

-- ============================================================================
-- TABLE: service_api_keys
-- Stores hashed API keys for internal microservice authentication
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(100) NOT NULL UNIQUE,
    key_hash VARCHAR(128) NOT NULL,  -- SHA-256 hash of the API key
    key_prefix VARCHAR(8) NOT NULL,  -- First 8 chars for identification (e.g., "onbx_ai_")
    description TEXT,
    permissions JSONB DEFAULT '[]'::jsonb,  -- Array of allowed operations
    rate_limit_per_minute INTEGER DEFAULT 1000,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- ============================================================================
-- TABLE: service_api_key_usage
-- Audit table for API key usage tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_api_key_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID REFERENCES service_api_keys(id) ON DELETE SET NULL,
    service_name VARCHAR(100) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    response_status INTEGER,
    response_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES: Performance optimization for API key lookups
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_service_api_keys_service_name 
    ON service_api_keys(service_name);

CREATE INDEX IF NOT EXISTS idx_service_api_keys_key_prefix 
    ON service_api_keys(key_prefix);

CREATE INDEX IF NOT EXISTS idx_service_api_keys_is_active 
    ON service_api_keys(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_service_api_key_usage_created_at 
    ON service_api_key_usage(created_at);

CREATE INDEX IF NOT EXISTS idx_service_api_key_usage_api_key_id 
    ON service_api_key_usage(api_key_id);

-- Composite index for key validation queries
CREATE INDEX IF NOT EXISTS idx_service_api_keys_validation 
    ON service_api_keys(key_prefix, key_hash, is_active);

-- ============================================================================
-- ROW LEVEL SECURITY: Restrict access to service_role only
-- ============================================================================
ALTER TABLE service_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_api_key_usage ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Service role can manage API keys" ON service_api_keys;
DROP POLICY IF EXISTS "Service role can log API key usage" ON service_api_key_usage;

-- Allow only service_role to manage API keys
CREATE POLICY "Service role can manage API keys"
    ON service_api_keys
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow only service_role to log API key usage
CREATE POLICY "Service role can log API key usage"
    ON service_api_key_usage
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- FUNCTION: validate_service_api_key
-- Validates an API key and returns service information if valid
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_service_api_key(
    p_key_prefix VARCHAR(8),
    p_key_hash VARCHAR(128)
) RETURNS TABLE(
    is_valid BOOLEAN,
    service_name VARCHAR(100),
    permissions JSONB,
    rate_limit INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        true as is_valid,
        sak.service_name,
        sak.permissions,
        sak.rate_limit_per_minute as rate_limit
    FROM service_api_keys sak
    WHERE sak.key_prefix = p_key_prefix
      AND sak.key_hash = p_key_hash
      AND sak.is_active = true
      AND (sak.expires_at IS NULL OR sak.expires_at > NOW());
    
    -- Update last_used_at timestamp
    UPDATE service_api_keys 
    SET last_used_at = NOW(),
        updated_at = NOW()
    WHERE key_prefix = p_key_prefix 
      AND key_hash = p_key_hash
      AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- FUNCTION: log_api_key_usage
-- Logs API key usage for audit purposes
-- ============================================================================
CREATE OR REPLACE FUNCTION log_api_key_usage(
    p_service_name VARCHAR(100),
    p_endpoint VARCHAR(255),
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_response_status INTEGER DEFAULT NULL,
    p_response_time_ms INTEGER DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_api_key_id UUID;
    v_log_id UUID;
BEGIN
    -- Get the API key ID for the service
    SELECT id INTO v_api_key_id
    FROM service_api_keys
    WHERE service_name = p_service_name
      AND is_active = true
    LIMIT 1;
    
    -- Insert the usage log
    INSERT INTO service_api_key_usage (
        api_key_id,
        service_name,
        endpoint,
        ip_address,
        user_agent,
        response_status,
        response_time_ms
    ) VALUES (
        v_api_key_id,
        p_service_name,
        p_endpoint,
        p_ip_address,
        p_user_agent,
        p_response_status,
        p_response_time_ms
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- FUNCTION: get_api_key_stats
-- Returns usage statistics for a service API key
-- ============================================================================
CREATE OR REPLACE FUNCTION get_api_key_stats(
    p_service_name VARCHAR(100),
    p_hours INTEGER DEFAULT 24
) RETURNS TABLE(
    total_requests BIGINT,
    avg_response_time_ms NUMERIC,
    error_count BIGINT,
    success_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_requests,
        AVG(response_time_ms)::NUMERIC as avg_response_time_ms,
        COUNT(*) FILTER (WHERE response_status >= 400) as error_count,
        (COUNT(*) FILTER (WHERE response_status < 400) * 100.0 / NULLIF(COUNT(*), 0))::NUMERIC as success_rate
    FROM service_api_key_usage
    WHERE service_name = p_service_name
      AND created_at > NOW() - (p_hours || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- GRANTS: Allow service_role to execute functions
-- ============================================================================
GRANT EXECUTE ON FUNCTION validate_service_api_key(VARCHAR, VARCHAR) TO service_role;
GRANT EXECUTE ON FUNCTION log_api_key_usage(VARCHAR, VARCHAR, INET, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION get_api_key_stats(VARCHAR, INTEGER) TO service_role;

-- ============================================================================
-- TRIGGER: Update updated_at timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION update_service_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_service_api_keys_updated_at ON service_api_keys;
CREATE TRIGGER trigger_update_service_api_keys_updated_at
    BEFORE UPDATE ON service_api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_service_api_keys_updated_at();

-- ============================================================================
-- COMMENTS: Documentation for the tables and functions
-- ============================================================================
COMMENT ON TABLE service_api_keys IS 'Stores hashed API keys for internal microservice authentication. Part of Phase 1 Security Overhaul (Jan 2026)';
COMMENT ON TABLE service_api_key_usage IS 'Audit log for service API key usage tracking';
COMMENT ON FUNCTION validate_service_api_key IS 'Validates a service API key by prefix and hash, returns service info if valid';
COMMENT ON FUNCTION log_api_key_usage IS 'Logs API key usage for audit and monitoring';
COMMENT ON FUNCTION get_api_key_stats IS 'Returns usage statistics for a service API key';
