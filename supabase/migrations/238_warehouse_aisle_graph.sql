-- ============================================================================
-- Migration 238: Warehouse Aisle Graph (Pathfinding Foundation)
--   Tables for nodes (waypoints) and edges (walkable connections), plus
--   nearest_node_id on warehouse_location_mappings, plus a snap function.
--   Used by get_route (A*) and get_pick_tour in migration 239.
-- ============================================================================

-- =========================================================================
-- PART 1: Enums
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'warehouse_aisle_node_kind') THEN
    CREATE TYPE warehouse_aisle_node_kind AS ENUM (
      'aisle',          -- aisle intersection
      'doorway',        -- door between zones
      'pickup',         -- pickup / dropoff anchor
      'dock',           -- receiving / shipping dock
      'stair',          -- stair to next floor
      'elevator',       -- elevator to next floor
      'manual'          -- manually placed waypoint
    );
  END IF;
END $$;

-- =========================================================================
-- PART 2: Tables
-- =========================================================================

CREATE TABLE IF NOT EXISTS warehouse_aisle_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id          UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label           VARCHAR(50),
  x               NUMERIC NOT NULL,
  y               NUMERIC NOT NULL,
  floor_level     INTEGER NOT NULL DEFAULT 0,
  kind            warehouse_aisle_node_kind NOT NULL DEFAULT 'aisle',
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_aisle_edges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id          UUID NOT NULL REFERENCES warehouse_maps(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_node_id    UUID NOT NULL REFERENCES warehouse_aisle_nodes(id) ON DELETE CASCADE,
  to_node_id      UUID NOT NULL REFERENCES warehouse_aisle_nodes(id) ON DELETE CASCADE,
  cost            NUMERIC NOT NULL DEFAULT 0,
  one_way         BOOLEAN NOT NULL DEFAULT false,
  is_stair        BOOLEAN NOT NULL DEFAULT false,
  is_elevator     BOOLEAN NOT NULL DEFAULT false,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_no_self_edge CHECK (from_node_id <> to_node_id),
  UNIQUE (map_id, from_node_id, to_node_id)
);

