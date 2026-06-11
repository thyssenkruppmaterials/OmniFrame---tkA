# Created and developed by Jai Singh
"""rust-work-service WebSocket client for the OmniFrame Agent.

Phase 4 of the rust-work-service integration plan
(`.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`).
Replaces the agent's direct Supabase Realtime subscription with a single
connection to `rust-work-service /ws`.

A subscribe-token is minted via `POST /api/v1/work/ws-token` (5min HMAC
signed by the work service); the token is passed as `?token=...` on the
upgrade and the work service rejects mismatched-org Subscribe messages
with a 401.

Event types this client cares about today:
    - `WsEvent::SapJobStatusChanged` — job-poller wake-up
                                      (replaces sap_agent_jobs Realtime
                                       channel)
    - `WsEvent::RfPutawayChanged`    — trigger evaluator wake-up
                                      (replaces rf_putaway_operations
                                       Realtime channel)

Why this client is more resilient than the v1.8.x Supabase Realtime path:
    * Single connection (one `/ws` socket) versus four parallel Supabase
      Realtime channels.
    * Server-side circuit breaker telemetry (Phase 2 of the same plan)
      surfaces upstream health via `work_ws_broadcast_buffer_pct` and
      `work_service_ws_lagged_events_total` metrics — operators see the
      cliff coming instead of debugging from agent logs.
    * Token mint is a normal HTTPS POST (clean 401 on stale JWT)
      instead of an opaque `apikey` query-param handshake.
    * **Resilience parity with rust-side `ResilientPgListener`** (added
      2026-05-11 — see follow-up below). The websockets library's
      protocol-level ping/pong (20s cadence, 10s pong deadline) is the
      first line of defense against Citrix / corporate-proxy idle close;
      an application-level watchdog (15s tick, 60s no-traffic timeout)
      is the second line for the case where the proxy silently absorbs
      both directions and the library's own ping task can't tell.

Threading model (mirrors the v1.7.0 / v1.8.0 Realtime singleton):
    * One dedicated thread runs an asyncio loop
      (`omni-work-service-ws`).
    * Event handlers (`on_event`) are dispatched on the same thread —
      caller is responsible for pushing wake-ups onto the synchronous
      job poller / trigger evaluator (e.g. `state.drain_event.set()`).
    * Each connection spawns a watchdog task that wakes every
      `_WS_WATCHDOG_INTERVAL_SEC`. If `time.time() -
      last_message_received_at > _WS_WATCHDOG_TIMEOUT_SEC` it
      force-closes the socket so the outer reconnect loop trips
      immediately rather than blocking forever on a half-open TCP.
    * Reconnect backoff: bounded exponential 1s → 30s (matches
      `rust-work-service::pglistener::RECONNECT_BACKOFF_MAX`). Resets
      to 1s on a connection that survives `_STABLE_CONNECTION_SEC`
      (60s) so a transient corporate-proxy blip doesn't slow recovery.

The work-service's circuit breaker (Phase 2 telemetry) is the upstream
reliability signal; this client is intentionally a thin consumer with
NO local circuit breaker. If the WS keeps flapping the operator
investigates `rust-work-service /metrics` rather than tweaking agent
thresholds.

## Why a watchdog on top of websockets-level ping

The `websockets` library's `ping_interval` / `ping_timeout` parameters
trigger a protocol-level ping every N seconds and abort the connection
if no pong arrives within the timeout. This catches the common
"library notices the socket is dead" case.

But Citrix VDA + corporate proxies (Netskope / ZScaler) are observed to
SOMETIMES forward the protocol pings/pongs while silently dropping
application data — the library sees ping/pong, considers the connection
healthy, but no `WsEvent` ever arrives. The watchdog here is independent
of the library's ping task: it tracks `last_message_received_at` for
ANY frame (including pongs the library handles internally — though
protocol pongs are NOT exposed to user code, so the watchdog is
effectively measuring application-traffic gaps). After
`_WS_WATCHDOG_TIMEOUT_SEC` of no application messages, it
force-closes the socket so the reconnect loop kicks in.

Net effect: a wedged half-open socket recovers within
`_WS_WATCHDOG_INTERVAL_SEC + _WS_WATCHDOG_TIMEOUT_SEC` (worst case ~75s
on defaults) instead of blocking until the user "presses something" on
the agent console.

Mirrors the rust-side
[`rust-work-service/src/pglistener.rs::ResilientPgListener`] which added
the same belt-and-suspenders pattern (30s keepalive, 90s watchdog) for
the LISTEN/NOTIFY socket on 2026-05-07. Implementation note:
[[memorybank/OmniFrame/Implementations/Implement-Resilient-Work-Service-WS-Client.md]].
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from typing import Any, Callable, Optional

# `websockets` arrives transitively via `realtime>=2.29.0` (see
# `requirements.txt`) so no extra wheel is needed. The soft-import
# mirrors the `_HAVE_REALTIME` pattern in `agent.py`: missing dep =>
# WS client transparently falls back to "not available", agent stays
# fully functional on the legacy Supabase Realtime path.
try:
    import websockets  # type: ignore
    from websockets.exceptions import (  # type: ignore
        ConnectionClosedError,
        ConnectionClosedOK,
    )

    _HAVE_WEBSOCKETS = True
except Exception:  # pragma: no cover - import-time fallback
    websockets = None  # type: ignore
    ConnectionClosedError = ()  # type: ignore
    ConnectionClosedOK = ()  # type: ignore
    _HAVE_WEBSOCKETS = False

import requests


# Production rust-work-service URL. Override via env var for local dev
# (`http://localhost:8030` is the standard `pnpm dev` companion port).
WORK_SERVICE_URL = os.environ.get(
    "OMNIFRAME_WORK_SERVICE_URL",
    "https://rust-work-service-production.up.railway.app",
)


def _env_float(name: str, default: float) -> float:
    """Parse a float-valued env var with a safe fallback.

    Garbage input falls back to ``default`` and the bad value is
    surfaced via a console warning at first import. Used by the
    keepalive / watchdog tunables so a typo in a Citrix shortcut's
    env block can't break boot.
    """
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        print(
            f"[work-ws] WARN env var {name}={raw!r} is not a float — "
            f"using default {default}"
        )
        return default


# Reconnect ladder (seconds). Bounded exponential 1→30s mirrors
# `rust-work-service::pglistener::RECONNECT_BACKOFF_MAX` (also 30s)
# so transient corporate-proxy blips recover quickly. Resets to the
# initial value after a connection survives `_STABLE_CONNECTION_SEC`.
_INITIAL_BACKOFF_SEC: float = 1.0
_MAX_BACKOFF_SEC: float = 30.0
_STABLE_CONNECTION_SEC: float = 60.0

# Subscribe-token mint timeout. The work service signs the token in
# memory so the round-trip is sub-100ms in healthy steady state; 10s
# leaves slack for corp-proxy latency without wedging the connect loop.
_TOKEN_MINT_TIMEOUT_SEC: float = 10.0

# WebSocket connect / close timeouts.
_WS_OPEN_TIMEOUT_SEC: float = 15.0
_WS_CLOSE_TIMEOUT_SEC: float = 5.0

# ─────────────────────────────────────────────────────────────────────
# Resilience knobs (added 2026-05-11 — Citrix proxy half-open recovery)
# ─────────────────────────────────────────────────────────────────────
#
# Two-layer keepalive:
#   1. Library-level (websockets `ping_interval` / `ping_timeout`) —
#      protocol-level ping/pong. Many corporate proxies (Netskope,
#      ZScaler) count pings as activity and refuse to idle-close the
#      socket. Catches the common "library notices dead socket" case.
#   2. Application-level watchdog — independent asyncio task that
#      force-closes the socket if NO inbound frame arrives within
#      `_WS_WATCHDOG_TIMEOUT_SEC`. Catches the case where the proxy
#      silently absorbs traffic in both directions and the library's
#      ping task can't distinguish.
#
# All four knobs are env-tunable so a future site with a more
# aggressive idle-close policy can shorten them without an EXE
# rebuild. Defaults match the production-safe values the rust-side
# `ResilientPgListener` ships with (scaled for the WS context: WS
# pings are cheaper than `pg_notify` round-trips, so we run twice as
# fast).

# Library-level WebSocket protocol ping cadence. The websockets library
# emits a `Ping` frame every `ping_interval` seconds; if no `Pong`
# arrives within `ping_timeout`, the library raises
# `ConnectionClosedError` and our outer reconnect loop kicks in.
_WS_PING_INTERVAL_SEC: float = _env_float(
    "OMNIFRAME_WS_PING_INTERVAL_SEC", 20.0
)
_WS_PING_TIMEOUT_SEC: float = _env_float(
    "OMNIFRAME_WS_PING_TIMEOUT_SEC", 10.0
)

# Application-level watchdog cadence + deadline. The watchdog wakes
# every `_WS_WATCHDOG_INTERVAL_SEC` and checks `last_message_received_at`;
# if the gap exceeds `_WS_WATCHDOG_TIMEOUT_SEC` it force-closes the
# socket. Watchdog timeout MUST be at least 2× the ping interval so a
# missed pong tick alone doesn't trip the watchdog before the library
# has a chance to surface its own `ConnectionClosedError`.
_WS_WATCHDOG_INTERVAL_SEC: float = _env_float(
    "OMNIFRAME_WS_WATCHDOG_INTERVAL_SEC", 15.0
)
_WS_WATCHDOG_TIMEOUT_SEC: float = _env_float(
    "OMNIFRAME_WS_WATCHDOG_TIMEOUT_SEC", 60.0
)

# Sanity-check the watchdog ratio at import time so a future env-var
# misconfiguration is loud at boot instead of silently wedging.
if _WS_WATCHDOG_TIMEOUT_SEC < _WS_PING_INTERVAL_SEC * 2:
    print(
        f"[work-ws] WARN watchdog timeout ({_WS_WATCHDOG_TIMEOUT_SEC:.0f}s) "
        f"is < 2× ping interval ({_WS_PING_INTERVAL_SEC:.0f}s) — a single "
        f"missed pong tick may trip the watchdog before the library can "
        f"surface ConnectionClosedError. Recommend ≥ 2× ratio."
    )


def _http_to_ws(url: str) -> str:
    """Convert an HTTP/S work-service URL to its WS/S counterpart."""
    base = url.rstrip("/")
    if base.startswith("https://"):
        return "wss://" + base[len("https://"):]
    if base.startswith("http://"):
        return "ws://" + base[len("http://"):]
    return base


class WorkServiceWsClient:
    """Single-connection WS client to rust-work-service `/ws`.

    Constructor args:
        token_provider: zero-arg callable returning the current Supabase
            user JWT. Re-invoked on every reconnect so a refreshed token
            is picked up automatically.
        org_provider:   zero-arg callable returning the current
            organization id (UUID string). Re-invoked on every
            reconnect.
        on_event:       callback taking a parsed event dict (the
            `WsEvent` JSON shape, e.g.
            ``{"type": "SapJobStatusChanged", "job_id": "...", ...}``).
            Runs on the WS thread's asyncio loop — must be cheap +
            non-blocking. Push onto a `threading.Event` or queue if the
            handler needs to wake a synchronous worker.

    Lifecycle:
        - ``start()``    spawns the daemon thread (idempotent).
        - ``stop()``     signals the thread to exit at the next loop
                         iteration. The current connection is closed
                         opportunistically via the websockets library's
                         own teardown (no forced cancel).
        - ``is_connected()`` reflects the most recent connect attempt
                         (True between successful Subscribe ACK and
                         next disconnect).
        - ``last_event_at()`` returns the epoch second of the last
                         event delivered to ``on_event`` (0.0 before
                         first event).

    Resilience surface (added 2026-05-11):
        - ``last_message_received_at()`` epoch second of the most
                         recent frame received from the server (any
                         JSON message, not just events the
                         dispatcher cares about). Refreshed on EVERY
                         inbound frame. 0.0 before the first frame.
        - ``reconnect_count()``   monotonically-increasing counter
                         of reconnect attempts since process start.
                         Steady-state ≈ 0 on a healthy network;
                         non-zero rate = upstream is idle-killing
                         sockets and the watchdog or library is
                         catching it.
        - ``watchdog_trips()``    subset of ``reconnect_count()`` that
                         was triggered by the application-level
                         watchdog (vs the websockets library
                         surfacing a `ConnectionClosedError` on its
                         own). High = the proxy is forwarding pings
                         but blocking app traffic.
        - ``last_reconnect_reason()`` short string with the exception
                         class name + first 80 chars of the message
                         from the most recent disconnect. ``None``
                         before the first disconnect.
    """

    def __init__(
        self,
        token_provider: Callable[[], str],
        org_provider: Callable[[], str],
        on_event: Callable[[dict], None],
    ) -> None:
        self._token_provider = token_provider
        self._org_provider = org_provider
        self._on_event = on_event
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._last_event_at: float = 0.0
        self._connected: bool = False
        self._fallback_reason: Optional[str] = None
        # Resilience instrumentation (atomic-ish via the GIL — read
        # by /health and the agent's diagnostic surfaces).
        self._last_message_received_at: float = 0.0
        self._reconnect_count: int = 0
        self._watchdog_trips: int = 0
        self._last_reconnect_reason: Optional[str] = None

    # ------------------------------------------------------------------
    # Public surface
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        if not _HAVE_WEBSOCKETS:
            self._fallback_reason = (
                "websockets library not bundled — work-service WS "
                "client unavailable (agent stays on Supabase Realtime "
                "path)"
            )
            print(f"[work-ws] {self._fallback_reason}")
            return
        # One-shot resilience banner so operators can tell at a glance
        # what cadence the keepalive + watchdog are running at. Mirrors
        # the rust-side `info!` line emitted by
        # `pglistener::run_with_sink` at task start.
        print(
            f"[work-ws] resilience config: "
            f"library_ping={_WS_PING_INTERVAL_SEC:.0f}s/"
            f"{_WS_PING_TIMEOUT_SEC:.0f}s, "
            f"app_watchdog={_WS_WATCHDOG_INTERVAL_SEC:.0f}s/"
            f"{_WS_WATCHDOG_TIMEOUT_SEC:.0f}s, "
            f"reconnect_backoff={_INITIAL_BACKOFF_SEC:.0f}s→"
            f"{_MAX_BACKOFF_SEC:.0f}s exponential. "
            f"Mirrors rust-work-service ResilientPgListener — see "
            f"Implementations/Implement-Resilient-Work-Service-WS-Client.md."
        )
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="omni-work-service-ws",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def is_connected(self) -> bool:
        return self._connected

    def last_event_at(self) -> float:
        return self._last_event_at

    def fallback_reason(self) -> Optional[str]:
        return self._fallback_reason

    def last_message_received_at(self) -> float:
        return self._last_message_received_at

    def reconnect_count(self) -> int:
        return self._reconnect_count

    def watchdog_trips(self) -> int:
        return self._watchdog_trips

    def last_reconnect_reason(self) -> Optional[str]:
        return self._last_reconnect_reason

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _run_loop(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._main())
        except Exception as e:  # pragma: no cover
            print(f"[work-ws] thread crashed: {e!r}")
        finally:
            try:
                loop.close()
            except Exception:
                pass
            self._connected = False

    async def _main(self) -> None:
        backoff = _INITIAL_BACKOFF_SEC
        while not self._stop.is_set():
            connect_started_at: Optional[float] = None
            disconnect_reason: str = "unknown"
            disconnect_exc_name: str = "Unknown"
            # Cycle-local watchdog state. Lives OUTSIDE the `try:` so
            # both the clean-exit path AND every `except` branch can
            # observe whether the disconnect was watchdog-driven (the
            # watchdog calls `ws.close()` which surfaces back to the
            # recv loop as a `ConnectionClosedError`, not a clean
            # `async for` exit).
            watchdog_state: dict[str, bool] = {"tripped": False}
            try:
                jwt = self._token_provider() or ""
                org_id = self._org_provider() or ""
                if not jwt or not org_id:
                    # Caller hasn't logged in yet. Sit on a short sleep
                    # so a freshly-arriving login picks us up promptly.
                    await asyncio.sleep(_INITIAL_BACKOFF_SEC)
                    continue

                ws_token = self._mint_token(jwt)
                ws_url = (
                    _http_to_ws(WORK_SERVICE_URL) + f"/ws?token={ws_token}"
                )
                async with websockets.connect(  # type: ignore[union-attr]
                    ws_url,
                    open_timeout=_WS_OPEN_TIMEOUT_SEC,
                    close_timeout=_WS_CLOSE_TIMEOUT_SEC,
                    # Library-level ping/pong (Layer 1 of the keepalive
                    # stack). Many corporate proxies count ping frames
                    # as activity and refuse to idle-close the socket.
                    ping_interval=_WS_PING_INTERVAL_SEC,
                    ping_timeout=_WS_PING_TIMEOUT_SEC,
                ) as ws:
                    await ws.send(
                        json.dumps(
                            {
                                "type": "Subscribe",
                                "organization_id": org_id,
                            }
                        )
                    )
                    self._connected = True
                    connect_started_at = time.time()
                    # Treat the `Subscribe` send as the first proof-of-
                    # life so the watchdog has a non-zero baseline (the
                    # server's first event may legitimately be minutes
                    # away on a quiet org).
                    self._last_message_received_at = connect_started_at
                    print(
                        f"[work-ws] connected to {WORK_SERVICE_URL} "
                        f"(org {org_id})"
                    )

                    # Spawn the application-level watchdog (Layer 2 of
                    # the keepalive stack). Writes `state["tripped"]`
                    # before force-closing so the parent can tag the
                    # disconnect reason.
                    watchdog_task = asyncio.create_task(
                        self._watchdog_loop(ws, watchdog_state),
                        name="omni-work-service-ws-watchdog",
                    )

                    try:
                        async for raw in ws:
                            self._last_message_received_at = time.time()
                            try:
                                event = json.loads(raw)
                                self._last_event_at = (
                                    self._last_message_received_at
                                )
                            except Exception as e:
                                print(
                                    f"[work-ws] event parse error: {e!r}"
                                )
                                continue
                            try:
                                self._on_event(event)
                            except Exception as e:
                                # Defensive: a buggy handler must never
                                # kill the connection. Log and keep
                                # draining.
                                print(
                                    f"[work-ws] on_event handler error "
                                    f"({event.get('type', '?')}): {e!r}"
                                )
                    finally:
                        watchdog_task.cancel()
                        try:
                            await watchdog_task
                        except (asyncio.CancelledError, Exception):
                            pass

                # Reached if `async for` exits without raising — server
                # closed the socket cleanly OR the watchdog force-closed
                # it (the close is observable here only when websockets
                # masks ConnectionClosedOK as a clean iteration end).
                self._connected = False
                connect_age = (
                    time.time() - connect_started_at
                    if connect_started_at is not None
                    else 0.0
                )
                if connect_age >= _STABLE_CONNECTION_SEC:
                    backoff = _INITIAL_BACKOFF_SEC
                if watchdog_state["tripped"]:
                    silent_for = (
                        time.time() - self._last_message_received_at
                    )
                    disconnect_reason = (
                        f"watchdog timeout "
                        f"(no message for {silent_for:.0f}s)"
                    )
                    disconnect_exc_name = "WatchdogTimeout"
                else:
                    disconnect_reason = (
                        f"clean close after {connect_age:.1f}s"
                    )
                    disconnect_exc_name = "CleanClose"
            except (ConnectionClosedError, ConnectionClosedOK) as e:
                self._connected = False
                if watchdog_state["tripped"]:
                    # The watchdog called `ws.close()` which surfaces
                    # to the recv loop as ConnectionClosed*. Rebadge so
                    # the reconnect log is honest about WHY we
                    # disconnected (operator's mental model: watchdog
                    # = corp-proxy idle close, ConnectionClosedError =
                    # server-initiated drop).
                    silent_for = (
                        time.time() - self._last_message_received_at
                    )
                    disconnect_reason = (
                        f"watchdog timeout "
                        f"(no message for {silent_for:.0f}s)"
                    )
                    disconnect_exc_name = "WatchdogTimeout"
                else:
                    disconnect_reason = repr(e)[:160]
                    disconnect_exc_name = type(e).__name__
            except (
                OSError,
                asyncio.TimeoutError,
            ) as e:
                # Explicit network-level failure modes — DNS / TCP /
                # TLS / open_timeout. Listed separately so the
                # reconnect log line carries a precise class name
                # (`OSError` vs the catch-all `Exception` below).
                self._connected = False
                disconnect_reason = repr(e)[:160]
                disconnect_exc_name = type(e).__name__
            except Exception as e:
                # Catch-all so a never-before-seen exception shape (a
                # future websockets release, a transient JSON encode
                # bug in `_mint_token`, etc.) doesn't kill the
                # reconnect loop. Logged with the class name so a
                # novel failure mode is still visible in the logs.
                self._connected = False
                disconnect_reason = repr(e)[:160]
                disconnect_exc_name = type(e).__name__

            if self._stop.is_set():
                break

            if disconnect_exc_name == "WatchdogTimeout":
                self._watchdog_trips += 1
            self._reconnect_count += 1
            self._last_reconnect_reason = (
                f"{disconnect_exc_name}: {disconnect_reason}"
            )
            age = (
                time.time() - self._last_message_received_at
                if self._last_message_received_at > 0
                else 0.0
            )
            print(
                f"[work-ws] reconnect #{self._reconnect_count} "
                f"(last message {age:.0f}s ago, "
                f"reason={disconnect_exc_name}, "
                f"watchdog_trips={self._watchdog_trips}); "
                f"sleeping {backoff:.1f}s"
            )
            try:
                await asyncio.sleep(backoff)
            except Exception:
                pass
            # Bounded exponential — double until cap, then stick at cap.
            backoff = min(_MAX_BACKOFF_SEC, max(backoff * 2.0, 1.0))

    async def _watchdog_loop(
        self,
        ws: Any,
        state: dict[str, bool],
    ) -> None:
        """Application-level keepalive watchdog (Layer 2).

        Runs as a sibling asyncio task to the recv loop. Wakes every
        `_WS_WATCHDOG_INTERVAL_SEC` and force-closes the socket if
        `last_message_received_at` is older than
        `_WS_WATCHDOG_TIMEOUT_SEC`. The recv loop sees the close as a
        normal `async for` exit and falls through to the reconnect
        ladder. ``state["tripped"]`` is written so the parent
        bookkeeping can tag this disconnect as a watchdog-driven one
        (vs library-driven `ConnectionClosedError`).

        Cancellation: the parent cancels this task in the connection
        block's `finally`, so a clean shutdown closes the socket
        immediately without firing the watchdog branch.
        """
        try:
            while True:
                await asyncio.sleep(_WS_WATCHDOG_INTERVAL_SEC)
                age = time.time() - self._last_message_received_at
                if age > _WS_WATCHDOG_TIMEOUT_SEC:
                    state["tripped"] = True
                    print(
                        f"[work-ws] watchdog tripped — last message "
                        f"{age:.0f}s ago > "
                        f"{_WS_WATCHDOG_TIMEOUT_SEC:.0f}s; force-closing "
                        f"socket to trigger reconnect"
                    )
                    try:
                        # 1011 = "Internal Error" (per RFC 6455). The
                        # rust-work-service treats any close cleanly;
                        # the code is purely diagnostic for `/metrics`
                        # if the server ever surfaces close-code
                        # buckets.
                        await ws.close(
                            code=1011, reason="agent watchdog timeout"
                        )
                    except Exception as e:
                        # Best-effort — if the close raises, the
                        # `async for` will eventually surface a
                        # `ConnectionClosedError` anyway. Log for
                        # diagnostics but don't escalate.
                        print(
                            f"[work-ws] watchdog close raised "
                            f"({type(e).__name__}: {e!r}); recv loop "
                            f"will catch it on next iteration"
                        )
                    return
        except asyncio.CancelledError:
            return

    def _mint_token(self, jwt: str) -> str:
        """Mint a 5-minute WS subscribe-token via the work service.

        Surfaces the error verbatim — the outer reconnect loop catches
        + backs off, so a transient 5xx storm doesn't crash the thread.
        """
        resp = requests.post(
            f"{WORK_SERVICE_URL}/api/v1/work/ws-token",
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=_TOKEN_MINT_TIMEOUT_SEC,
        )
        resp.raise_for_status()
        body = resp.json()
        token = body.get("token")
        if not isinstance(token, str) or not token:
            raise RuntimeError(
                f"work-service ws-token response missing 'token': {body!r}"
            )
        return token

# Created and developed by Jai Singh
