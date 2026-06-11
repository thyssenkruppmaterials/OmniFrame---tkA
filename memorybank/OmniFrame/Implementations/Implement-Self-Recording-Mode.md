---
tags: [type/implementation, status/completed, domain/backend, domain/frontend, recorder]
created: 2026-04-29
updated: 2026-04-29
---
# Implement: Self-Recording Mode (Phase D #12) — COMPLETED

## Status
**Shipped in v1.5.0** (2026-04-29).

## Purpose / Context
Replaces the manual VBS-recording → hand-translate-to-Python workflow with a one-click "Record → perform in SAP → Stop → get a draft Python handler" flow inside the OmniFrame Inventory Management tab.

## What got built

### Agent (`omni_agent/agent.py`, v1.4.1 → 1.5.0)
New section after the existing handlers, before `main()`:

- **`_RecordingSession`** — in-memory session state (id, name, mode, events, transactions, status). Single global active recording.
- **Polling capture** (`_polling_capture_loop`) — snapshots `wnd[0..3]/usr` every 200ms, diffs against previous snapshot, emits synthetic events for changed text/checkbox/dropdown values, popup open/close, transaction codes (okcd), screen titles, and status-bar messages.
- **Hooks capture** (`_try_start_hooks_capture`) — best-effort `WithEvents(sap_app, _SapEventSink)` subscription to SAP COM events. Falls back to polling if the SAP version doesn't fire events reliably. The polling loop ALWAYS runs in addition (safety net).
- **Encryption at rest** — AES-256-GCM via `cryptography` library. Key = SHA-256(`agent_token` + `COMPUTERNAME`)[:32]. Key never written to disk, derived on demand. Falls back to plaintext-on-disk with a console warning if `cryptography` isn't bundled.
- **Storage** — `%LOCALAPPDATA%/OmniFrameAgent/recordings/<id>.json.enc` + `<id>.meta.json` (sidecar plaintext for the list view). 30-day auto-purge in `_purge_old_recordings`.
- **Translator** (`_translate_recording`) — analyses the event stream and emits idiomatic OmniFrame Python (Pydantic request model, `_with_retries(...)` around tx-open, `_classify_sbar` + `_ack_save_warnings` after Save, two-step / popup detection) plus a 1:1 VBS replay, plus a confidence score and inline `# TODO: review` comments.
- **Crash recovery** — `_scan_for_orphaned_recordings()` on startup marks any sidecar with `status="recording"` as `partial`. Shutdown handler auto-stops + flushes an active recording.

New endpoints (token-protected; capability-gated):
- `POST /sap/recording/start` `{name?, mode?}` → `{recording_id, mode_used, session_info, started_at}`
- `POST /sap/recording/stop` → full event stream + duration + transactions
- `GET  /sap/recording/status` → live event_count + duration_ms (UI polls 1Hz)
- `GET  /sap/recording/list?limit&since` → meta sidecars only (cheap, no decrypt)
- `GET  /sap/recording/{id}` → decrypted full recording
- `DELETE /sap/recording/{id}` → hard-delete (unlinks both `.enc` + `.meta.json`)
- `POST /sap/recording/{id}/translate` `{name, kind, input_overrides?}` → Python + VBS + suggested model + confidence + warnings + detected feature flags
- `POST /sap/recording/{id}/replay` (requires `X-Recording-Allow-Replay: yes`) → DRY-RUN replay

New capabilities in `/health.capabilities`:
`recording-start`, `recording-stop`, `recording-translate`, `recording-replay`, `recording-list`.

### Frontend
- **`src/features/admin/sap-testing/lib/recorder.ts`** (new) — typed wrappers around all 7 recorder endpoints, `formatDurationMs`, `confidenceLabel`, `downloadTextFile`.
- **`src/features/admin/sap-testing/components/recorder-panel.tsx`** (new, ~900 LOC) — pulsing red Record button with live event-count + transaction badge, recordings list (status-coloured), detail view with Events / Variables / Generate tabs, code-preview modal with Python + VBS tabs, Copy/Download/Replay actions, replay-confirm dialog, privacy banner, mode picker (hooks/polling), capability gate ("agent v1.5.0+ required").
- **`inventory-management-tab.tsx`** — added `tools` category and a `kind: 'tool'` discriminator on `QueryDefinition`. The new `recorder` entry renders `<RecorderPanel />` instead of the standard form/results layout.
- **`agent-fetch.ts`** — new `LATEST_AGENT_VERSION = '1.5.0'` constant.

