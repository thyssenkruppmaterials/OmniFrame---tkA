// Created and developed by Jai Singh
/**
 * HTTP fallback for browser-only dev.
 *
 * Mirrors the Tauri command surface against the agent's local HTTP control
 * plane on `127.0.0.1:8765`. The wire shapes are 1:1 with `tauri.ts` because
 * the Rust commands in `crates/agent-gui/src/commands.rs` are themselves
 * thin proxies to the same endpoints — the GUI gains a single "real" code
 * path that works in both the Tauri shell and a plain Vite dev tab.
 *
 * The endpoints are documented in
 * `memorybank/OmniFrame/Plan-Multi-Session-Agent-Master.md` Section 2.
 */

import type {
  AgentMetrics,
  BuildInfo,
  ConsoleLine,
  GuiSettings,
  SapSession,
  SessionPoolSnapshot,
  WsStatus,
} from "./types";

const DEFAULT_AGENT_URL = "http://127.0.0.1:8765";

function baseUrl(): string {
  if (typeof window !== "undefined") {
    const winAny = window as unknown as { __OMNIFRAME_AGENT_URL__?: string };
    if (winAny.__OMNIFRAME_AGENT_URL__) return winAny.__OMNIFRAME_AGENT_URL__;
  }
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_AGENT_URL) {
    return import.meta.env.VITE_AGENT_URL as string;
  }
  return DEFAULT_AGENT_URL;
}

export function isHttpAvailable(): boolean {
  return typeof fetch === "function";
}

interface HttpRouteSpec {
  method: "GET" | "POST";
  path: (args: Record<string, unknown>) => string;
  body?: (args: Record<string, unknown>) => unknown;
}

const ROUTES: Record<string, HttpRouteSpec> = {
  get_session_states: {
    method: "GET",
    path: () => "/session-pool",
  },
  connect_session: {
    method: "POST",
    path: (a) => `/sessions/${a.slotId}/connect`,
  },
  disconnect_session: {
    method: "POST",
    path: (a) => `/sessions/${a.slotId}/disconnect`,
  },
  list_sap_sessions: {
    method: "GET",
    path: () => "/sap/sessions",
  },
  pin_sap_session: {
    method: "POST",
    path: (a) => `/sessions/${a.slotId}/pin`,
    body: (a) => ({ conn_idx: a.connIdx, sess_idx: a.sessIdx }),
  },
  release_session: {
    method: "POST",
    path: (a) => `/sessions/${a.slotId}/release`,
  },
  run_quick_action: {
    method: "POST",
    path: (a) => `/sessions/${a.slotId}/actions/${a.action}`,
    body: (a) => a.payload ?? {},
  },
  get_console_tail: {
    method: "GET",
    path: (a) =>
      `/console/tail?slot=${a.slotId}&since_seq=${a.sinceSeq}&block_ms=0`,
  },
  get_agent_metrics: {
    method: "GET",
    path: () => "/metrics-summary",
  },
  get_ws_status: {
    method: "GET",
    path: () => "/realtime/status",
  },
  get_settings: {
    method: "GET",
    path: () => "/gui/settings",
  },
  update_settings: {
    method: "POST",
    path: () => "/gui/settings",
    body: (a) => a.settings ?? {},
  },
  get_build_info: {
    method: "GET",
    path: () => "/build-info",
  },
  open_log_directory: {
    method: "POST",
    path: () => "/admin/log/flush",
  },
};

export async function httpCall<T>(
  cmd: string,
  args: Record<string, unknown> | undefined,
): Promise<T> {
  const spec = ROUTES[cmd];
  if (!spec) {
    throw new Error(`No HTTP fallback configured for command "${cmd}".`);
  }
  const normalised = args ?? {};
  const url = `${baseUrl()}${spec.path(normalised)}`;
  const init: RequestInit = {
    method: spec.method,
    headers: {
      Accept: "application/json",
    },
    credentials: "omit",
  };
  if (spec.body && spec.method !== "GET") {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(spec.body(normalised));
  }
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Agent HTTP ${resp.status} ${resp.statusText} for ${cmd}: ${text}`,
    );
  }
  if (resp.status === 204) return undefined as T;
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return (await resp.text()) as unknown as T;
  }
  return (await resp.json()) as T;
}

/**
 * Convenience proxy for components that only care about the typed wrapper.
 * Mirrors the shape of `tauriApi` in `./tauri.ts`.
 */
export const httpApi = {
  getSessionStates: () => httpCall<SessionPoolSnapshot>("get_session_states", {}),
  connectSession: (slotId: number) =>
    httpCall<void>("connect_session", { slotId }),
  disconnectSession: (slotId: number) =>
    httpCall<void>("disconnect_session", { slotId }),
  listSapSessions: () => httpCall<SapSession[]>("list_sap_sessions", {}),
  pinSapSession: (slotId: number, connIdx: number, sessIdx: number) =>
    httpCall<void>("pin_sap_session", { slotId, connIdx, sessIdx }),
  releaseSession: (slotId: number) =>
    httpCall<void>("release_session", { slotId }),
  runQuickAction: <T = unknown>(
    slotId: number,
    action: string,
    payload: unknown,
  ) => httpCall<T>("run_quick_action", { slotId, action, payload }),
  getConsoleTail: (slotId: number, sinceSeq: number) =>
    httpCall<ConsoleLine[]>("get_console_tail", { slotId, sinceSeq }),
  getAgentMetrics: () => httpCall<AgentMetrics>("get_agent_metrics", {}),
  getWsStatus: () => httpCall<WsStatus>("get_ws_status", {}),
  getSettings: () => httpCall<GuiSettings>("get_settings", {}),
  updateSettings: (settings: GuiSettings) =>
    httpCall<void>("update_settings", { settings }),
  getBuildInfo: () => httpCall<BuildInfo>("get_build_info", {}),
  openLogDirectory: () => httpCall<string>("open_log_directory", {}),
};

// Created and developed by Jai Singh
