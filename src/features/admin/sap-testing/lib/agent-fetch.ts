// Created and developed by Jai Singh
/**
 * Shared agent client helpers (Phase A1, B6, B8, D #17).
 *
 * - `agentFetch()` — drop-in fetch wrapper that auto-injects the
 *   per-machine `X-Agent-Token` minted by the agent on first boot
 *   (v1.6.5+; v1.6.4 and earlier minted it on every /supabase/login).
 * - `setAgentToken()` / `getAgentToken()` — read/write the current
 *   token in localStorage so it survives reloads + new tabs.
 * - `hasCapability()` — small helper for capability gating.
 *
 * v1.6.5 — added stale-token recovery:
 *   - When `agentFetch` sees a 401 from the local agent, it clears the
 *     localStorage token (so the next call doesn't keep sending the
 *     stale value), fires a custom `omniframe:agent-token-stale` event
 *     (subscribed by `useAgentDetection`), and — unless the caller
 *     opts out via `suppressStaleToast` — emits a single throttled
 *     toast pointing the user at the Connect Account dialog.
 *   - The throttle is per-tab (5 min) so background pollers like the
 *     /metrics card or the agent fleet refresher don't spam the user.
 *   - We DO NOT auto-retry the original request. The caller is
 *     responsible for treating the 401 as a hard failure (the existing
 *     callsites already do — they surface `error: 'Invalid or stale
 *     X-Agent-Token. Re-login from the web app.'` on the response).
 */
import { toast } from 'sonner'

export const AGENT_URL = 'http://127.0.0.1:8765'
const AGENT_TOKEN_STORAGE_KEY = 'omniframe.agent_token.v1'

/**
 * The minimum agent version the frontend expects. When the running
 * agent reports a lower version, the UI shows an "update your agent"
 * banner pointing at the download URL.
 */
