---
tags: [type/pattern, status/active, domain/database]
created: 2026-04-10
---
# Database Patterns

Recurring patterns and conventions used across the OmniFrame PostgreSQL schema.

---

## 1. Multi-Tenancy Pattern

**Every operational table** includes:
```sql
organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
```

This column is the primary tenant isolation mechanism. Combined with RLS policies, it ensures data never leaks between organizations.

**Convention:** Always include `organization_id` as the first column after `id` in new tables.

---

## 2. RLS Policy Patterns

### Standard Organization-Scoped Access
Used on most tables. Authenticates via `auth.uid()` and looks up the user's org from `user_profiles`.

```sql
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

CREATE POLICY "table_select_org" ON table_name
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "table_insert_org" ON table_name
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
    AND created_by = auth.uid()  -- optional: enforce creator tracking
  );

CREATE POLICY "table_update_org" ON table_name
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );
```

### Admin-Only Access (sensitive tables like audit logs, security events)
```sql
CREATE POLICY "admin_only_select" ON sensitive_table
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid()
      AND r.name IN ('superadmin', 'admin')
    )
  );
```

### JWT Metadata Scoping (warehouse map tables)
Used when org_id is embedded in JWT user_metadata instead of queried from user_profiles:
```sql
CREATE POLICY "jwt_scoped" ON table_name
  FOR SELECT USING (
    organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
  );
```

### Service Role Full Access
```sql
CREATE POLICY "service_full" ON table_name
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**Naming convention:** Policies use human-readable names like `"Users can view X from their organization"`.

---

## 3. UUID Primary Keys

All tables use UUIDs:
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()  -- newer migrations
id UUID PRIMARY KEY DEFAULT uuid_generate_v4()  -- older migrations
```

Preferred: `gen_random_uuid()` (built into PostgreSQL 13+, no extension needed).

---

## 4. Timestamp Columns + Auto-Update Trigger

