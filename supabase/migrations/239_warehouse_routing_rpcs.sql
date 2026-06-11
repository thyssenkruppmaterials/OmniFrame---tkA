-- ============================================================================
-- Migration 239: Warehouse Routing RPCs (A*, Pick Tour)
--   get_route(p_map_id, p_from_bin, p_to_bin)
--     Returns a polyline (array of points) using A* on warehouse_aisle_nodes
--     + warehouse_aisle_edges. Anchors at each bin's nearest_node_id (or
--     auto-snaps if unset). Supports multi-floor via stair/elevator edges.
--
--   get_pick_tour(p_map_id, p_from_bin, p_bins[])
--     Multi-bin tour: start node + N target bins, computes a nearest-neighbour
--     ordering and concatenates A* legs into one polyline + ordered bin list.
-- ============================================================================

-- =========================================================================
-- get_route — A* on the aisle graph
-- =========================================================================

CREATE OR REPLACE FUNCTION get_route(
  p_map_id    UUID,
  p_from_bin  TEXT,
  p_to_bin    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_node UUID;
  v_to_node   UUID;
  v_polyline  JSONB := '[]'::jsonb;
  v_legs      JSONB;
  v_total_cost NUMERIC := 0;
BEGIN
  -- Resolve bins → anchor nodes
  SELECT COALESCE(wlm.nearest_node_id, find_nearest_node(p_map_id, r.position_x + r.width/2.0, r.position_y + r.height/2.0))
    INTO v_from_node
    FROM warehouse_location_mappings wlm
    JOIN warehouse_racks r ON r.id = wlm.rack_id
   WHERE wlm.map_id = p_map_id AND wlm.storage_bin = p_from_bin;

  SELECT COALESCE(wlm.nearest_node_id, find_nearest_node(p_map_id, r.position_x + r.width/2.0, r.position_y + r.height/2.0))
    INTO v_to_node
    FROM warehouse_location_mappings wlm
    JOIN warehouse_racks r ON r.id = wlm.rack_id
   WHERE wlm.map_id = p_map_id AND wlm.storage_bin = p_to_bin;

  IF v_from_node IS NULL OR v_to_node IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'bin not mapped or no anchor node',
      'polyline', '[]'::jsonb
    );
  END IF;

  -- A* via recursive WITH using a relaxed Dijkstra (Postgres has no priority queue;
  -- we cap depth to avoid runaway searches on extremely dense graphs)
  WITH RECURSIVE
  edges_bidir AS (
    SELECT from_node_id AS u, to_node_id AS v, cost FROM warehouse_aisle_edges
     WHERE map_id = p_map_id
    UNION ALL
    SELECT to_node_id AS u, from_node_id AS v, cost FROM warehouse_aisle_edges
     WHERE map_id = p_map_id AND one_way = false
  ),
  search(node, total_cost, path, depth) AS (
    SELECT v_from_node, 0::NUMERIC, ARRAY[v_from_node]::UUID[], 0
    UNION ALL
    SELECT e.v, s.total_cost + e.cost, s.path || e.v, s.depth + 1
      FROM search s
      JOIN edges_bidir e ON e.u = s.node
     WHERE NOT (e.v = ANY(s.path))
       AND s.depth < 1000
       AND s.node <> v_to_node
  ),
  best_path AS (
    SELECT path, total_cost
      FROM search
     WHERE node = v_to_node
     ORDER BY total_cost ASC
     LIMIT 1
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('x', n.x, 'y', n.y, 'floor', n.floor_level, 'node_id', n.id))
        FROM unnest((SELECT path FROM best_path)) WITH ORDINALITY AS u(node_id, ord)
        JOIN warehouse_aisle_nodes n ON n.id = u.node_id
    ), '[]'::jsonb),
    (SELECT total_cost FROM best_path)
  INTO v_polyline, v_total_cost;

  IF v_polyline IS NULL OR jsonb_array_length(v_polyline) = 0 THEN
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'no path found',
      'polyline', '[]'::jsonb,
      'from_node', v_from_node,
      'to_node', v_to_node
    );
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'polyline', v_polyline,
    'total_cost', v_total_cost,
    'from_node', v_from_node,
    'to_node', v_to_node,
    'from_bin', p_from_bin,
    'to_bin', p_to_bin
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_route(UUID, TEXT, TEXT) TO authenticated, service_role;

-- =========================================================================
-- get_pick_tour — multi-bin tour using nearest-neighbour heuristic
-- =========================================================================

CREATE OR REPLACE FUNCTION get_pick_tour(
  p_map_id     UUID,
  p_from_bin   TEXT,
  p_bins       TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining   TEXT[] := p_bins;
  v_current     TEXT := p_from_bin;
  v_ordered     JSONB := '[]'::jsonb;
  v_combined    JSONB := '[]'::jsonb;
  v_total_cost  NUMERIC := 0;
  v_best_bin    TEXT;
  v_best_cost   NUMERIC;
  v_route       JSONB;
  v_candidate   TEXT;
  v_candidate_cost NUMERIC;
  v_legs        JSONB := '[]'::jsonb;
BEGIN
  WHILE array_length(v_remaining, 1) > 0 LOOP
    v_best_bin := NULL;
    v_best_cost := NULL;

    -- Pick the cheapest next bin
    FOREACH v_candidate IN ARRAY v_remaining LOOP
      v_route := get_route(p_map_id, v_current, v_candidate);
      IF (v_route ->> 'found')::BOOLEAN THEN
        v_candidate_cost := (v_route ->> 'total_cost')::NUMERIC;
        IF v_best_cost IS NULL OR v_candidate_cost < v_best_cost THEN
          v_best_bin := v_candidate;
          v_best_cost := v_candidate_cost;
        END IF;
      END IF;
    END LOOP;

    IF v_best_bin IS NULL THEN
      EXIT;
    END IF;

    -- Append to tour
    v_route := get_route(p_map_id, v_current, v_best_bin);
    v_legs := v_legs || jsonb_build_array(jsonb_build_object(
      'from_bin', v_current,
      'to_bin', v_best_bin,
      'polyline', v_route -> 'polyline',
      'cost', v_route -> 'total_cost'
    ));
    v_combined := v_combined || (v_route -> 'polyline');
    v_total_cost := v_total_cost + (v_route ->> 'total_cost')::NUMERIC;
    v_ordered := v_ordered || jsonb_build_array(v_best_bin);

    -- Advance
    v_current := v_best_bin;
    v_remaining := array_remove(v_remaining, v_best_bin);
  END LOOP;

  RETURN jsonb_build_object(
    'found', jsonb_array_length(v_ordered) = array_length(p_bins, 1),
    'ordered_bins', v_ordered,
    'legs', v_legs,
    'combined_polyline', v_combined,
    'total_cost', v_total_cost,
    'visited', jsonb_array_length(v_ordered),
    'requested', array_length(p_bins, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_pick_tour(UUID, TEXT, TEXT[]) TO authenticated, service_role;