export const MIN_REQUIRED_AGENT_VERSION = '1.4.0'
/** Latest available agent version. Used in download banners and Recorder
 *  capability gating so the UI can show "agent v1.5.0+ recommended"
 *  without rejecting older agents that still work for non-recorder flows.
 *
 *  Notable capabilities at this version (referenced by SmartImportButton,
 *  Inventory Management, Agent Triggers, etc.):
 *    'import-lt22' / 'import-lt22-bulk'  — outbound LT22 import endpoint
 *    'agent-side-triggers'                — server-side trigger evaluator
 *    'persistent-agent-token'             — token survives EXE rebuild
 *    'sap-auto-connect'                   — daemon attaches to SAP on boot
 *
 *  v1.6.6 follow-up — `job-queue-fleet-routing` (frontend-only feature, no
 *  agent code change). When the local agent lacks a capability,
 *  `useAgentDetection.bestAgentFor(cap)` returns 'fleet' and surfaces
 *  like SmartImportButton route the work via `sap_agent_jobs` to a
 *  remote agent in the org that DOES have the capability. The auto-pin
 *  is on `assigned_agent_id` so a stale local agent (e.g. v1.0.0 dev
 *  build that polls the queue but doesn't expose the endpoint) never
 *  claims the wrong job. See:
 *    Patterns/Fleet-Aware-Smart-Routing.md
 *    Implementations/Implement-Fleet-Aware-SmartImportButton.md
 *
 *  v1.6.7 — `self-healing-schema-fallback` (backend-only). The agent
 *  was permanently stripping new feature columns from PATCHes/POSTs
 *  after the first PostgREST 400 (v1.6.5/v1.6.6 boolean flags), which
 *  meant a transient cache miss right after a fresh migration disabled
 *  the feature for the rest of the process lifetime. v1.6.7 wraps the
 *  flags in a 5-min cooldown then auto-retries the full schema. Pure
 *  defensive backend hardening — no frontend behaviour change. See:
 *    Patterns/Self-Healing-Schema-Fallback.md
 *
 *  v1.6.8 — Fix agent-internal dual-patcher race: `_apply_trigger_post_patch`
 *  now applies ONLY the OVERLAY (attribution) fields and drops the `skip_if`
 *  filter. Previously the `&to_status=neq.TO%20Confirmed` filter always
 *  matched 0 rows because the in-handler `_update_putaway_status` patcher
 *  had already flipped the status — so attribution columns silently stayed
 *  NULL on every agent-confirmed TO. Pure backend fix — no frontend logic
 *  change beyond this version constant. See:
 *    Debug/Fix-Agent-Dual-Patcher-Race.md
 *
 *  v1.6.9 — Backfill poller for missed Realtime events + bounded TTL dedup
 *  cache + throttled dedup logging. Production caught 17 `rf_putaway_operations`
 *  rows at `to_status='Completed'` with `confirmed_at=NULL` from the past 4
 *  hours that the agent never picked up despite correctly auto-confirming 5
 *  others in the same window — pure missed Realtime events. Three additive
 *  changes: (1) `_start_trigger_backfill_poller` daemon wakes every 60s,
 *  scans the last 24h of `rf_putaway_operations` (max 50 rows/poll), and
 *  feeds matches through the same `_enqueue_trigger_job` path as the
 *  Realtime callback; (2) bounded `_recently_queued_rows: OrderedDict` with
 *  5-min TTL + 1000-entry LRU eviction so Realtime + backfill never
 *  double-fire AND a row that failed enqueue can be re-tried later;
 *  (3) `_should_log_dedup` throttles `[triggers] dedup: ...` to one log
 *  line per row per minute. New capability `trigger-backfill-poller` —
 *  frontend doesn't need to gate on it (purely defensive, mirrors v1.6.7
 *  `self-healing-schema-fallback`). Pure backend fix — no frontend logic
 *  change beyond this version constant. See:
 *    Debug/Fix-Missed-Realtime-Events-Backfill.md
 *
 *  v1.7.0 — Throughput pass: claim-back-to-back drain, stuck-job watchdog,
 *  30s HTTP timeouts with retry, stable Realtime singleton. Production saw
 *  60-180s inter-job dwell (poller slept 60s on every claim-miss between
 *  two queued jobs when a Realtime wake-up was missed during a reconnect
 *  blip); a TO claimed at 20:54:15 stuck "running" for 97+s while the agent
 *  claimed the NEXT job without releasing the stuck one — DB showed two
 *  `running` rows though SAP is single-threaded (COM hang parked the
 *  poller thread inside `_dispatch_job`); `[triggers] enqueue error:
 *  HTTPSConnectionPool... Read timed out. (read timeout=8)` noise from
 *  corporate proxy + Citrix latency; dozens of `[realtime] connected to
 *  wss://...` lines per minute (multiple reconnect loops racing for the
 *  same channel). Five surgical fixes, zero frontend logic change:
 *  (1) DRAIN-BACK-TO-BACK — `_start_job_poller` chains claims until the
 *  queue returns empty (cap 50 jobs/burst); idle backoff exponentially
 *  ramps 5s→60s on consecutive empty polls, resets on any claim hit.
 *  Expected dwell drops from 30-60s → 1-3s. (2) ACTIVE-JOB TRACKING via
 *  `state.active_job_id` + `state.active_job_started_at` (lock-protected)
 *  as single source of truth across poller + watchdog; claim lease dropped
 *  from 300s → 90s. (3) STUCK-JOB WATCHDOG daemon wakes every 30s, marks
 *  jobs running >120s (configurable via `OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS`)
 *  as `failed` and releases them. (4) HTTP hardening — new `_supabase_request`
 *  helper injects 30s default timeout (was 4-10s) + single retry on
 *  Timeout/ConnectionError after 2s sleep across all 17 Supabase call
 *  sites. (5) STABLE REALTIME SINGLETON — sticky `_realtime_started` flag
 *  prevents multiple reconnect loops from racing; reconnect floor bumped
 *  1s→5s to dampen churn. Three new capabilities (purely informational,
 *  no gating): `job-drain-mode`, `stuck-job-watchdog`, `realtime-singleton`.
 *  See:
 *    Debug/Fix-Agent-Throughput-Latency.md
 *    Patterns/Job-Queue-Drain-Mode.md
 *
 *  v1.7.1 — Realtime crash-loop containment. Production agent (v1.7.0) hung
 *  after ~25min idle on a Citrix VDA: queue drain froze, heartbeat thread
 *  stopped updating `sap_agents.last_seen_at`, and stderr filled with
 *  thousands of `Task exception was never retrieved` tracebacks per minute.
 *  Root cause was a known bug in the `realtime>=2.x` Python library: when
 *  the WebSocket dropped (Citrix hibernate / corporate proxy idle close),
 *  the library's internal `_reconnect()` called `asyncio.wait()` on an
 *  empty pending-tasks set, raising `ValueError: Set of Tasks/Futures is
 *  empty.`. Each crash spawned a new listen task that died the same way,
 *  flooding stderr at high frequency and drowning every other thread (the
 *  heartbeat went silent, the job poller stalled). v1.7.1 adds four
 *  defensive layers — surgical containment fix only, NO handler touched,
 *  NO trigger semantics changed: (A) asyncio loop exception handler
 *  installed via `loop.set_exception_handler(...)` BEFORE the
 *  AsyncRealtimeClient is constructed; suppresses the known
 *  `ValueError('Set of Tasks/Futures is empty')` and `ConnectionClosedError`
 *  bursts quietly. Single change eliminates 99% of stderr flooding.
 *  (B) Sliding-window circuit breaker (deque) — every suppressed
 *  exception increments a 60s-window counter; at 20 errors the circuit
 *  trips, `_disable_realtime_subsystem()` logs once, sets
 *  `state.realtime_disabled = True`, tears down the WebSocket client,
 *  and tightens the job poller's idle backoff from 5→60s to 5→15s so
 *  polling-only mode keeps inter-job dwell low while the trigger
 *  backfill poller (60s) carries the missed-event load. After 5min the
 *  new `_start_realtime_circuit_reset_loop` daemon resets the breaker
 *  and re-enters `_start_realtime_subscription()` for one more attempt.
 *  (C) Threading isolation confirmed — Realtime asyncio loop runs in
 *  `sap-realtime-jobs`, heartbeat in `sap-agent-heartbeat` (pure sync
 *  `requests.post()`, no asyncio), job poller in `sap-job-poller` (sync),
 *  watchdog in `sap-job-watchdog` (sync), backfill in
 *  `sap-trigger-backfill` (sync). A Realtime asyncio crash CANNOT wedge
 *  the other threads — only the stderr flood was the actual coupling
 *  mechanism in v1.7.0. (D) Library `realtime` + `websockets` + `asyncio`
 *  loggers raised to WARNING/ERROR so library-level INFO/DEBUG chatter
 *  doesn't hit stderr alongside the suppressed tracebacks. The realtime
 *  library is also pinned to `realtime>=2.29.0,<3.0` (latest as of
 *  2026-04-24, and the `_reconnect()` bug was refactored away around
 *  v2.5+ — the new `_reconnect` no longer calls `asyncio.wait()` at
 *  all); the in-agent containment layers stay as defense-in-depth so
 *  future 2.x regressions are bounded. Three new capabilities
 *  advertised in /health.capabilities (purely informational, no
 *  frontend gating): `realtime-circuit-breaker`, `realtime-fallback-mode`,
 *  `crash-loop-containment`. Pure backend hardening — no frontend
 *  behaviour change beyond this version constant. See:
 *    Debug/Fix-Realtime-Library-CrashLoop.md
 *    Patterns/Async-Library-Circuit-Breaker.md
 *
 *  v1.7.3 — LT10/LT22 bulk-export hardening: pre-commit vs post-commit
 *  error split + no pagination fallback after the export file is
 *  saved. The user-visible v1.7.2 bug: running LT10 with
 *  `storage_type='*'` (warehouse-wide) would briefly flash the %pc
 *  Save-As dialog, drop the file on disk, and then SAP would visibly
 *  start paging down via Ctrl+PgDn for 5+ minutes — making the
 *  "fast" bulk-export path slower than plain pagination. Root cause
 *  was a too-greedy fallback chain: `_extract_via_pc_export` raised
 *  plain `Exception` from BOTH the pre-Save dialog setup AND the
 *  post-Save file-read/parse phase, and the caller in
 *  `_extract_alv_grid` caught everything with a single `except
 *  Exception` that fell through to `_extract_sap_list_output(sess)`
 *  (which paginates). So a single quirk in the parsed file (e.g. a
 *  SAP variant with extra header banner lines, or a Save-As dialog
 *  that closed without writing the file because the path was on a
 *  read-only %TEMP%) silently turned into a 5-minute GUI pagination
 *  walk. Three surgical fixes — NO existing handler touched beyond
 *  LT10 + LT22 import, NO trigger semantics changed, NO migration,
 *  NO RLS, NO frontend logic changed beyond this version constant.
 *  (1) `_extract_via_pc_export` is two-phase: new `_PcPreCommitError`
 *  raised from anywhere before pressing Save (fallback-safe — GUI is
 *  still on the source screen); new `_PcPostCommitError` raised from
 *  anywhere after pressing Save (NOT fallback-safe — file was
 *  burned, GUI may have advanced). (2) `_extract_alv_grid` fallback
 *  chain now distinguishes the two: PRE-commit → fall through to
 *  `_extract_sap_list_output`; POST-commit → re-raise as a clean
 *  `Exception("Bulk export saved file but parse failed: ...")`;
 *  unknown error class → re-raise (conservative, no double-burn).
 *  (3) `handler_lt10` is restructured: `storage_type == '*'` calls
 *  `_extract_via_pc_export(sess)` DIRECTLY — no ALV/TableControl
 *  probe (LT10 always renders classic list output, never an ALV
 *  grid), no greedy fallback. Falls back to `_extract_sap_list_output`
 *  ONLY on `_PcPreCommitError`. Specific storage_type calls
 *  `_extract_sap_list_output` directly (usually <100 rows, bulk-export
 *  overhead isn't worth it). Same pre/post-commit split applied to
 *  `lt22_import.py`. New prints: `[query]  Starting %pc bulk export
 *  — file will save to TEMP and be parsed in-place. No pagination
 *  needed.` at the start; `[query]  %pc bulk export complete: <N>
 *  row(s), <M> columns in <T>s. No GUI pagination performed.` at the
 *  end. So the user can SEE which path is being taken from the agent
 *  console and diagnose any future regression in seconds. New
 *  capability `bulk-export-no-fallback` advertised in
 *  /health.capabilities (purely informational, no frontend gating).
 *  See:
 *    Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback.md
 *
 *  v1.7.4 — Menu-driven export trigger as primary path; %pc as
 *  fallback. The v1.7.3 user reported their LT10 query was STILL
 *  paginating via Ctrl+PgDn after the v1.7.3 fix shipped. A fresh
 *  recording on their machine (`MacWindowsBridge/LT10ReRan.vbs`)
 *  revealed the actual export trigger they use is the canonical
 *  menu path `wnd[0]/mbar/menu[0]/menu[1]/menu[2]` (List → Save →
 *  File...) rather than the `%pc` OK-code shortcut the agent
 *  relied on. On their SAP variant `%pc` either is not registered
 *  or routes to a different dialog — Step 1 of `_extract_via_pc_export`
 *  failed, raised `_PcPreCommitError`, and v1.7.3's correctly-
 *  narrowed fallback chain dropped through to
 *  `_extract_sap_list_output` (lbl[x,y] pagination). v1.7.3's
 *  behaviour was technically correct (pre-commit failures ARE
 *  fallback-safe) but the underlying bulk-export path never even
 *  RAN on this user. v1.7.4 makes Phase A try the menu-driven
 *  trigger FIRST (universal — every list-output report ships with
 *  the same menu entry at the same position) and only falls back
 *  to `%pc` if the menu select fails. `%pc` is preserved as a
 *  secondary path so other transactions whose menu indices shift
 *  on a custom skin keep working. Step 4 (Save-As dismissal) now
 *  tries `sendVKey(0)` (Enter) first instead of `btn[11]` because
 *  the recording uses Enter; `btn[11]` and `sendVKey(11)` remain
 *  as cross-variant fallbacks. Step 3 (path/filename) falls back
 *  to filename-only setting if both `DY_PATH` + `DY_FILENAME` are
 *  not present (the recording shows the user's variant only
 *  exposes `DY_FILENAME` with the path auto-populated). All three
 *  trigger / save / path-setting paths print which method actually
 *  worked so future variant differences are diagnosable from the
 *  agent console in seconds. New capability `bulk-export-menu-driven`.
 *  Pure backend hardening — no frontend behaviour change beyond
 *  this version constant. See:
 *    Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback.md
 *    (v1.7.4 follow-up: menu vs %pc section)
 *
 *  v1.7.5 — `handler_lt10` and `handler_mb52` now ALWAYS use
 *  `_extract_via_pc_export` regardless of query parameters. The
 *  v1.7.3 `storage_type == '*'` gate in handler_lt10 was based on
 *  the wrong assumption that specific-type queries return small
 *  result sets. Production disproved this: a user query with
 *  `storage_type='999'` returned 234 rows across 7 pages of
 *  Ctrl+PgDn pagination (~30s) when bulk export would have
 *  completed in <5s. v1.7.5 drops the gate entirely. Both handlers
 *  fall back to pagination / ALV extraction ONLY on
 *  `_PcPreCommitError` (dialog never opened, GUI still on source
 *  screen — same fallback semantics v1.7.3 introduced). Both now
 *  report `extraction_path` in `result["meta"]` so audits can see
 *  which path actually ran. New capability `bulk-export-always`.
 *  NO frontend behaviour change beyond this version constant. See:
 *    Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback.md
 *    (v1.7.5: always bulk export section)
 *
 *  v1.7.6 — Permissive bulk-export parser: handles dash-separated,
 *  tab-delimited, fixed-width, CSV, and HTML SAP list exports plus
 *  diagnostic dump on parse failure. The v1.7.5 LT10 user reported
 *  the export reached Phase B successfully (Save-As dialog opened,
 *  file landed on disk in `%TEMP%` with the right uuid filename)
 *  but parsing raised `_PcPostCommitError("Could not find a
 *  dash-separator row in the %pc export. File may be empty or in
 *  an unexpected format.")`. The v1.6.3 single-format parser only
 *  recognized one layout (dash row between header and data); on
 *  this user's SAP variant the export is tab-delimited /
 *  fixed-width / CSV / HTML depending on the box-level customizing.
 *  Five parsers now run in priority order — A=dash-separated,
 *  B=tab-delimited (\t), C=fixed-width without dashes (split on
 *  2+ spaces), D=CSV (csv.reader), E=HTML (regex over <tr>/<td>).
 *  First parser that returns >=2 columns AND >=1 data row wins;
 *  `result.meta.parser_format` reports A/B/C/D/E so SAP Testing
 *  audits can see which path each query took. New
 *  `[query]  Parser detected format: <X>` print on success. On
 *  total failure: (1) save the file to
 *  `%TEMP%/omniframe_lastfailed_<UTC_ts>.txt` so the user can
 *  share it; (2) print a `repr()` preview of the first 1000 chars
 *  + line count + byte count + encoding heuristic + per-format
 *  attempt log to the agent console; (3) raise `_PcPostCommitError`
 *  with a helpful message that references the saved copy path and
 *  suggests a different SAP export-format option as a workaround.
 *  New capability `bulk-export-multi-format-parser`. NO frontend
 *  behaviour change beyond this version constant. See:
 *    Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback.md
 *    (v1.7.6: multi-format parser section)
 *
 *  v1.7.7 — Smart header detection in bulk-export parsers — banner
 *  lines no longer mistaken for column headers. The v1.7.6 LT10
 *  user reported a fresh symptom: `[query]  Parser detected format:
 *  B` followed by `[query]  %pc bulk export complete: 1 row(s),
 *  6 columns in 4.2s.`. The user's actual `lt10export` file starts
 *  with two SAP banner rows ("Whse number\t\t\t\t\tWH5", "Stge type
 *  \t\t\t\t\t999") BEFORE the real 18-20 column header — so the
 *  v1.7.6 "first non-blank line is the header" heuristic returned
 *  the warehouse banner as a 6-cell row and stopped. v1.7.7 replaces
 *  the heuristic with a scoring pass: every tab-bearing non-blank
 *  line is scored by its non-empty cell count; the candidate with
 *  the highest score (and ≥3 non-empty cells, so banner lines with
 *  <3 fall out) wins. Same hardening applied to Format C
 *  (fixed-width / 2+ spaces) in case a future variant omits tabs.
 *  Data rows are now PERMISSIVE on cell count — SAP DROPS trailing
 *  empty cells in tab-exported rows, so a 13-cell data row against
 *  a 20-cell header is normal (pad with empties); only rows with
 *  significantly MORE cells than the header are rejected. Same
 *  five-format ladder, same fallback semantics, same
 *  `result.meta.parser_format` output. New capability
 *  `bulk-export-smart-header`. NO frontend behaviour change beyond
 *  this version constant. See:
 *    Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback.md
 *    (v1.7.7: smart header detection section)  */