-- nearest_node_id on mappings (anchor each cell to a walkable waypoint)
ALTER TABLE warehouse_location_mappings
  ADD COLUMN IF NOT EXISTS nearest_node_id UUID
  REFERENCES warehouse_aisle_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_aisle_nodes_map
  ON warehouse_aisle_nodes (map_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_aisle_nodes_map_floor
  ON warehouse_aisle_nodes (map_id, floor_level);
CREATE INDEX IF NOT EXISTS idx_warehouse_aisle_edges_map
  ON warehouse_aisle_edges (map_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_aisle_edges_from
  ON warehouse_aisle_edges (from_node_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_aisle_edges_to
  ON warehouse_aisle_edges (to_node_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_loc_mapping_nearest_node
  ON warehouse_location_mappings (nearest_node_id);

-- =========================================================================
-- PART 3: RLS
-- =========================================================================

ALTER TABLE warehouse_aisle_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_aisle_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY warehouse_aisle_nodes_select_org ON warehouse_aisle_nodes FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_aisle_nodes_insert_org ON warehouse_aisle_nodes FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_aisle_nodes_update_org ON warehouse_aisle_nodes FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_aisle_nodes_delete_org ON warehouse_aisle_nodes FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY warehouse_aisle_edges_select_org ON warehouse_aisle_edges FOR SELECT
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_aisle_edges_insert_org ON warehouse_aisle_edges FOR INSERT
  WITH CHECK (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_aisle_edges_update_org ON warehouse_aisle_edges FOR UPDATE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);
CREATE POLICY warehouse_aisle_edges_delete_org ON warehouse_aisle_edges FOR DELETE
  USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE TRIGGER trg_warehouse_aisle_nodes_updated_at
  BEFORE UPDATE ON warehouse_aisle_nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================================
-- PART 4: Realtime publication
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'warehouse_aisle_nodes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_aisle_nodes';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'warehouse_aisle_edges'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE warehouse_aisle_edges';
  END IF;
END $$;

-- =========================================================================
-- PART 5: Helpers
-- =========================================================================

-- find_nearest_node — by Euclidean distance on (x,y,floor_level)
CREATE OR REPLACE FUNCTION find_nearest_node(
  p_map_id      UUID,
  p_x           NUMERIC,
  p_y           NUMERIC,
  p_floor_level INT DEFAULT 0
)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.id
  FROM warehouse_aisle_nodes n
  WHERE n.map_id = p_map_id
    AND n.floor_level = p_floor_level
  ORDER BY (n.x - p_x) * (n.x - p_x) + (n.y - p_y) * (n.y - p_y)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION find_nearest_node(UUID, NUMERIC, NUMERIC, INT) TO authenticated, service_role;

-- backfill_nearest_node — populate nearest_node_id for all mappings
-- Computes the rack centroid and snaps to nearest node on its floor (default 0).
CREATE OR REPLACE FUNCTION backfill_mapping_nearest_node(p_map_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  WITH centroids AS (
    SELECT
      wlm.id AS mapping_id,
      r.position_x + (r.width  / 2.0) AS cx,
      r.position_y + (r.height / 2.0) AS cy
    FROM warehouse_location_mappings wlm
    JOIN warehouse_racks r ON r.id = wlm.rack_id
    WHERE wlm.map_id = p_map_id
  )
  UPDATE warehouse_location_mappings wlm
     SET nearest_node_id = find_nearest_node(p_map_id, c.cx, c.cy, 0)
    FROM centroids c
   WHERE wlm.id = c.mapping_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION backfill_mapping_nearest_node(UUID) TO authenticated, service_role;

-- auto_connect_nodes — connect each node to its K nearest neighbours by Manhattan
-- distance on the same floor, creating bidirectional edges. Useful as a starter.
CREATE OR REPLACE FUNCTION auto_connect_aisle_nodes(p_map_id UUID, p_k INT DEFAULT 4)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_count  INT := 0;
BEGIN
  SELECT organization_id INTO v_org_id FROM warehouse_maps WHERE id = p_map_id;

  -- Clear existing auto-generated edges
  DELETE FROM warehouse_aisle_edges
   WHERE map_id = p_map_id
     AND COALESCE(metadata ->> 'source', '') = 'auto';

  WITH ranked AS (
    SELECT
      a.id   AS from_id,
      b.id   AS to_id,
      ABS(a.x - b.x) + ABS(a.y - b.y) AS cost,
      ROW_NUMBER() OVER (
        PARTITION BY a.id
        ORDER BY (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) ASC
      ) AS rn
    FROM warehouse_aisle_nodes a
    JOIN warehouse_aisle_nodes b
      ON b.map_id = a.map_id
     AND b.floor_level = a.floor_level
     AND b.id <> a.id
    WHERE a.map_id = p_map_id
  )
  INSERT INTO warehouse_aisle_edges (
    map_id, organization_id, from_node_id, to_node_id, cost, one_way, metadata
  )
  SELECT p_map_id, v_org_id, from_id, to_id, cost, false,
         jsonb_build_object('source', 'auto')
    FROM ranked
   WHERE rn <= p_k
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION auto_connect_aisle_nodes(UUID, INT) TO authenticated, service_role;

-- =========================================================================
-- PART 6: Seed initial nodes from existing rack centroids (one-time bootstrap)
--   This gives every map an immediately-routable graph the first time the
--   pathfinding feature is used. Users can replace/refine via the editor.
-- =========================================================================

CREATE OR REPLACE FUNCTION seed_aisle_nodes_from_racks(p_map_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_count  INT := 0;
BEGIN
  SELECT organization_id INTO v_org_id FROM warehouse_maps WHERE id = p_map_id;

  INSERT INTO warehouse_aisle_nodes (
    map_id, organization_id, label, x, y, floor_level, kind, metadata
  )
  SELECT
    p_map_id,
    v_org_id,
    r.label || '-end',
    r.position_x + r.width / 2.0,
    r.position_y - 5,
    0,
    'aisle',
    jsonb_build_object('source', 'seed', 'rack_id', r.id)
  FROM warehouse_racks r
  WHERE r.map_id = p_map_id
    AND NOT EXISTS (
      SELECT 1 FROM warehouse_aisle_nodes n
      WHERE n.map_id = p_map_id
        AND n.metadata ->> 'rack_id' = r.id::text
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION seed_aisle_nodes_from_racks(UUID) TO authenticated, service_role;

COMMENT ON TABLE warehouse_aisle_nodes IS 'Walkable waypoints on a warehouse map: aisle intersections, doorways, docks, stairs, elevators.';
COMMENT ON TABLE warehouse_aisle_edges IS 'Bidirectional (or one-way) edges between aisle nodes with a traversal cost.';
COMMENT ON COLUMN warehouse_location_mappings.nearest_node_id IS 'Anchor node for routing. Pre-computed via backfill_mapping_nearest_node().';
