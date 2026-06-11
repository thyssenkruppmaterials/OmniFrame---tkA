-- Phase 10 of `.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md` —
-- agent identity v2. Service-key authentication replaces the previous
-- "agent inherits a human user's Supabase session" pattern.
--
-- Lifecycle:
--   * Admin registers an agent via the Setup UI ⇒ a new `omni_sk_*`
--     plaintext key is generated, an Argon2id hash is persisted here,
--     and the plaintext is shown ONCE in a copy-to-clipboard dialog
--     (never recoverable).
--   * Agent boots with the plaintext key sitting on disk
--     (`~/.omniframe/agent_service_key.txt`), exchanges it via
--     `POST /api/v1/agent-identity/exchange`, receives a 15-min
--     short-lived JWT signed by `WORK_SERVICE_AGENT_JWT_SECRET`, and
--     refreshes ~60s before expiry.
--   * Admin revokes via `POST /api/v1/agent-identity/revoke` setting
--     `revoked_at = now()`. The middleware checks `revoked_at IS NULL`
--     for `kind: "agent"` JWTs (cached for 60s in Redis to avoid
--     hot-path DB hits) so revocation is effective within ~60s.
--
-- Security design:
--   * NEVER persist the plaintext key. Only Argon2id hash + 8-char
--     prefix for admin UI fingerprinting.
--   * Argon2id parameters: memory_cost=64MB, time_cost=3, parallelism=4
--     (see ADR-Agent-Identity-V2-Phase10).
--   * Active-row uniqueness: at most ONE non-revoked key per
--     (organization_id, agent_id). Re-registering an agent first
--     requires revoking the existing key.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.agent_service_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,
  -- Argon2id hash of the service key. PHC-string format
  -- (`$argon2id$v=19$m=...$t=...$p=...$<salt>$<hash>`). NEVER the
  -- plaintext.
  key_hash        TEXT NOT NULL,
  -- First 8 chars of plaintext key (e.g. `omni_sk_`). Shown in admin
  -- UI for fingerprinting; safe to store because the key prefix
  -- alone has zero entropy beyond that constant.
  key_prefix      TEXT NOT NULL,
  -- Human-readable label (e.g. "Citrix-OmniBox-01"). Optional.
  label           TEXT,
  created_by      UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bumped on every successful `/exchange` call; used for the admin
  -- UI's "last_used_at" column.
  last_used_at    TIMESTAMPTZ,
  -- NULL = active. Set to `now()` when admin revokes.
  revoked_at      TIMESTAMPTZ,
  revoked_by      UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  revoke_reason   TEXT,
  -- At most one ACTIVE key per (organization, agent_id). The
  -- `NULLS NOT DISTINCT` clause makes (org, agent, NULL) collide
  -- with (org, agent, NULL) so a duplicate active key is impossible
  -- — but two different revoked rows are fine (each carries a
  -- distinct non-NULL `revoked_at`).
  CONSTRAINT agent_service_keys_unique_active
    UNIQUE NULLS NOT DISTINCT (organization_id, agent_id, revoked_at)
);

CREATE INDEX IF NOT EXISTS idx_agent_service_keys_org_active
  ON public.agent_service_keys (organization_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_service_keys_agent_id
  ON public.agent_service_keys (agent_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.agent_service_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_service_keys admin read" ON public.agent_service_keys;
CREATE POLICY "agent_service_keys admin read" ON public.agent_service_keys
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

DROP POLICY IF EXISTS "agent_service_keys admin write" ON public.agent_service_keys;
CREATE POLICY "agent_service_keys admin write" ON public.agent_service_keys
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

COMMENT ON TABLE public.agent_service_keys IS
  'Phase 10 (Agent Identity v2) — service-key authentication for the omni_agent fleet. Plaintext key is returned ONCE at registration and is NEVER recoverable; only the Argon2id hash is persisted here. Admin revocation via `revoked_at` column; the middleware caches revocation status for 60s in Redis. See `Decisions/ADR-Agent-Identity-V2-Phase10.md`.';

COMMENT ON COLUMN public.agent_service_keys.key_hash IS
  'Argon2id hash of the plaintext key in PHC-string format. Parameters: memory_cost=64MB, time_cost=3, parallelism=4. See ADR-Agent-Identity-V2-Phase10.';

COMMENT ON COLUMN public.agent_service_keys.key_prefix IS
  'First 8 chars of the plaintext key (e.g. `omni_sk_`). Used in admin UI for fingerprinting; safe to store.';

COMMENT ON COLUMN public.agent_service_keys.revoked_at IS
  'NULL while the key is active. Set to `now()` when admin revokes via `POST /api/v1/agent-identity/revoke`. Once non-NULL the row is excluded from `/exchange` lookups and the middleware revocation check trips on subsequent agent JWT verifications.';