/** v1.7.8 — Agent + DB load reduction (Tier 4 + Tier 2/5 fixes from
 *  the investigation report). Three surgical agent changes pair with
 *  two DB-only migrations (254 + 255) applied via Supabase MCP.
 *
 *  Agent (omni_agent/agent.py):
 *    A. `_start_heartbeat_thread` resolves a per-tick cadence — base
 *       30s while a job is in flight (`state.active_job_id is not
 *       None`) so lease bumps stay snappy; idle 60s when there's
 *       been no active job for >5min. Mode transitions log once.
 *       New `state.last_job_completed_at` initialised to boot time
 *       and bumped in the job poller's `finally` block. Halves
 *       `sap_agents.last_seen_at` UPDATEs on a quiescent fleet.
 *    B. Removed the per-tick `reap_stale_sap_agents()` RPC call —
 *       pg_cron job `omniframe-reap-stale-sap-agents` (migration
 *       250) drives the reaper server-side every minute. Function
 *       definition unchanged; only the agent stops calling it.
 *    C. `_start_trigger_backfill_poller` gates on Realtime health —
 *       skips the PostgREST scan with `[backfill] skipping —
 *       Realtime is healthy and recently active` when
 *       `state.last_realtime_event_at` was bumped in the last
 *       2min. New stamp set at the top of `_on_rf_putaway_change`.
 *       v1.6.9 missed-event self-healing fully preserved: scan
 *       still runs when Realtime is silent OR circuit breaker
 *       tripped.
 *
 *  DB (Supabase migrations):
 *    254 — composite indexes for the fleet card / claim-path /
 *          backfill SELECTs (`idx_sap_agents_org_status_lastseen`,
 *          `idx_sap_agents_online`, `idx_sap_agent_jobs_claim_path`,
 *          `idx_rf_putaway_ops_backfill_target`).
 *    255 — REPLICA IDENTITY FULL → DEFAULT for `sap_agents` /
 *          `sap_agent_jobs` / `sap_agent_schedules` /
 *          `sap_outbound_to_import_runs`. `rf_putaway_operations`
 *          intentionally stays FULL because the agent-side trigger
 *          evaluator inspects the `record` payload Realtime
 *          synthesizes from the OLD image.
 *
 *  New capabilities advertised in /health.capabilities (purely
 *  informational, no frontend gating): `adaptive-heartbeat`,
 *  `realtime-aware-backfill`. See
 *  [[Implementations/Implement-Agent-DB-Load-Reduction]]. */
