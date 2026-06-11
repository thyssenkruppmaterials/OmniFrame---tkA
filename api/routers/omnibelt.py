# Created and developed by Jai Singh
"""
FastAPI router for OmniBelt operations.

P2 of the OmniBelt MVP rollout (2026-05-24).

Five endpoints:

1. ``GET  /api/omnibelt/bootstrap``           — proxy to ``rust-dashboard-service``
2. ``POST /api/omnibelt/prefs``               — write per-user prefs (RLS-gated)
3. ``POST /api/omnibelt/events``              — batched telemetry insert (rate-limited)
4. ``POST /api/admin/omnibelt/role-config``   — admin write (pg_notify auto-fires)
5. ``POST /api/admin/omnibelt/kill-switch``   — admin write + manual pg_notify

Auth model:
- All endpoints require an authenticated user (JWT validated via
  ``rust-core-service``).
- Admin endpoints additionally require ``omnibelt.manage`` permission.

Read paths route through ``rust-dashboard-service`` (which uses its
read replica + 30s Redis cache). Write paths use ``db.client`` (primary
Supabase) with RLS in effect — the client validates ``auth.uid()`` for
``omnibelt_user_prefs`` and ``omnibelt_tool_events``, and the
``omnibelt.manage`` permission for ``omnibelt_role_config`` /
``settings``.

Realtime invalidation: writes to ``omnibelt_role_config`` automatically
fire the ``omnibelt_config_changed`` Postgres trigger (migration 327)
which ``rust-work-service``'s ``omnibelt_listener`` consumes —
broadcasting ``WsEvent::OmnibeltConfigChanged`` and DEL'ing the cache
keys. Writes to ``settings`` don't have that trigger, so the kill-switch
endpoint manually issues ``pg_notify`` afterwards.
"""

import json
import logging
import os
from typing import Annotated, Any, Optional

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

try:
    from ..auth.supabase_auth import (
        AuthenticatedUser,
        get_current_user,
        require_permission,
    )
    from ..auth.supabase_client_auth import create_authenticated_supabase_client
    from ..config.database import db
    from ..lib.cache.redis_service import get_redis_service
except ImportError:
    try:
        from auth.supabase_auth import (
            AuthenticatedUser,
            get_current_user,
            require_permission,
        )
        from auth.supabase_client_auth import create_authenticated_supabase_client
        from config.database import db
        from lib.cache.redis_service import get_redis_service
    except ImportError:
        from api.auth.supabase_auth import (
            AuthenticatedUser,
            get_current_user,
            require_permission,
        )
        from api.auth.supabase_client_auth import (
            create_authenticated_supabase_client,
        )
        from api.config.database import db
        from api.lib.cache.redis_service import get_redis_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Where the rust-dashboard-service lives. Falls back to the docker-compose
# / Railway internal hostname; override with the ``RUST_DASHBOARD_SERVICE_URL``
# env var. The bootstrap proxy is the only consumer today.
RUST_DASHBOARD_SERVICE_URL = os.getenv(
    "RUST_DASHBOARD_SERVICE_URL",
    "http://rust-dashboard-service:8002",
).rstrip("/")

# Telemetry input cap per request (defence-in-depth alongside the per-user
# Redis sliding window). The FE batcher caps at 50 events per flush; we
# enforce the same shape server-side.
MAX_EVENTS_PER_REQUEST = 50
TELEMETRY_RATE_LIMIT_MAX = 50  # events / minute / user
TELEMETRY_RATE_LIMIT_WINDOW = 60  # seconds

# HTTP timeouts for the rust-dashboard-service proxy. Bootstrap is a hot
# path; keep these tight so degraded mode kicks in quickly when the Rust
# service is wedged.
PROXY_CONNECT_TIMEOUT = 2.0
PROXY_READ_TIMEOUT = 5.0


