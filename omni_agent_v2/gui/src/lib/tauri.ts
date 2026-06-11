// Created and developed by Jai Singh
/**
 * Tauri invoke + event wrappers.
 *
 * We hide the `@tauri-apps/api` import behind a `isTauri()` guard so the
 * frontend can also boot in a plain browser tab during development (Vite
 * `npm run dev` outside `cargo tauri dev`). When Tauri isn't present we
 * fall back to the HTTP control plane on `127.0.0.1:8765` — see
 * `./http.ts`. This keeps `npm run build` viable on macOS without the
 * Tauri runtime, which is the canonical validation flow during Worker C's
 * task.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";

import { httpCall, isHttpAvailable } from "./http";
import type {
  AgentMetrics,
  BuildInfo,
  ConsoleLine,
  GuiSettings,
  SapSession,
  SessionPoolSnapshot,
  WsStatus,
} from "./types";

interface TauriApis {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ) => Promise<UnlistenFn>;
}

let tauriCache: TauriApis | null = null;

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function loadTauri(): Promise<TauriApis | null> {
  if (tauriCache) return tauriCache;
  if (!isTauri()) return null;
  // Dynamic import so Vite doesn't try to bundle Tauri in browser-only dev.
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  tauriCache = {
    invoke: invoke as TauriApis["invoke"],
    listen: listen as TauriApis["listen"],
  };
  return tauriCache;
}

/**
 * Invoke a Tauri command. When the Tauri runtime is unavailable (browser-only
 * dev), the call is routed through the HTTP fallback in `./http.ts`. If
 * neither path is available the returned promise rejects.
 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const tauri = await loadTauri();
  if (tauri) return tauri.invoke<T>(cmd, args);
  if (isHttpAvailable()) return httpCall<T>(cmd, args);
  throw new Error(
    `Cannot invoke "${cmd}": Tauri runtime is unavailable and HTTP fallback is not configured.`,
  );
}

/**
 * Subscribe to a Tauri event. In browser-only dev the unlisten function is
 * a no-op (events only flow when running inside the Tauri shell).
 */
export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  const tauri = await loadTauri();
  if (!tauri) {
    return () => {
      /* no-op when running outside Tauri */
    };
  }
  return tauri.listen<T>(event, ({ payload }) => handler(payload));
}

// ---------------------------------------------------------------------------
// Strongly-typed command wrappers — each maps 1:1 to `commands.rs`.
// ---------------------------------------------------------------------------

export const tauriApi = {
  getSessionStates: () =>
    invoke<SessionPoolSnapshot>("get_session_states"),
  connectSession: (slotId: number) =>
    invoke<void>("connect_session", { slotId }),
  disconnectSession: (slotId: number) =>
    invoke<void>("disconnect_session", { slotId }),
  listSapSessions: () => invoke<SapSession[]>("list_sap_sessions"),
  pinSapSession: (slotId: number, connIdx: number, sessIdx: number) =>
    invoke<void>("pin_sap_session", { slotId, connIdx, sessIdx }),
  releaseSession: (slotId: number) =>
    invoke<void>("release_session", { slotId }),
  runQuickAction: <T = unknown>(
    slotId: number,
    action: string,
    payload: unknown,
  ) =>
    invoke<T>("run_quick_action", {
      slotId,
      action,
      payload: payload ?? {},
    }),
  getConsoleTail: (slotId: number, sinceSeq: number) =>
    invoke<ConsoleLine[]>("get_console_tail", { slotId, sinceSeq }),
  getAgentMetrics: () => invoke<AgentMetrics>("get_agent_metrics"),
  getWsStatus: () => invoke<WsStatus>("get_ws_status"),
  getSettings: () => invoke<GuiSettings>("get_settings"),
  updateSettings: (settings: GuiSettings) =>
    invoke<void>("update_settings", { settings }),
  getBuildInfo: () => invoke<BuildInfo>("get_build_info"),
  openLogDirectory: () => invoke<string>("open_log_directory"),
} as const;

export type TauriApi = typeof tauriApi;

// Created and developed by Jai Singh