/** v1.7.9 — SAP session pinning. Bind the agent to ONE specific SAP GUI
 *  session so manual SAP work in OTHER sessions (different system /
 *  client / user) doesn't get hijacked by the agent's auto-select. The
 *  pin survives EXE rebuild + restart via `pinned_session` persisted in
 *  `%APPDATA%\OmniFrameAgent\config.json`. Two new endpoints +
 *  augmented `/sap/sessions` response back the picker UI:
 *
 *    POST /sap/select-session
 *      body  { conn_idx: number, sess_idx: number,
 *              pin_by_criteria?: boolean }
 *      → { ok, pinned: { conn_idx, sess_idx, system, client, user,
 *                        pinned_at, by_criteria } }
 *      Pins the agent to the given SAP session. Captures system/client/
 *      user as durable identity so SAP's per-launch session renumbering
 *      doesn't break the pin (`pin_by_criteria=true` enables the
 *      criteria-match fallback when the exact indexes are no longer
 *      valid). The agent stays disconnected if the pinned session
 *      disappears — it does NOT silently jump to a different session.
 *
 *    POST /sap/unpin-session
 *      → { ok, had_pin: boolean }
 *      Clears the pin and returns to v1.7.8 auto-select behaviour.
 *
 *    GET /sap/sessions  (augmented)
 *      Each session entry now carries `system`, `client`, `user`,
 *      `transaction`, `pinned: bool`, `is_active: bool`. Top-level
 *      response also echoes `pinned_session` so the picker can show
 *      the pinned criteria even when the underlying SAP session isn't
 *      currently visible.
 *
 *  New capability `sap-session-pinning` advertised in
 *  /health.capabilities — frontend gates the picker UI on this so older
 *  agents (≤1.7.8) silently degrade to the existing inline `<select>`.
 *  See [[Implementations/Implement-SAP-Session-Pinning]]. */
