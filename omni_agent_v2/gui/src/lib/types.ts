// Created and developed by Jai Singh
/**
 * Wire shapes mirroring `crates/agent-gui/src/commands.rs` (which in turn
 * tracks Worker A's `agent-types` crate). The serde `rename_all = snake_case`
 * convention is matched 1:1 — the Tauri invoke layer hands us JSON and we
 * keep it in that shape so React never has to reach into the wire format.
 *
 * Keep this file in sync with the Rust side. The CI mirror script
 * (`Downloads/MacWindowsBridge` per Worker D) diff-checks the two files at
 * publish time.
 */

export const SLOT_COUNT = 6 as const;
export type SlotId = 0 | 1 | 2 | 3 | 4 | 5;

export type SlotState =
  | "empty"
  | "connecting"
  | "idle"
  | "busy"
  | "error"
  | "disconnected";

export type SnapshotSource = "agent" | "cache" | "offline";

export interface CurrentAction {
  action: string;
  job_id?: string;
  step?: string;
  started_at?: string;
  progress_pct?: number;
}

export interface SessionSlot {
  slot_id: number;
  state: SlotState;
  sap_user?: string;
  sap_system?: string;
  sap_client?: string;
  conn_idx?: number;
  sess_idx?: number;
  current_action?: CurrentAction;
  last_operation?: string;
  last_operation_ts?: string;
  last_error?: string;
  busy: boolean;
  pinned: boolean;
}

export interface SessionPoolSnapshot {
  slots: SessionSlot[];
  generated_at: string;
  source: SnapshotSource;
}

export interface SapSession {
  conn_idx: number;
  sess_idx: number;
  user?: string;
  system?: string;
  client?: string;
  transaction?: string;
  session_title?: string;
  claimed_by_slot?: number;
}

export interface ConsoleLine {
  seq: number;
  slot_id: number;
  ts: string;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | string;
  source: string;
  message: string;
}

export interface WsStatus {
  connected: boolean;
  url?: string;
  last_message_at?: string;
  reconnect_count: number;
  last_reconnect_reason?: string;
}

export interface JobCounters {
  jobs_processed_1h: number;
  jobs_errored_1h: number;
  jobs_in_flight: number;
  avg_job_ms: number;
}

export interface HelperStatus {
  running: boolean;
  pid?: number;
  restart_count: number;
  last_restart_at?: string;
}

export interface FleetMember {
  agent_id: string;
  display_label?: string;
  is_self: boolean;
  healthy: boolean;
  last_seen_at?: string;
  slots_busy: number;
  slots_total: number;
}

export interface AgentMetrics {
  agent_id: string;
  agent_version: string;
  uptime_seconds: number;
  healthy_slots: number;
  total_slots: number;
  ws_status: WsStatus;
  jobs: JobCounters;
  helper: HelperStatus;
  fleet: FleetMember[];
}

export interface GuiSettings {
  agent_base_url: string;
  service_key_path: string;
  log_directory: string;
  agent_token?: string;
  theme: "dark" | "light" | string;
  auto_promote_service_key: boolean;
}

export interface BuildInfo {
  version: string;
  build_sha: string;
  built_at: string;
  tauri_version: string;
}

/**
 * Catalogue of quick actions the operator can dispatch against a slot.
 * The string values are the same identifiers the Python helper consumes
 * (`lt12_confirm`, `mm03_lookup`, `zmm60_lookup`) so the Tauri command
 * proxy passes them through verbatim.
 */
export const QUICK_ACTIONS = [
  {
    id: "lt12_confirm",
    label: "LT12",
    description: "Confirm transfer order",
  },
  {
    id: "mm03_lookup",
    label: "MM03",
    description: "Material master read",
  },
  {
    id: "zmm60_lookup",
    label: "ZMM60",
    description: "Inventory snapshot",
  },
  {
    id: "lt24_query",
    label: "LT24",
    description: "Display TO history",
  },
] as const;

export type QuickActionId = (typeof QUICK_ACTIONS)[number]["id"];

// Created and developed by Jai Singh