router = APIRouter(
    tags=["OmniBelt"],
    responses={404: {"description": "Not found"}},
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class OmnibeltPrefsUpdate(BaseModel):
    """Subset of ``omnibelt_user_prefs`` columns that the FE may write.

    All fields optional — the FE PATCHes only the subset the user just
    changed. ``user_id`` and ``organization_id`` are derived server-side
    from the authenticated session; the FE is forbidden from spoofing
    either.
    """

    model_config = ConfigDict(extra="forbid")

    pinned_tool_ids: Optional[list[str]] = None
    hidden_tool_ids: Optional[list[str]] = None
    tool_order: Optional[list[str]] = None
    position_by_route: Optional[dict[str, Any]] = None
    skin: Optional[str] = Field(
        default=None,
        description="One of: pill, orb, skystrip, or null to inherit role default.",
    )
    mach3_behavior: Optional[str] = Field(
        default=None,
        description="halo_only | halo_plus_autoexpand | halo_plus_morph | halo_plus_tray_pinned",
    )
    auto_hide_after_seconds: Optional[int] = Field(default=None, ge=0, le=600)
    user_hidden: Optional[bool] = None


class OmnibeltEventInput(BaseModel):
    """Single telemetry event from the FE batcher.

    ``occurred_at`` is optional — the DB ``DEFAULT now()`` fills it in
    when omitted, which is the typical case. Setting it explicitly is
    only useful for backfills (queued events that flushed late on
    ``visibilitychange``).
    """

    model_config = ConfigDict(extra="forbid")

    tool_id: Optional[str] = None
    event_type: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    occurred_at: Optional[str] = None


class OmnibeltRoleConfigUpdate(BaseModel):
    """Admin write payload for ``omnibelt_role_config``.

    The ``role_id`` and ``organization_id`` together uniquely identify
    the row (UNIQUE constraint on ``(organization_id, role_id)``); the
    handler upserts on that pair so admins can either author a new
    role config or update an existing one with the same payload shape.
    """

    model_config = ConfigDict(extra="forbid")

    role_id: str
    default_tool_ids: list[str] = Field(default_factory=list)
    default_pinned_ids: list[str] = Field(default_factory=list)
    default_position: dict[str, Any] = Field(
        default_factory=lambda: {"anchor": "BR", "offset": {"x": 24, "y": 24}}
    )
    default_skin: str = Field(default="pill")


class KillSwitchUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


def require_omnibelt_admin():
    """Admin-gate matching the spec ``omnibelt.manage`` permission.

    The permission resource was seeded in migration 327 and granted to
    ``admin`` + ``superadmin`` by default. ``require_permission`` checks
    against the user's resolved permissions list (which the rust-core
    profile fetch populates). Wildcard ``*`` and ``admin:*`` grants
    pass through unchanged.

    NOTE: the permission name uses a DOT separator (``omnibelt.manage``)
    to match the DB seed convention (``cubiscan.view``,
    ``warehouse_maps.view``, ``production_boards.edit`` all do the same).
    The earlier ``omnibelt:manage`` form returned 403 for every admin —
    `require_permission` does exact-string matching on the user's
    permission list, and the DB row was always stored with a dot.
    """
    return require_permission("omnibelt.manage")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _bearer_from_request(request: Request) -> Optional[str]:
    """Re-extract the original Authorization header so the proxy can
    forward it verbatim. The dependency injection chain converts the
    JWT into an ``AuthenticatedUser`` but doesn't keep the raw token,
    and ``rust-dashboard-service`` validates the JWT itself via
    ``rust-core-service`` so the proxy can't substitute a service key
    here without losing per-user RLS scoping.
    """
    auth = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if not auth:
        return None
    return auth


def _jwt_from_request(request: Request) -> Optional[str]:
    """Strip the ``Bearer `` prefix from the Authorization header so we
    can hand the raw JWT to ``create_authenticated_supabase_client``.
    Returns None when the header is missing or malformed; callers should
    treat that as a 401 (``get_current_user`` already enforces presence
    upstream, but we re-check here so the helper is safe to call
    standalone).
    """
    bearer = _bearer_from_request(request)
    if not bearer:
        return None
    parts = bearer.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip() or None
    return bearer.strip() or None


def _user_scoped_client(request: Request):
    """Build a per-request Supabase client bound to the caller's JWT so
    RLS policies see ``auth.uid()`` and ``has_permission(...)`` evaluate
    against the real user.

    Why this exists: ``db.client`` is a process-wide singleton created
    with the anon key. Any write through it reaches PostgREST as the
    ``anon`` role with ``auth.uid()`` NULL — so RLS on ``settings``
    (and on ``omnibelt_role_config``) denies the request even for
    legitimate admins. That manifested as the production 42501 error
    on ``POST /api/admin/omnibelt/kill-switch``. The fix is to mint a
    short-lived authenticated client per request and use it for the
    write. Reads still go through ``db.read_client`` (replica) where
    appropriate.

    Falls back to ``db.client`` only when the JWT is missing — but the
    admin endpoints all depend on ``require_omnibelt_admin``, which
    chains through ``get_current_user`` and 401s on a missing header,
    so this fallback is unreachable in practice and exists purely as
    a defence-in-depth guard.
    """
    token = _jwt_from_request(request)
    if not token:
        return db.client
    return create_authenticated_supabase_client(token)


async def _fallback_bootstrap(current_user: AuthenticatedUser) -> dict[str, Any]:
    """Direct Supabase read used when ``rust-dashboard-service`` is
    unreachable or returning a 5xx. Mirrors the JSON shape the Rust
    endpoint emits — the FE consumes either path identically.

    Reads via ``db.read_client`` so the load-balanced replica endpoint
    serves the query when configured, the primary otherwise.
    """
    client = db.read_client

    user_id = current_user.id
    org_id = current_user.organization_id
    role_name = current_user.role

    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context required",
        )

    # Kill switch
    kill_switch = {"enabled": True, "source": "none"}
    try:
        ks_resp = (
            client.table("settings")
            .select("value")
            .eq("key", "system.omnibelt.enabled")
            .is_("user_id", "null")
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
        if ks_resp.data:
            value = ks_resp.data[0].get("value") or {}
            kill_switch = {
                "enabled": bool(value.get("enabled", True)),
                "source": "org",
            }
    except Exception as e:  # pragma: no cover — degraded path
        logger.warning("[OmniBelt fallback] kill-switch read failed: %s", e)

    # Allow list
    allow_list: list[str] = []
    try:
        al_resp = (
            client.table("settings")
            .select("value")
            .eq("key", "system.omnibelt.allow_list")
            .is_("user_id", "null")
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
        if al_resp.data:
            value = al_resp.data[0].get("value") or {}
            tool_ids = value.get("tool_ids")
            if isinstance(tool_ids, list):
                allow_list = [str(t) for t in tool_ids if isinstance(t, str)]
    except Exception as e:  # pragma: no cover
        logger.warning("[OmniBelt fallback] allow-list read failed: %s", e)

    # Role config
    role_config: Optional[dict[str, Any]] = None
    if role_name:
        try:
            role_lookup = (
                client.table("roles")
                .select("id")
                .eq("name", role_name)
                .limit(1)
                .execute()
            )
            if role_lookup.data:
                role_id = role_lookup.data[0]["id"]
                rc_resp = (
                    client.table("omnibelt_role_config")
                    .select("*")
                    .eq("organization_id", org_id)
                    .eq("role_id", role_id)
                    .limit(1)
                    .execute()
                )
                if rc_resp.data:
                    role_config = rc_resp.data[0]
        except Exception as e:  # pragma: no cover
            logger.warning("[OmniBelt fallback] role_config read failed: %s", e)

    # User prefs
    user_prefs: Optional[dict[str, Any]] = None
    try:
        up_resp = (
            client.table("omnibelt_user_prefs")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if up_resp.data:
            user_prefs = up_resp.data[0]
    except Exception as e:  # pragma: no cover
        logger.warning("[OmniBelt fallback] user_prefs read failed: %s", e)

    return {
        "kill_switch": kill_switch,
        "role_config": role_config,
        "user_prefs": user_prefs,
        "allow_list": allow_list,
        "tool_registry_version": 1,
        "initial_active_jobs": [],
    }


# ---------------------------------------------------------------------------
# Endpoints — user-scoped
# ---------------------------------------------------------------------------


@router.get("/omnibelt/bootstrap")
async def bootstrap_proxy(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Proxy to ``rust-dashboard-service`` ``GET /omnibelt/bootstrap``.

    Forwards the user's JWT verbatim so ``rust-core-service`` validates
    it. On Rust outage (timeout / connection refused / 5xx), falls back
    to a direct Supabase read via ``db.read_client`` and logs the fallback
    at ``warning`` level. The fallback is a feature-parity safety net
    so OmniBelt keeps working during a Rust deploy.
    """
    bearer = _bearer_from_request(request)
    if not bearer:
        # Defence-in-depth: get_current_user already enforces this, but
        # the proxy needs the raw header to forward.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required",
        )

    url = f"{RUST_DASHBOARD_SERVICE_URL}/omnibelt/bootstrap"
    timeout = httpx.Timeout(
        timeout=PROXY_READ_TIMEOUT,
        connect=PROXY_CONNECT_TIMEOUT,
    )

    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            resp = await http.get(url, headers={"Authorization": bearer})
        if resp.status_code == status.HTTP_200_OK:
            return resp.json()
        if 500 <= resp.status_code < 600:
            logger.warning(
                "[OmniBelt] rust-dashboard returned %s — falling back to direct Supabase read",
                resp.status_code,
            )
            return await _fallback_bootstrap(current_user)
        # Surface 4xx verbatim — those are auth / validation errors we
        # want the FE to see.
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    except httpx.HTTPError as e:
        logger.warning(
            "[OmniBelt] rust-dashboard unreachable (%s) — falling back to direct Supabase read",
            e,
        )
        return await _fallback_bootstrap(current_user)


@router.post("/omnibelt/prefs")
async def write_prefs(
    payload: Annotated[OmnibeltPrefsUpdate, Body(...)],
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Upsert this user's ``omnibelt_user_prefs`` row.

    The FE PATCHes a partial subset of the model fields. We upsert via
    the primary client; RLS enforces ``user_id = auth.uid()`` so a
    spoofed ``user_id`` in the payload (impossible — the model forbids
    it) wouldn't bypass policy anyway.
    """
    if not current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context required",
        )

    # Strip None fields so we don't blast over a column with NULL when
    # the FE only intended to update a different one.
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    data["user_id"] = current_user.id
    data["organization_id"] = current_user.organization_id

    try:
        resp = (
            db.client.table("omnibelt_user_prefs")
            .upsert(data, on_conflict="user_id")
            .execute()
        )
        if not resp.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="upsert returned no rows",
            )
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[OmniBelt] prefs write failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"prefs write failed: {e}",
        )


@router.post("/omnibelt/events")
async def write_events(
    payload: Annotated[list[OmnibeltEventInput], Body(...)],
    current_user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Batched telemetry insert.

    Defence-in-depth checks (in order):

    1. Hard cap on per-request batch size (50) — matches the FE batcher.
    2. Server-side Redis sliding-window rate limit (50 events/min/user).
    3. Insert via primary; RLS enforces ``user_id = auth.uid()``.

    Returns ``{ inserted: int, throttled: bool }`` so the FE can decide
    whether to drop or retry the next batch.
    """
    if not payload:
        return {"inserted": 0, "throttled": False}

    if len(payload) > MAX_EVENTS_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Batch exceeds {MAX_EVENTS_PER_REQUEST} events",
        )

    if not current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context required",
        )

    # Sliding-window rate limit.
    redis_service = await get_redis_service()
    rl_key = f"omnibelt-events:{current_user.id}"
    allowed = await redis_service.check_rate_limit(
        rl_key,
        max_requests=TELEMETRY_RATE_LIMIT_MAX,
        window_seconds=TELEMETRY_RATE_LIMIT_WINDOW,
    )
    if not allowed:
        # Spec §17.1 — overflow drops with a debug log; we surface 429
        # so the FE can tell its batcher to back off.
        logger.debug(
            "[OmniBelt] telemetry rate-limited for user %s", current_user.id
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Telemetry rate limit exceeded",
        )

    rows: list[dict[str, Any]] = []
    for ev in payload:
        row: dict[str, Any] = {
            "user_id": current_user.id,
            "organization_id": current_user.organization_id,
            "event_type": ev.event_type,
            "metadata": ev.metadata or {},
        }
        if ev.tool_id:
            row["tool_id"] = ev.tool_id
        else:
            # The CHECK constraint requires a non-null tool_id. Stamp
            # an explicit empty-string sentinel so the FE doesn't have
            # to special-case non-tool events; downstream queries filter
            # on event_type anyway.
            row["tool_id"] = ""
        if ev.occurred_at:
            row["occurred_at"] = ev.occurred_at
        rows.append(row)

    try:
        resp = db.client.table("omnibelt_tool_events").insert(rows).execute()
        return {"inserted": len(resp.data or rows), "throttled": False}
    except Exception as e:
        logger.error("[OmniBelt] events insert failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"events insert failed: {e}",
        )


# ---------------------------------------------------------------------------
# Endpoints — admin-gated
# ---------------------------------------------------------------------------


admin_router = APIRouter(
    tags=["OmniBelt Admin"],
    responses={404: {"description": "Not found"}},
)


@admin_router.post("/omnibelt/role-config")
async def write_role_config(
    request: Request,
    payload: Annotated[OmnibeltRoleConfigUpdate, Body(...)],
    current_user: Annotated[
        AuthenticatedUser, Depends(require_omnibelt_admin())
    ],
) -> dict[str, Any]:
    """Upsert an ``omnibelt_role_config`` row for the admin's org.

    The unique constraint on ``(organization_id, role_id)`` makes this
    a natural upsert: idempotent for the same role, single row per
    role+org. The ``omnibelt_role_config_notify`` trigger from
    migration 327 fires automatically on every INSERT/UPDATE/DELETE,
    which ``rust-work-service`` consumes and broadcasts.

    Writes route through a per-request JWT-bound Supabase client so
    the ``omnibelt_role_config_mutate`` RLS policy (migration 327)
    can resolve ``auth.uid()`` and evaluate
    ``has_permission('omnibelt','manage')``.
    """
    if not current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context required",
        )
    data = {
        "organization_id": current_user.organization_id,
        "role_id": payload.role_id,
        "default_tool_ids": payload.default_tool_ids,
        "default_pinned_ids": payload.default_pinned_ids,
        "default_position": payload.default_position,
        "default_skin": payload.default_skin,
        "updated_by": current_user.id,
    }
    client = _user_scoped_client(request)
    try:
        resp = (
            client.table("omnibelt_role_config")
            .upsert(data, on_conflict="organization_id,role_id")
            .execute()
        )
        if not resp.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="role-config upsert returned no rows",
            )
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[OmniBelt] role-config write failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"role-config write failed: {e}",
        )


@admin_router.post("/omnibelt/kill-switch")
async def write_kill_switch(
    request: Request,
    payload: Annotated[KillSwitchUpdate, Body(...)],
    current_user: Annotated[
        AuthenticatedUser, Depends(require_omnibelt_admin())
    ],
) -> dict[str, Any]:
    """Toggle the org-wide ``settings.system.omnibelt.enabled`` row.

    The ``settings`` table doesn't carry the omnibelt NOTIFY trigger
    (only ``omnibelt_role_config`` does), so after the upsert we issue
    a manual ``pg_notify`` on the same channel so
    ``rust-work-service``'s listener fans out the change. The payload
    matches the trigger's natural shape (``{ org_id }``) so the
    listener doesn't have to special-case manually-emitted frames.

    Writes route through a per-request JWT-bound Supabase client so
    RLS sees the caller's ``auth.uid()``. The pre-existing settings
    admin policy + the additive ``settings_omnibelt_admin_rw`` policy
    (migration 329) both gate on user identity; ``db.client`` (anon
    singleton) cannot satisfy either.
    """
    if not current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context required",
        )

    org_id = current_user.organization_id
    body = {"enabled": bool(payload.enabled)}

    # User-scoped client so RLS resolves auth.uid() to the admin
    # making the request. See `_user_scoped_client` for rationale —
    # the anon-key singleton (`db.client`) was the production 42501
    # root cause.
    client = _user_scoped_client(request)

    # The OmniBelt kill-switch is intentionally global (one row per
    # cluster, ``user_id IS NULL`` and ``organization_id IS NULL``
    # per spec §4.3) — match that shape on read-before-write.
    try:
        existing = (
            client.table("settings")
            .select("id")
            .eq("key", "system.omnibelt.enabled")
            .is_("user_id", "null")
            .is_("organization_id", "null")
            .limit(1)
            .execute()
        )
        if existing.data:
            settings_id = existing.data[0]["id"]
            client.table("settings").update(
                {"value": body}
            ).eq("id", settings_id).execute()
        else:
            client.table("settings").insert(
                {"key": "system.omnibelt.enabled", "value": body}
            ).execute()
    except Exception as e:
        logger.error("[OmniBelt] kill-switch write failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"kill-switch write failed: {e}",
        )

    # Fire the manual NOTIFY so rust-work-service broadcasts. Wrapped
    # in a best-effort try/except — the FE will still see the change
    # via the next bootstrap fetch (cache TTL 30s) if this fails.
    try:
        admin = db.admin_client
        if admin is not None:
            payload_str = json.dumps({"org_id": org_id})
            # Supabase's Postgres function call surface — we can't run
            # raw SQL via PostgREST, so we use a tiny helper RPC. The
            # function ``omnibelt_pg_notify_kill_switch(p_org_id)`` may
            # not exist in every environment; fall back silently.
            try:
                admin.rpc(
                    "omnibelt_pg_notify_kill_switch",
                    {"p_org_id": org_id},
                ).execute()
            except Exception as rpc_err:
                logger.debug(
                    "[OmniBelt] kill-switch pg_notify RPC unavailable (%s) — "
                    "FE will refresh on next bootstrap fetch",
                    rpc_err,
                )
                _ = payload_str  # keep linter happy when RPC missing
    except Exception as e:  # pragma: no cover
        logger.warning("[OmniBelt] kill-switch notify failed: %s", e)

    return {"enabled": payload.enabled}


# Final composite router — main.py mounts ``router`` under ``/api`` and
# ``admin_router`` under ``/api/admin``. Keeping them split simplifies
# the gating story (the user-scoped router only depends on
# ``get_current_user``, the admin one adds ``require_omnibelt_admin``
# at the dependency level).
__all__ = ["router", "admin_router"]

# Created and developed by Jai Singh