/** v1.8.1 — Remove `shipment_queue` from the agent's Realtime subscription
 *  (the table does not exist in the DB, so every `subscribe()` was
 *  triggering a 0.0s clean close at the Realtime layer). Plus a pair of
 *  UI polish fixes: (a) the pinned-session dropdown now marks EXACTLY ONE
 *  session with `pinned=true` — the previous logic flagged every session
 *  whose (system, client, user) matched the stored criteria, so a user
 *  with 6 SAP windows on the same sys/client/user saw "PINNED" on every
 *  row; (b) the Agent Triggers tab's SAP session badge now uses
 *  `agentFetch('/sap/sessions')` mirroring the Inventory Management tab
 *  so both read from the identical code path. Per-session dropdown rows
 *  collapse ACTIVE + PINNED into a single right-aligned pill to prevent
 *  the "PINNED … PINNED" double-badge artifact the user screenshotted.
 *  New capability: `pinned-session-single-winner`. See
 *  Debug/Fix-Realtime-CleanClose-Cycle.md. */
/** v1.8.2 — LT22 parser hardening — multi-factor header scoring with
 *  banner penalty + per-batch dedup defense in `lt22_import.py`. The
 *  user reported their LT22 PDC import 409-aborting on the unique
 *  constraint `sap_outbound_to_imports_unique_per_batch` after the
 *  agent reported parsing `561 rows, 2 columns` — meaning the parser
 *  picked the SAP banner (`Warehouse No.\t\t\tPDC\tIndianapolis PDC`,
 *  3 non-empty cells out of 5) instead of the real 19-non-empty header
 *  on line 4, then bulk-INSERTed empty/duplicate `to_number` values.
 *  v1.7.7's single-factor scorer had a `non_empty < 3` floor — the LT22
 *  banner has EXACTLY 3 non-empty cells, so it slipped past the filter.
 *  Three layered defenses, NO existing handler logic touched.
 *
 *  (A) `_score_header_candidate(non_empty, total_cells, following_data_rows)`
 *      blends three factors in `_parse_attempt_b_tab_delimited` and
 *      `_parse_attempt_c_fixed_width`:
 *        - Base: `non_empty * 10` — real headers carry every column title.
 *        - `+ min(following_data_rows, 20) * 5` bonus for lines whose
 *          siblings share the same shape (real headers see 100s of
 *          matches; banners see ~0 because the only similarly-shaped
 *          line nearby is the real header itself).
 *        - `-50` banner penalty when fill_ratio < 0.3 AND non_empty < 5
 *          (the SAP banner pattern: one label + one value padded by
 *          tabs). The penalty is intentionally larger than any banner
 *          could earn from raw `non_empty` alone (3 × 10 = 30), so a
 *          real header reliably outranks any banner-shaped candidate
 *          even when `following_data_rows = 0` for both.
 *      The `non_empty` floor drops from `< 3` to `< 2` since the
 *      penalty does the heavy lifting now.
 *
 *  (B) `lt22_import.py` defense-in-depth before the bulk INSERT:
 *      `_dedupe_lt22_rows(...)` deduplicates normalized rows by
 *      `to_number` within the batch (keep first occurrence — split
 *      deliveries can legitimately produce duplicate TO numbers),
 *      drops rows with empty/null `to_number` with a single warn-summary
 *      log line, and the POST switches to
 *      `Prefer: return=minimal,resolution=ignore-duplicates` so a
 *      partial-success run can re-execute without 409-aborting on rows
 *      the previous run already inserted.
 *
 *  (C) `lt22_import.py` parse-validation gate: `_validate_lt22_parse(...)`
 *      runs BEFORE the bulk INSERT. If the parsed `columns` array has no
 *      "TO Number"-shaped header OR every row's `to_number` is empty, a
 *      snapshot of the parsed rows + columns is saved to
 *      `%TEMP%/omniframe_lt22_parse_failure_<UTC_ts>.json` (best-effort)
 *      and a specific error is raised: `LT22 parsed but TO Number column
 *      not found / values empty — likely parser misidentified header.
 *      Diagnostic file saved to <path>`. Triagers can grab the diagnostic
 *      and we can add a Format F parser if a future SAP variant slips
 *      past the multi-factor scorer.
 *
 *  New regression test `omni_agent/tests/test_lt22_smart_header.py`
 *  (mirrors `test_lt10export_smart_header.py`'s self-contained namespace
 *  pattern). The existing v1.7.7 LT10 test stays passing unchanged. New
 *  capability `parser-banner-penalty` (purely informational, no frontend
 *  gating). NO migration. NO RLS. NO trigger semantics changed. NO SAP
 *  handler other than `lt22_import.py` touched. See
 *  [[Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback]] → "v1.8.2: parser
 *  banner penalty + per-batch dedup" section. */
