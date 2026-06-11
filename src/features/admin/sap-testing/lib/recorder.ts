// Created and developed by Jai Singh
/**
 * Phase D #12 — Self-Recording Mode client (v1.5.0).
 *
 * Thin typed wrappers around the agent's `/sap/recording/*` endpoints.
 * The translator output is rendered directly in the browser; recordings
 * never leave the user's machine (encrypted at rest by the agent).
 */
import { agentFetch } from './agent-fetch'

// ── Public types ─────────────────────────────────────────────────────────
export type RecordingMode = 'hooks' | 'polling' | 'hooks+polling'
export type RecordingStatus =
  | 'recording'
  | 'stopped'
  | 'partial'
  | 'error'
  | 'aborted'

export type RecordingKind = 'query' | 'mutation'

export interface RecordingSapSession {
  system?: string
  client?: string
  user?: string
  language?: string
  transaction?: string
  program?: string
}

export interface RecordingEvent {
  ts: number
  kind: string
  target?: string
  value?: string | number | boolean
  prev_value?: string | number | boolean
  wnd?: number
  control_type?: string
  label?: string
  title?: string
  prev_title?: string
  hint?: string
  text?: string
  msg_type?: string
  // Catch-all for fields the agent may add later.
  [k: string]: unknown
}

export interface RecordingMeta {
  id: string
  name: string
  agent_version?: string
  mode_requested?: string
  mode_used?: string
  started_at: string
  finished_at?: string | null
  duration_ms?: number
  transactions?: string[]
  event_count?: number
  status: RecordingStatus
  encryption?: string
  size_bytes?: number
  error?: string
}

export interface RecordingDetail extends RecordingMeta {
  version?: number
  sap_session?: RecordingSapSession
  events: RecordingEvent[]
}

export interface RecordingStartResponse {
  ok: boolean
  recording_id?: string
  name?: string
  mode_used?: RecordingMode
  session_info?: RecordingSapSession
  started_at?: string
  error?: string
}

export interface RecordingLiveStatus {
  ok: boolean
  active: boolean
  recording_id?: string
  name?: string
  mode_used?: RecordingMode
  started_at?: string
  event_count?: number
  transactions?: string[]
  duration_ms?: number
}

export interface RecordingStopResponse {
  ok: boolean
  recording_id?: string
  name?: string
  status?: RecordingStatus
  events?: RecordingEvent[]
  event_count?: number
  duration_ms?: number
  transactions?: string[]
  sap_session?: RecordingSapSession
  mode_used?: RecordingMode
  error?: string
}

export interface InputOverride {
  /** Python identifier, e.g. 'warehouse'. */
  name?: string
  /** Pydantic type, e.g. 'str' | 'int' | 'bool' | 'Optional[str]'. */
  type?: string
  required?: boolean
  default?: string
}

export interface RecordingTranslateRequest {
  name: string
  kind: RecordingKind
  /** Map keyed by SAP control id (e.g. `wnd[0]/usr/ctxtLTAK-LGNUM`). */
  input_overrides?: Record<string, InputOverride>
}

export interface SuggestedField {
  py_name: string
  py_type: string
  required: boolean
  default?: string
  target: string
  wnd: number
  label?: string
  control_type?: string
  captured_value?: string
}

export interface SuggestedRequestModel {
  name: string
  fields: SuggestedField[]
  kind: RecordingKind
  transaction: string
}

export interface RecordingTranslateResponse {
  ok: boolean
  python_code?: string
  vbs_code?: string
  suggested_request_model?: SuggestedRequestModel
  confidence?: number
  warnings?: string[]
  detected?: {
    inputs: number
    popups: number
    soft_warnings: number
    two_step: boolean
    transactions: string[]
    save_pressed: boolean
    kind: RecordingKind
  }
  error?: string
}

export interface RecordingReplayResponse {
  ok: boolean
  steps_executed?: number
  errors_at_step?: Array<{ step: number; kind: string; error: string }>
  error?: string
}

// ── Endpoint helpers ─────────────────────────────────────────────────────

export async function startRecording(
  body: { name?: string; mode?: 'hooks' | 'polling' } = {}
): Promise<RecordingStartResponse> {
  const res = await agentFetch('/sap/recording/start', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return (await res.json()) as RecordingStartResponse
}

export async function stopRecording(): Promise<RecordingStopResponse> {
  const res = await agentFetch('/sap/recording/stop', { method: 'POST' })
  return (await res.json()) as RecordingStopResponse
}

export async function getRecordingStatus(): Promise<RecordingLiveStatus> {
  const res = await agentFetch('/sap/recording/status', {
    cache: 'no-store',
    signal: AbortSignal.timeout(2000),
  })
  return (await res.json()) as RecordingLiveStatus
}

export async function listRecordings(opts?: {
  limit?: number
  since?: string
}): Promise<{ ok: boolean; items: RecordingMeta[]; count: number }> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.since) params.set('since', opts.since)
  const qs = params.toString()
  const res = await agentFetch(`/sap/recording/list${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
  })
  return (await res.json()) as {
    ok: boolean
    items: RecordingMeta[]
    count: number
  }
}

export async function getRecording(
  id: string
): Promise<{ ok: boolean; recording?: RecordingDetail; error?: string }> {
  const res = await agentFetch(`/sap/recording/${encodeURIComponent(id)}`)
  if (!res.ok && res.status === 404) {
    return { ok: false, error: 'recording not found' }
  }
  return (await res.json()) as {
    ok: boolean
    recording?: RecordingDetail
    error?: string
  }
}

export async function deleteRecording(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await agentFetch(`/sap/recording/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status === 404) {
    return { ok: false, error: 'recording not found' }
  }
  return (await res.json()) as { ok: boolean; error?: string }
}

export async function translateRecording(
  id: string,
  body: RecordingTranslateRequest
): Promise<RecordingTranslateResponse> {
  const res = await agentFetch(
    `/sap/recording/${encodeURIComponent(id)}/translate`,
    { method: 'POST', body: JSON.stringify(body) }
  )
  return (await res.json()) as RecordingTranslateResponse
}

export async function replayRecording(
  id: string
): Promise<RecordingReplayResponse> {
  const res = await agentFetch(
    `/sap/recording/${encodeURIComponent(id)}/replay`,
    {
      method: 'POST',
      headers: { 'X-Recording-Allow-Replay': 'yes' },
    }
  )
  return (await res.json()) as RecordingReplayResponse
}

// ── Misc helpers ─────────────────────────────────────────────────────────

export function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function formatDurationMs(ms: number | undefined): string {
  if (!ms || ms < 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`
  return `${s}s`
}

export function confidenceLabel(score: number | undefined): {
  pct: string
  tone: 'high' | 'medium' | 'low'
} {
  const c = typeof score === 'number' ? score : 0
  const pct = `${Math.round(c * 100)}%`
  let tone: 'high' | 'medium' | 'low' = 'medium'
  if (c >= 0.8) tone = 'high'
  else if (c < 0.5) tone = 'low'
  return { pct, tone }
}

// Created and developed by Jai Singh
