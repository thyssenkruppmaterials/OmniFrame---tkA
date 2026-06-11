// Created and developed by Jai Singh
//! Process-wide constants. Bumping any of these is a wire-contract event
//! and requires a coordinated release with the frontend.

use serde::{Deserialize, Serialize};

/// Semver tag baked into every `/health` + `/status` response.
///
/// The `-alpha` suffix marks the Rust port as not-yet-stable; the FE
/// should still gate on `capabilities[]` (semantic feature flags), not
/// on the version string.
pub const AGENT_VERSION_STR: &str = "v2.0.0-alpha";

/// Structured version. The struct shape is what we serialize into
/// `/health.version_struct` when the FE wants to compare numerically
/// without parsing a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentVersion {
    pub major: u16,
    pub minor: u16,
    pub patch: u16,
    /// Pre-release tag (e.g. `"alpha"`, `"rc.1"`). `None` for stable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre: Option<&'static str>,
}

impl AgentVersion {
    pub const CURRENT: AgentVersion = AgentVersion {
        major: 2,
        minor: 0,
        patch: 0,
        pre: Some("alpha"),
    };
}

impl std::fmt::Display for AgentVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(pre) = self.pre {
            write!(f, "v{}.{}.{}-{}", self.major, self.minor, self.patch, pre)
        } else {
            write!(f, "v{}.{}.{}", self.major, self.minor, self.patch)
        }
    }
}

/// Default TCP port for the headless agent's loopback HTTP server.
/// Overridable via `OMNIFRAME_AGENT_PORT` env var (used by the multi-
/// session master controller to spawn workers on 8765..8770).
pub const AGENT_PORT: u16 = 8765;

/// JWT exchange cadence. The agent identity v2 exchange (`POST
/// /api/v1/agent-identity/exchange`) returns a 15-minute token; we refresh
/// at 90% of lifetime so a clock-skewed agent never sends an expired JWT
/// upstream.
pub const JWT_REFRESH_INTERVAL_SEC: u64 = 540;

/// Heartbeat cadence while a job is in flight. Aggressive enough that the
/// `claim_sap_agent_job` migration 247 lease watchdog won't escalate a
/// healthy job to `failed`.
pub const HEARTBEAT_ACTIVE_SEC: u64 = 30;

/// Heartbeat cadence when no job is in flight. Halved when active so the
/// agent's `last_seen_at` doesn't drift far enough for the 90s grace
/// window on the FE fleet card to flip the dot orange.
pub const HEARTBEAT_IDLE_SEC: u64 = 60;

/// Helper-subprocess watchdog deadline. If the Python helper hasn't
/// responded to a single in-flight RPC within this window the supervisor
/// treats it as wedged and kills + respawns.
pub const WATCHDOG_TIMEOUT_SEC: u64 = 120;

/// Library-level WebSocket ping cadence. The tungstenite library emits a
/// `Ping` frame this often; an unanswered ping after [`WS_PING_TIMEOUT_SEC`]
/// raises `ConnectionClosed` and the outer reconnect loop trips.
pub const WS_PING_INTERVAL_SEC: u64 = 20;
pub const WS_PING_TIMEOUT_SEC: u64 = 10;

/// Application-level WebSocket watchdog. Wakes every interval; if the
/// gap since the last inbound frame exceeds the timeout, force-closes the
/// socket to trip the reconnect ladder. Belt-and-suspenders for
/// corporate proxies that forward pings but drop app traffic — see
/// `omni_agent/work_service_ws.py` "Why a watchdog on top of websockets-
/// level ping" for background.
pub const WS_WATCHDOG_INTERVAL_SEC: u64 = 15;
pub const WS_WATCHDOG_TIMEOUT_SEC: u64 = 60;

/// Number of SAP-session slots managed by the v2 pool. Static for the
/// life of the binary so consumers (the GUI tile grid, the
/// `/sap/v2/sessions` JSON shape) can stack-allocate fixed-size arrays.
pub const SESSION_POOL_SIZE: usize = 6;

/// Stable, comma-separated capability list. Returned by `/health` so the
/// FE's `hasCapability(...)` gate can light up UI elements per agent
/// version. Mirrors `AGENT_CAPABILITIES` in `omni_agent/agent.py:1695`,
/// plus the new `multi-session-pool` flag that announces the v2 fan-out.
///
/// IMPORTANT: this is the WIRE CONTRACT with the frontend. Every entry
/// here must be a string the FE already knows how to interpret OR a
/// brand-new v2 flag the FE has been updated to recognize.
pub const CAPABILITIES: &[&str] = &[
    "confirm-to",
    "transfer-inventory",
    "bin-blocks",
    "mm02-bin",
    "mm02-storage-types",
    "create-bin",
    "process-shipment",
    "lt10",
    "lt24",
    "lt12",
    "mb52",
    "mmbe",
    "jobs-queue",
    "metrics",
    "audit-log",
    "agent-token",
    "bulk-export-pc",
    "soft-warning-catalog",
    "retry-with-backoff",
    "recording-start",
    "recording-stop",
    "recording-translate",
    "recording-replay",
    "recording-list",
    "mm03-read-bin",
    "mm03-read-storage-types",
    "agents-fleet",
    "job-claim-lease",
    "scheduled-jobs",
    "reversal-engine",
    "import-lt22",
    "import-lt22-bulk",
    "supabase-session",
    "agent-supabase-logout",
    "truststore-tls",
    "persistent-agent-token",
    "stable-agent-id",
    "agent-token-rotate",
    "agent-token-check",
    "sap-auto-connect",
    "self-healing-schema-fallback",
    "trigger-backfill-poller",
    "job-drain-mode",
    "stuck-job-watchdog",
    "realtime-singleton",
    "realtime-circuit-breaker",
    "realtime-fallback-mode",
    "crash-loop-containment",
    "jwt-refresh",
    "terminal-state-guards",
    "idempotency-day-suffix",
    "agent-module-alias",
    "jobs-claim-active-guard",
    "agent-2.0-architecture",
    "lt01-stock-fields",
    "zmm60-price-lookup",
    "lx25-inventory-completion",
    // ── NEW v2 capabilities ────────────────────────────────────────
    // The browser-side admin UI gates the 6-tile multi-session GUI on
    // this flag so the old single-session UI keeps working when a v1.x
    // agent is the one answering /health on a given Citrix box.
    "multi-session-pool",
    // The Rust shell ports `omni_agent/reversal_engine.py:compute_inverse`
    // verbatim — pure-function, no SAP, no helper round-trip. Gated as a
    // distinct capability so the FE can prefer the local agent over a
    // server-side compute if the agent is on v2.
    "reversal-engine-native",
    // The Rust shell speaks JSON-RPC to a Python sidecar for COM. This
    // capability flag tells the FE / GUI that mid-RPC restarts are
    // recoverable (vs the v1.x agent where a COM hang took the whole
    // process down).
    "python-helper-supervised",
];

// Created and developed by Jai Singh