/** v1.8.3 — Fix UTC-midnight PATCH bug — `_update_putaway_status` now
 *  prefers the source-row id from `__omni_trigger_meta.post_success_patch
 *  .row_id` and PATCHes by `id=eq.<row_id>` when present; falls back to
 *  a 48-hour `created_at` window when row_id is missing. Production
 *  caught 19 `rf_putaway_operations` rows that the agent successfully
 *  confirmed in SAP between 00:21–00:31 UTC May 6 but whose Putaway
 *  Log rows stayed at `to_status='Completed'` and `confirmed_at=NULL`
 *  because they were created on May 5 22:00–23:00 UTC and the legacy
 *  PATCH filter `created_at >= 2026-05-06` rejected all of them.
 *  PostgREST returned 200 OK with empty body, the agent logged
 *  "patched 0 rows", and the frontend kept showing "Pending TO
 *  Confirm" forever even though the TO had already been LT12-confirmed
 *  in SAP. The overlay-patch in `_apply_trigger_post_patch` (v1.6.8)
 *  was unaffected — it filters by `id=eq.<row_id>` — so
 *  `confirmed_source` / `confirmed_by_label` / `confirmed_by_agent_id`
 *  were all set correctly; only the legacy 3 fields silently no-op'd.
 *  Manually backfilled the 19 rows via Supabase MCP. Three surgical
 *  fixes, NO existing handler logic touched, NO trigger semantics
 *  changed, NO migration, NO RLS. (1) `_update_putaway_status(to_number,
 *  warehouse, row_id=None)` — when `row_id` is provided, PATCHes by
 *  `id=eq.<row_id>&to_status=neq.TO%20Confirmed`; when missing, falls
 *  back to a 48-hour `created_at` window so a same-day retry still
 *  hits and a UTC midnight crossing is no longer fatal. (2)
 *  `confirm_transfer_order(req, row_id=None)` — accepts an optional
 *  `row_id` kwarg and forwards it to BOTH `_update_putaway_status`
 *  call sites (already-confirmed branch + post-Save success branch).
 *  (3) `_dispatch_job(job)` — extracts `row_id` from
 *  `payload.__omni_trigger_meta.post_success_patch.row_id` and passes
 *  it as a kwarg to `/sap/confirm-to` only (narrow allowlist
 *  `_ROW_ID_AWARE_ENDPOINTS`). Other handlers don't receive `row_id`
 *  so adding the kwarg to them later is opt-in. Diagnostic: when the
 *  PATCH affects 0 rows the agent now logs `[lt12]  WARN
 *  _update_putaway_status PATCHED 0 rows for TO {to_number} WH
 *  {warehouse} (row_id={row_id}, cutoff={cutoff}). Possible
 *  UTC-midnight crossing OR row already TO Confirmed OR RLS hid it
 *  from this user.` so future regressions are visible immediately
 *  instead of silently mis-patching. `_apply_trigger_post_patch`
 *  (v1.6.8) is UNCHANGED — already uses `id=eq.<row_id>` correctly.
 *  New capability `putaway-update-by-rowid` advertised in
 *  /health.capabilities (purely informational, no frontend gating).
 *  See [[Debug/Fix-Putaway-Status-UTC-Midnight]] for the 19-row
 *  production evidence + the manual SQL backfill. */
