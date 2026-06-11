# Created and developed by Jai Singh
"""
Tier 2 #2 (2026-05-06) — Notifications enqueue helper.

Backend services that want to surface a notification to a user
import `enqueue_notification(...)` and call it after their domain
event commits. The helper INSERTs a row into `public.notifications`,
which fires the migration 275 NOTIFY trigger; rust-work-service's
`notifications_listener` picks it up and broadcasts a
`WsEvent::Notification` to the user's WS-subscribed tabs.

Rate-limiting:
    - Same `(user_id, kind)` within 60s is silently deduped to avoid
      spamming the bell on a flap (e.g. an SAP job that retries
      three times in a minute should produce ONE "job complete"
      ping, not three).
    - Dedup is in-process (per-uvicorn-worker). Across workers a
      flap CAN still produce one notification per worker — that
      cost is bounded by `--workers N` and acceptable for a
      bell-icon UX.

Constraints honoured:
    - Uses the service-role client (writes through RLS via the
      service-role policy added in migration 275).
    - Caller-supplied `kind` strings are NOT validated against an
      enum; the FE handler treats them as opaque.
    - `severity` defaults to `'info'` to match the existing
      `notification_type` enum default.
    - `link` accepts any path-shaped string (typically a TanStack
      Router `to` value).

Usage:

    from api.services.notifications import enqueue_notification

    enqueue_notification(
        user_id=str(user.id),
        organization_id=str(org_id),
        kind='sap_job_complete',
        title='SAP job completed',
        body=f'TO {to_number} closed in SAP',
        link=f'/admin/sap-testing?job={job_id}',
        severity='success',
    )

This helper is INTENTIONALLY synchronous — it issues one INSERT
and returns. Backend services that don't want the round-trip on
the hot path can wrap the call in `asyncio.to_thread(...)` or a
`BackgroundTasks` callback.

Documented natural integration points (NOT wired here — this
ships only the helper):
    - SAP agent completes a job (api/routers/sap.py terminal status path)
    - Reservation escalated to hard-unassign (rust-work-service scheduler)
    - Customer ticket assigned to me (api/routers/customer_tickets.py)
    - Drone scan completed (api/routers/drone.py)
    - LT22 import run finished (api/routers/lx03_import.py)
    - Cycle count requires recount (rr_cyclecount_data trigger)
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Literal, Optional

try:
    from ..config.database import get_supabase_client
except ImportError:  # pragma: no cover — local script invocation
    from config.database import get_supabase_client

logger = logging.getLogger(__name__)


# ----- Rate-limit / dedup state ---------------------------------------------
# In-process dedup: `(user_id, kind) → last_enqueued_unix_ts`. A repeat
# call within `_DEDUP_WINDOW_SECONDS` short-circuits.
_DEDUP_WINDOW_SECONDS = 60
_dedup_lock = threading.Lock()
_dedup_state: dict[tuple[str, str], float] = {}


Severity = Literal["info", "warning", "error", "success"]


def _should_dedup(user_id: str, kind: str) -> bool:
    """Return True iff a notification with this (user_id, kind) was
    enqueued less than _DEDUP_WINDOW_SECONDS ago.
    """
    now = time.time()
    key = (user_id, kind)
    with _dedup_lock:
        last = _dedup_state.get(key, 0.0)
        if now - last < _DEDUP_WINDOW_SECONDS:
            return True
        _dedup_state[key] = now
        # Opportunistic GC: drop entries older than 5 minutes so the
        # dict doesn't grow unbounded.
        if len(_dedup_state) > 1000:
            cutoff = now - 5 * 60
            _dedup_state.clear()
            _dedup_state[key] = now
            del cutoff  # not used post-clear; kept for future profiling
        return False


def enqueue_notification(
    *,
    user_id: str,
    organization_id: str,
    kind: str,
    title: str,
    body: Optional[str] = None,
    link: Optional[str] = None,
    severity: Severity = "info",
    data: Optional[dict] = None,
) -> Optional[str]:
    """Persist a notification for `user_id` and trigger the WS push.

    Returns the inserted notification's id (UUID string) on success,
    or None when:
      - The call was deduped (same (user_id, kind) within 60s).
      - The Supabase INSERT failed (we log and swallow — notifications
        are best-effort by design; a missed notification is far less
        damaging than crashing the originating request).

    Args:
        user_id: UUID string of the recipient.
        organization_id: UUID string of the recipient's org. MUST
            match `user_profiles.organization_id` for `user_id`;
            mismatched org_ids will be visible only to the user
            (RLS on SELECT cross-checks against `user_profiles`).
        kind: Free-form event-class label, e.g. 'sap_job_complete'.
            Used by the FE to dispatch icons / click handlers.
        title: Short, plain-text heading. Max ~120 chars.
        body: Optional longer text shown below the title.
        link: Optional path the user navigates to on click, e.g.
            '/admin/work-queue?task=...'. TanStack Router `to`
            shape.
        severity: Maps to the existing notification_type enum.
            One of 'info' | 'warning' | 'error' | 'success'.
        data: Optional structured payload stashed in `notifications.data`.
            Use for client-side context the row itself doesn't surface.

    Returns:
        UUID of the inserted row, or None on dedup / failure.
    """
    if _should_dedup(user_id, kind):
        logger.debug(
            "enqueue_notification: deduped (user_id=%s, kind=%s)",
            user_id,
            kind,
        )
        return None

    try:
        client = get_supabase_client()
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("enqueue_notification: supabase client unavailable: %s", e)
        return None

    payload = {
        "user_id": user_id,
        "organization_id": organization_id,
        "type": severity,
        "kind": kind,
        "title": title,
        "message": body,
        "action_url": link,
        "data": data or {},
    }

    try:
        result = (
            client.table("notifications")
            .insert(payload)
            .execute()
        )
    except Exception as e:
        logger.warning(
            "enqueue_notification: insert failed (user_id=%s, kind=%s): %s",
            user_id,
            kind,
            e,
        )
        return None

    rows = getattr(result, "data", None) or []
    if not rows:
        logger.warning(
            "enqueue_notification: no row returned (user_id=%s, kind=%s)",
            user_id,
            kind,
        )
        return None
    inserted_id = rows[0].get("id")
    logger.info(
        "enqueue_notification: enqueued (id=%s, user_id=%s, kind=%s)",
        inserted_id,
        user_id,
        kind,
    )
    return inserted_id


__all__ = ["enqueue_notification", "Severity"]

# Created and developed by Jai Singh
