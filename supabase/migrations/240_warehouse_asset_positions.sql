-- ============================================================================
-- Migration 240: Warehouse Asset Positions (Live Tracking)
--   Live forklift / operator / equipment positions on a map. Designed for
--   ingestion by BLE/UWB beacons or manual operator check-ins.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'warehouse_asset_kind') THEN
    CREATE TYPE warehouse_asset_kind AS ENUM (
      'forklift', 'operator', 'cart', 'pallet_jack', 'robot', 'sensor', 'other'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS warehouse_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id          UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_id     VARCHAR(100),
  display_name    VARCHAR(255) NOT NULL,
  kind            warehouse_asset_kind NOT NULL DEFAULT 'forklift',
  color           VARCHAR(7) DEFAULT '#3b82f6',
  active          BOOLEAN NOT NULL DEFAULT true,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (map_id, external_id)
);

CREATE TABLE IF NOT EXISTS warehouse_asset_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID NOT NULL REFERENCES warehouse_assets(id) ON DELETE CASCADE,
  map_id          UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  x               NUMERIC NOT NULL,
  y               NUMERIC NOT NULL,
  floor_level     INTEGER NOT NULL DEFAULT 0,
  heading_deg     NUMERIC,
  speed_mps       NUMERIC,
  source          VARCHAR(50) NOT NULL DEFAULT 'manual', -- 'ble', 'uwb', 'manual', 'gps', 'tag-scan'
  metadata        JSONB,
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_asset_position_latest (
  asset_id        UUID PRIMARY KEY REFERENCES warehouse_assets(id) ON DELETE CASCADE,
  map_id          UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  x               NUMERIC NOT NULL,
  y               NUMERIC NOT NULL,
  floor_level     INTEGER NOT NULL DEFAULT 0,
  heading_deg     NUMERIC,
  speed_mps       NUMERIC,
  source          VARCHAR(50),
  metadata        JSONB,
  observed_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_warehouse_assets_map ON warehouse_assets (map_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_assets_org ON warehouse_assets (organization_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_positions_asset_observed
  ON warehouse_asset_positions (asset_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_positions_map_observed
  ON warehouse_asset_positions (map_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_asset_position_latest_map
  ON warehouse_asset_position_latest (map_id);

ALTER TABLE warehouse_assets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_asset_positions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_asset_position_latest   ENABLE ROW LEVEL SECURITY;

CREATE POLICY warehouse_assets_select_org ON warehouse_assets FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_assets_insert_org ON warehouse_assets FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_assets_update_org ON warehouse_assets FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_assets_delete_org ON warehouse_assets FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY warehouse_asset_positions_select_org ON warehouse_asset_positions FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_asset_positions_insert_org ON warehouse_asset_positions FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY warehouse_asset_position_latest_select_org ON warehouse_asset_position_latest FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_asset_position_latest_insert_org ON warehouse_asset_position_latest FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_asset_position_latest_update_org ON warehouse_asset_position_latest FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE TRIGGER trg_warehouse_assets_updated_at
  BEFORE UPDATE ON warehouse_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================================
-- ingest_asset_position
-- =========================================================================

CREATE OR REPLACE FUNCTION ingest_asset_position(
  p_asset_id     UUID,
  p_x            NUMERIC,
  p_y            NUMERIC,
  p_floor_level  INTEGER DEFAULT 0,
  p_heading_deg  NUMERIC DEFAULT NULL,
  p_speed_mps    NUMERIC DEFAULT NULL,
  p_source       TEXT    DEFAULT 'manual',
  p_metadata     JSONB   DEFAULT NULL,
  p_observed_at  TIMESTAMPTZ DEFAULT NULL
)
RETURNS warehouse_asset_position_latest
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map_id  UUID;
  v_org_id  UUID;
  v_obs_at  TIMESTAMPTZ;
  v_row     warehouse_asset_position_latest;
BEGIN
  v_obs_at := COALESCE(p_observed_at, now());

  SELECT map_id, organization_id INTO v_map_id, v_org_id
    FROM warehouse_assets WHERE id = p_asset_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found: %', p_asset_id;
  END IF;

  INSERT INTO warehouse_asset_positions (
    asset_id, map_id, organization_id, x, y, floor_level,
    heading_deg, speed_mps, source, metadata, observed_at
  ) VALUES (
    p_asset_id, v_map_id, v_org_id, p_x, p_y, p_floor_level,
    p_heading_deg, p_speed_mps, p_source, p_metadata, v_obs_at
  );

  INSERT INTO warehouse_asset_position_latest (
    asset_id, map_id, organization_id, x, y, floor_level,
    heading_deg, speed_mps, source, metadata, observed_at
  ) VALUES (
    p_asset_id, v_map_id, v_org_id, p_x, p_y, p_floor_level,
    p_heading_deg, p_speed_mps, p_source, p_metadata, v_obs_at
  )
  ON CONFLICT (asset_id) DO UPDATE SET
    x = EXCLUDED.x,
    y = EXCLUDED.y,
    floor_level = EXCLUDED.floor_level,
    heading_deg = EXCLUDED.heading_deg,
    speed_mps = EXCLUDED.speed_mps,
    source = EXCLUDED.source,
    metadata = EXCLUDED.metadata,
    observed_at = EXCLUDED.observed_at
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION ingest_asset_position(UUID, NUMERIC, NUMERIC, INTEGER, NUMERIC, NUMERIC, TEXT, JSONB, TIMESTAMPTZ)
  TO authenticated, service_role;

-- =========================================================================
-- Realtime publication
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'warehouse_asset_position_latest'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_asset_position_latest';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'warehouse_assets'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_assets';
  END IF;
END $$;

-- =========================================================================
-- Optional: prune old positions (call from a scheduled job)
-- =========================================================================

CREATE OR REPLACE FUNCTION prune_asset_positions(p_keep_minutes INT DEFAULT 60)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM warehouse_asset_positions
   WHERE observed_at < now() - make_interval(mins => p_keep_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION prune_asset_positions(INT) TO authenticated, service_role;