/** v1.8.4 — Aggressive Realtime degradation when unhealthy. Production
 *  caught the org's Supabase Realtime Presence GenServer crashing for
 *  tenant c9d89a74 (Presence_shard112 timeouts on `:track` calls from
 *  the customer portal) and GoTrue `/user` requests at 2.2s — users
 *  were stuck at the sign-in screen. The OmniFrame Agent v1.8.2 was
 *  contributing: its 5-second clean-close Realtime reconnect cycle
 *  (12+ reconnects/min) compounded the tenant Realtime load.
 *  Empirically, closing the agent immediately restored web-app
 *  loading. Root cause was that the v1.8.0 clean-close circuit
 *  breaker was too lenient (5 closes in 60s = trip, then a fixed
 *  5min auto-retry that re-tripped on a chronically degraded tenant
 *  → forever cycle).
 *
 *  Five surgical fixes, NO existing handler logic touched, NO
 *  trigger semantics changed, NO migration, NO RLS, NO Supabase
 *  Storage touched:
 *
 *  (1) **Tighter clean-close circuit breaker** — `_REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS`
 *      drops from 60s to 30s, `_REALTIME_SPURIOUS_CLOSE_THRESHOLD`
 *      drops from 5 closes to 2 closes, `_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC`
 *      drops from 30s to 15s. Combined: any 2 close events that
 *      happen within 15s of subscribe in a 30s window trip the
 *      circuit. On a degraded tenant this means the agent gets
 *      OFF Realtime within ~5s of the second close instead of
 *      cycling for 25+s before tripping.
 *
 *  (2) **Exponential auto-retry cooldown** — instead of a fixed 5min
 *      retry, the reset loop now uses a doubling ladder
 *      (30min → 60 → 120 → 240 → 360min cap = 6h) keyed off a new
 *      `_realtime_reset_state["consecutive_trips"]` counter. The
 *      counter resets to 0 ONLY after a Realtime connection
 *      survives `_REALTIME_STABLE_CONNECTION_SEC` (60s). So a
 *      chronically degraded tenant gets a long break (hours)
 *      instead of being re-hammered every 5min, and a transient
 *      glitch still recovers within 30min.
 *
 *  (3) **`OMNIFRAME_DISABLE_REALTIME=1` escape hatch** — new env var
 *      that skips Realtime entirely at boot. Sets
 *      `state.realtime_disabled = True` immediately, prints
 *      `[boot] Realtime: DISABLED via OMNIFRAME_DISABLE_REALTIME=1
 *      — using polling-only mode (job poller 5-15s, backfill
 *      poller 60s).` and never spawns the asyncio thread. The
 *      agent stays fully functional — only sub-second Realtime
 *      push wakes are lost; the v1.6.9 backfill poller (60s) +
 *      v1.7.0 drain mode (5-15s job poller idle ceiling) cover
 *      the load. This is the "give me stability over latency"
 *      mode for environments where Realtime is unreliable.
 *
 *  (4) **Slower reconnect ladder** — initial reconnect delay bumps
 *      from 5s to 15s; per-attempt growth changes from
 *      multiplicative ×2 (5 → 10 → 20 → 40 → 60) to additive +5
 *      (15 → 20 → 25 → … → 60). Backoff resets to 15s ONLY after
 *      a connection survives 60s. So even when Realtime mostly
 *      works, the agent doesn't hammer Supabase with rapid
 *      reconnects on individual transient closes.
 *
 *  (5) **Extended `/realtime/status` payload** — three new stable
 *      fields: `consecutive_trips: int` (drives the cooldown
 *      ladder), `next_retry_seconds: int` (countdown to the next
 *      reconnect attempt — 0 when not tripped), `recommended_action: str`
 *      (human-readable next step, e.g. "Set OMNIFRAME_DISABLE_REALTIME=1
 *      to fully disable Realtime if circuit keeps tripping"), plus
 *      `realtime_disabled_via_env: bool`. Frontend dashboards can
 *      consume these to show an accurate "Realtime: off (cooling
 *      down 27min) — recommend disabling via env var" pill instead
 *      of the binary "agent connected/disconnected" signal /health
 *      gives.
 *
 *  New capability `realtime-aggressive-degradation` advertised in
 *  `/health.capabilities` (purely informational, no frontend
 *  gating). The job poller polling-only ceiling stays at 15s
 *  (well-tested since v1.7.1). v1.8.0 clean-close tracker, v1.8.0
 *  hb_interval=10s heartbeat, v1.7.1 exception circuit breaker, all
 *  preserved verbatim — v1.8.4 just tightens thresholds and adds
 *  the env-var escape hatch.
 *
 *  See [[Debug/Fix-Realtime-Tenant-Overload]] for the Presence
 *  GenServer crash evidence + the v1.8.2/v1.8.4 reconnect math. */
/** v2.0.0 — Phase 11 of the rust-work-service integration plan
 *  (.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md).
 *  Architecture-change boundary release: agent's control plane is now
 *  rust-work-service (WS for row events, REST for job claim/complete/
 *  fail/heartbeat); trigger evaluator runs server-side (Phase 9); agent
 *  owns its own credentials via service keys (Phase 10, soft-fallback
 *  in 2.0.x). Defaults flipped: OMNIFRAME_AGENT_USE_RUST_WS=1,
 *  OMNIFRAME_AGENT_CLAIM_VIA_RUST=1, OMNIFRAME_AGENT_CONSOLE_RELAY=1
 *  (each scheduled for env-var removal in v2.1.0). Legacy
 *  direct-PostgREST claim/complete/fail/lease-bump fallback paths
 *  DELETED. Migration 284 flipped rf_putaway_operations REPLICA
 *  IDENTITY FULL → DEFAULT now that Realtime is no longer the agent's
 *  row-event source. New env var OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1
 *  upgrades the missing-service-key boot warning to a hard-fail
 *  exit-78. New capability `agent-2.0-architecture` advertised. See
 *  Implementations/Implement-Rust-Work-Service-Phase11.md +
 *  Implementations/Implement-Rust-Work-Service-Full-Integration-Summary.md. */