Every table includes:
```sql
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

With a `BEFORE UPDATE` trigger:
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_table_updated_at
  BEFORE UPDATE ON table_name
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Note:** Multiple migrations define this same function. Later migrations use `CREATE OR REPLACE` to safely re-declare it.

---

## 5. Audit Trail Pattern

Operational tables have audit triggers that insert into `audit_logs`:
```sql
CREATE OR REPLACE FUNCTION audit_table_name()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (
      user_id, organization_id, action, resource_type, resource_id, changes
    ) VALUES (
      NEW.created_by, NEW.organization_id,
      'create'::audit_action, 'resource_type', NEW.id::TEXT,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (...) VALUES (
      ..., 'update'::audit_action, ...,
      jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
```

For RBAC-specific changes, the more detailed `rbac_audit_logs` table is used with `log_rbac_audit_event()` function.

---

## 6. SECURITY DEFINER Functions

RPC functions use `SECURITY DEFINER` to bypass RLS when needed:
```sql
CREATE OR REPLACE FUNCTION function_name(...)
RETURNS ... 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public  -- CRITICAL: Prevents search_path injection
AS $$ ... $$;
```

**Migration 173** hardened all existing SECURITY DEFINER functions to explicitly set `search_path = public`.

**Grant pattern:**
```sql
GRANT EXECUTE ON FUNCTION function_name(...) TO authenticated, service_role;
-- Destructive/cleanup functions: only service_role
GRANT EXECUTE ON FUNCTION cleanup_function(...) TO service_role;
```

---

## 7. Recursive Role Hierarchy CTE

The RBAC system uses a recursive CTE to traverse the role hierarchy:
```sql
WITH RECURSIVE role_chain AS (
  SELECT r.id, r.name, r.parent_role_id, 0 as level, ARRAY[r.id] as path
  FROM roles r
  JOIN user_profiles up ON up.role_id = r.id
  WHERE up.id = p_user_id AND r.is_active = true
  
  UNION ALL
  
  SELECT r.id, r.name, r.parent_role_id, rc.level + 1, rc.path || r.id
  FROM roles r
  JOIN role_chain rc ON r.id = rc.parent_role_id
  WHERE r.is_active = true
    AND rc.level < 10           -- Prevent infinite recursion
    AND NOT r.id = ANY(rc.path) -- Prevent cycles
)
```

This pattern is used in `get_user_inherited_permissions()`, `get_user_permissions_fast()`, `get_user_role_info()`, and `check_user_permission_fast()`.

---

## 8. Sequential Number Generation

Several entities use human-readable sequential identifiers:

| Entity | Format | Function |
|--------|--------|----------|
| Putback tickets | `Putback-00001` | `generate_putback_number(org_id)` |
| Cycle counts | `CC-YYYYMMDD-XXXX` | `generate_count_number()` |

**Pattern:** Query `MAX()` of the numeric suffix, increment, and `LPAD()` with zeros.

---

## 9. Enum Types

PostgreSQL enums are used for constrained status fields:

| Enum | Values |
|------|--------|
| `putback_status` | open, completed, cancelled |
| `cycle_count_status` | pending, in_progress, completed, variance_review, approved, cancelled |
| `audit_action` | create, update, delete, etc. |
| `sap_transaction_status` | success, error, skipped, pending |
| `warehouse_operational_status` | active, maintenance, shutdown, reserved, blocked |
| `warehouse_revision_status` | draft, published, archived, rolled_back |
| `path_strategy` | serpentine_zone, directional, alternating_aisles |

Some newer tables use CHECK constraints instead of enums for easier evolution:
```sql
status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled'))
```

---

## 10. Index Patterns

### Standard indexes on every table:
```sql
CREATE INDEX idx_table_organization_id ON table(organization_id);
CREATE INDEX idx_table_created_at ON table(created_at DESC);
CREATE INDEX idx_table_status ON table(status);
```

### Partial indexes for common filtered queries:
```sql
CREATE INDEX idx_table_active ON table(organization_id, status)
  WHERE status = 'active';
CREATE INDEX idx_table_pending ON table(organization_id, priority DESC, created_at ASC)
  WHERE status = 'pending';
```

### Covering indexes to avoid table lookups:
```sql
CREATE INDEX idx_covering ON table(id, resource, action)
  INCLUDE (is_critical, requires_2fa);
```

### CONCURRENTLY keyword for production safety:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_name ON table(...);
```

---

## 11. Optimistic Concurrency Control

The warehouse map uses optimistic concurrency to prevent stale updates:
```sql
-- Pass expected_updated_at from client
IF v_current_ts <> p_expected_updated_at THEN
  RAISE EXCEPTION 'Stale update — record was modified at %. Expected %.', ...;
END IF;
```

---

## 12. Work Queue Locking

The work queue uses `FOR UPDATE SKIP LOCKED` for concurrent task assignment:
```sql
SELECT * FROM work_queue
WHERE status = 'pending'
ORDER BY priority DESC, created_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

This ensures multiple workers can safely claim tasks without conflicts.

---

## 13. JSONB for Flexible Data

JSONB is used extensively for:
- `features JSONB` on roles — feature flags per role
- `metadata JSONB` on permissions — extensible permission metadata
- `required_components JSONB` on kit definitions — bill of materials
- `task_data JSONB` / `result_data JSONB` on work queue — flexible task payloads
- `grid_settings JSONB`, `canvas_settings JSONB`, `building_outline JSONB` on warehouse maps
- `smart_filter JSONB` on MDM device groups — dynamic group criteria
- `skills JSONB`, `certifications JSONB` on worker profiles

GIN indexes are used for JSONB search:
```sql
CREATE INDEX idx_metadata ON table USING gin(metadata);
```

---

## 14. Migration Conventions

1. **File naming:** `NNN_descriptive_snake_case.sql`
2. **Idempotent:** Use `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `CREATE OR REPLACE`
3. **Table comments:** Every table and key column has a `COMMENT ON` statement
4. **Success messages:** Migrations end with `RAISE NOTICE 'Migration NNN: Description completed successfully'`
5. **Explicit grants:** `GRANT SELECT, INSERT, UPDATE ON table TO authenticated`
6. **RLS always enabled:** `ALTER TABLE table ENABLE ROW LEVEL SECURITY` on every new table

---

## 15. Auto-Resolve Trigger Pattern

Used in cycle count path engine — automatically resolves data on INSERT or field UPDATE:
```sql
CREATE TRIGGER trigger_auto_resolve_location
  BEFORE INSERT OR UPDATE OF location, warehouse ON rr_cyclecount_data
  FOR EACH ROW
  EXECUTE FUNCTION auto_resolve_cycle_count_location();
```

The trigger function cascades through resolution strategies: direct map match → regex rules → unresolved fallback.

## Related
- [[Database-Schema-Overview]]
- [[Supabase-Configuration]]
- [[Migration-History]]
- [[ADR-Auth-Architecture]]