### Audit logging
`logSapAudit({ transactionCode: 'RECORDER', action: 'recording_start' | 'recording_stop' | 'recording_translate' | 'recording_replay' })` — all four lifecycle events are persisted to `sap_audit_log` with payload `{recording_id, event_count, transactions, mode_used, confidence, warnings}`.

### Encryption / privacy
- AES-256-GCM with per-agent derived key (no key on disk).
- Recordings never leave the agent host; the browser only renders what the user explicitly opens.
- UI banner: "Recordings stay on this machine. Captured field values are encrypted at rest with a key derived from your agent token + machine name."
- Hard-delete on user request (file unlinked).

## File paths edited / created
- `omni_agent/agent.py` — version bump, `AGENT_CAPABILITIES`, ~1,470 lines of recorder + translator + endpoints, startup/shutdown hooks.
- `omni_agent/requirements.txt` — added `cryptography>=42.0`.
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION`.
- `src/features/admin/sap-testing/lib/recorder.ts` — NEW.
- `src/features/admin/sap-testing/components/recorder-panel.tsx` — NEW.
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — Recorder wiring + `tools` category.
- `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/{agent.py, requirements.txt}` — copied for Parallels rebuild.

## Translator capabilities checklist
- [x] Recognises read-only query (no Save) vs mutation (saw `btn[11]`)
- [x] Multi-transaction segmentation (each `/n<TX>` starts a new section)
- [x] Auto-infers Pydantic field name + type from captured values (preserves leading zeros for str)
- [x] Wraps tx-open in `_with_retries`
- [x] Inserts `_ack_save_warnings` + `_classify_sbar` after each Save
- [x] Two-step confirm pattern (`_TWO_STEP_KEYWORDS` match in sbar) → extra Enter
- [x] Popup detection (popup_open events) → adds wnd[1] Enter handling block
- [x] Soft-warning hits flagged via the existing `SAP_SOFT_WARNINGS` catalog
- [x] User-renamable input identifiers + type overrides (UI sends `input_overrides`)
- [x] Inline `# TODO: review` comments for ambiguous events
- [x] Confidence score 0.05–0.99 with high/medium/low colour bands
- [x] Deterministic output (sorted keys, stable headers) for clean diffs
- [x] Outputs both Python (idiomatic) and VBS (1:1 replay)

## Edge cases handled
- SAP scripting disabled mid-recording → COM errors are caught, `status='partial'` set, partial events returned.
- Agent crashes mid-recording → orphan-scan on startup flags the sidecar.
- Polling auto-stops after 30 minutes (safety cap).
- Recording size cap 50MB → `status='partial'` + stop_event set.
- Replay safety: requires `X-Recording-Allow-Replay: yes` header (UI sends only after explicit confirm modal).

## Build status
`npm run build` — passes (~10s). Bundle change: `feature-admin-sap-Di8LW3ko.js` 320 KB → covers the recorder.
`python3 -m py_compile omni_agent/agent.py` — passes.

## Concrete next steps for the user
1. Open Parallels → `cd C:\OmniFrameBridge\Omni-Agent && pip install -r requirements.txt && build_exe.bat` to rebuild the EXE with `cryptography` bundled.
2. Copy `dist/OmniFrame_Agent.exe` → upload to Supabase storage `downloads/OmniFrame_Agent.zip` (zip first because corporate CASB blocks raw .exe).
3. In OmniFrame UI → Admin → SAP Testing → Inventory Management → pick **SAP Recorder** in the Query Library (Tools section).
4. Hit the big red button, perform a transaction in SAP, hit Stop. Open the recording, click **Generate Handler**, paste the Python into `omni_agent/agent.py` (alongside the existing `confirm_transfer_order` / `transfer_inventory` handlers), rebuild the EXE.

## Related
- [[Components/SAP-Recorder]]
- [[Patterns/SAP-Event-Capture]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Patterns/Agent-Capability-Negotiation]]
- [[Sessions/2026-04-29]]