export const LATEST_AGENT_VERSION = '2.0.0'

/** Custom DOM event fired when a 401 is observed from the local agent.
 *  `useAgentDetection` listens for this so the SAP Testing banners can
 *  flip from green ("agent online") to amber ("agent online but session
 *  expired") without waiting for the next /agent-token/check probe. */
export const AGENT_TOKEN_STALE_EVENT = 'omniframe:agent-token-stale'

/** Throttle window for the user-visible toast — 5 minutes per tab. */
const STALE_TOAST_THROTTLE_MS = 5 * 60_000
let _lastStaleToastAt = 0

export interface AgentHealth {
  ok: boolean
  version?: string
  sap_connected?: boolean
  started_at?: string
  citrix?: {
    is_citrix?: boolean
    session_name?: string | null
    client_name?: string | null
    computer_name?: string
    user_name?: string
  }
  /** Phase B8 — list of capability ids supported by the running agent. */
  capabilities?: string[]
}

let _inMemoryToken: string | null = null

export function setAgentToken(token: string | null) {
  _inMemoryToken = token
  try {
    if (token) localStorage.setItem(AGENT_TOKEN_STORAGE_KEY, token)
    else localStorage.removeItem(AGENT_TOKEN_STORAGE_KEY)
  } catch {
    /* localStorage may be unavailable (private mode) — keep in-memory copy */
  }
}

export function getAgentToken(): string | null {
  if (_inMemoryToken) return _inMemoryToken
  try {
    const stored = localStorage.getItem(AGENT_TOKEN_STORAGE_KEY)
    if (stored) {
      _inMemoryToken = stored
      return stored
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Per-call options recognised by `agentFetch` ON TOP of the standard
 * `RequestInit` shape. Consumers that don't pass an options arg get the
 * default behaviour (toast on 401, fire stale-token event).
 *
 * Background pollers (fleet refresh, /metrics card, agent detection
 * itself, status-button heartbeat) should pass `suppressStaleToast` so
 * a single bad token doesn't spam N toasts as those pollers tick. The
 * stale-token event still fires so the detection state updates — only
 * the user-visible toast is suppressed.
 */
export interface AgentFetchOptions {
  /** When true, skip the toast on 401. The custom event still fires
   *  and the localStorage token is still cleared. Default false. */
  suppressStaleToast?: boolean
}

/**
 * Internal helper: react to a 401 from the local agent by clearing the
 * token, firing the event, and (unless suppressed) toasting the user.
 * Idempotent under throttle so a flurry of background calls all 401-ing
 * at once produces exactly one toast.
 */
function _handleAgentUnauthorized(suppressToast: boolean): void {
  // Clear the bad token so subsequent calls don't keep sending it. The
  // user re-acquires a fresh value via the existing AgentSupabaseLoginDialog
  // (which calls /supabase/login → response now contains the persistent
  // token rather than a freshly-minted one).
  setAgentToken(null)
  // Notify the rest of the app (useAgentDetection picks this up so its
  // `authenticated` flag flips to false immediately, without waiting for
  // the next 5s health-probe tick).
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AGENT_TOKEN_STALE_EVENT))
    }
  } catch {
    /* SSR / non-browser context — ignore */
  }
  if (suppressToast) return
  const now = Date.now()
  if (now - _lastStaleToastAt < STALE_TOAST_THROTTLE_MS) return
  _lastStaleToastAt = now
  toast.warning('Agent session expired', {
    description:
      'Your agent token is stale (likely due to a rebuild or a logout from another tab). Click the Connect Account pill to reconnect.',
    duration: 8000,
  })
}

export async function agentFetch(
  path: string,
  init?: RequestInit,
  options?: AgentFetchOptions
): Promise<Response> {
  const token = getAgentToken()
  const headers = new Headers(init?.headers ?? {})
  if (token && !headers.has('X-Agent-Token')) {
    headers.set('X-Agent-Token', token)
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(`${AGENT_URL}${path}`, { ...init, headers })
  // v1.6.5 — only treat 401 as "stale agent token" when we actually
  // sent a token. Otherwise the agent is just enforcing auth on a path
  // the caller forgot to log in for; that's not a token-rotation
  // recovery scenario.
  if (res.status === 401 && token) {
    _handleAgentUnauthorized(!!options?.suppressStaleToast)
  }
  return res
}

/** True if the agent reported the given capability id in /health. */
export function hasCapability(
  health: AgentHealth | null | undefined,
  capability: string
): boolean {
  if (!health) return false
  // Pre-1.4.0 agents won't include the field at all — treat as missing.
  if (!Array.isArray(health.capabilities)) return false
  return health.capabilities.includes(capability)
}

/**
 * Compare two semver-ish strings (e.g. '1.3.3' vs '1.4.0'). Returns
 * negative if `a < b`, 0 if equal, positive if `a > b`. Treats missing
 * as 0 so a missing version compares as the lowest.
 */
export function compareAgentVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const av = pa[i] ?? 0
    const bv = pb[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

export function isAgentOutdated(
  health: AgentHealth | null | undefined
): boolean {
  if (!health?.version) return false
  return compareAgentVersions(health.version, MIN_REQUIRED_AGENT_VERSION) < 0
}

// Created and developed by Jai Singh
