---
tags: [type/component, status/active, domain/backend, domain/frontend, recorder]
created: 2026-04-29
---
# SAP Recorder — Self-Recording Mode

## Purpose
Let a non-developer add a new SAP transaction handler to OmniFrame without ever touching VBS or Python. Click **Record** in the Inventory Management tab → perform the transaction in SAP normally → click **Stop** → receive a draft Python handler that follows OmniFrame's existing conventions, ready to drop into `agent.py`.

## Architecture
```
  Browser                   Localhost Agent (1.5.0+)               Disk
  ----------                -------------------------------         -------
  Record click   POST /sap/recording/start  →  _RecordingSession  
                              │
                              ├── Hooks (WithEvents on SAP COM) — best-effort
                              └── Polling (200ms tree-diff) — always on (safety net)
  Stop click     POST /sap/recording/stop —→ events flushed   —→ AES-256-GCM
                              │                                   .json.enc + .meta.json
                              │                                   in %LOCALAPPDATA%/
                              │                                   OmniFrameAgent/recordings/
  List view      GET  /sap/recording/list  ←  meta sidecars (cheap, plaintext)
  Detail view    GET  /sap/recording/{id}  ←  decrypted full doc
  Generate       POST /sap/recording/{id}/translate
                              │
                              └── _translate_recording() → Python + VBS + confidence + warnings
  Replay (opt-in)POST /sap/recording/{id}/replay
                 (header X-Recording-Allow-Replay: yes)
```

## Capture modes
| Mode | How it works | Pros | Cons |
|---|---|---|---|
| **Hooks** | `win32com.client.WithEvents(sap_app, _SapEventSink)` after `sap_app.Record = True`. SAP fires `OnHit` / `OnRecord` for every user action. | Microsecond timing precision; explicitly captures button presses. | Requires SAP scripting recording enabled; fails silently on some SAP/Citrix combos. |
| **Polling** | Background thread snapshots `wnd[0..3]/usr` every 200ms with `_snapshot_window`. Diffs against previous snapshot → emits synthetic events for changed values, popups, transaction codes, screen titles, sbar messages. | Works on every SAP version; no scripting privileges needed. | 200ms granularity; button presses are inferred from screen/sbar transitions. |
| **Hooks+Polling** (default) | Both run in parallel — hooks for the precise event grain, polling for the safety net. The recorder reports `mode_used = "hooks+polling"` when this combination engaged. | Best of both. | Slightly higher CPU during a recording. |

## Files
| File | Role |
|---|---|
| `omni_agent/agent.py` (lines ~4500–6000) | `_RecordingSession`, `_polling_capture_loop`, `_try_start_hooks_capture`, `_translate_recording`, all 7 endpoints |
| `src/features/admin/sap-testing/lib/recorder.ts` | Typed wrappers around `/sap/recording/*` |
| `src/features/admin/sap-testing/components/recorder-panel.tsx` | UI: pulsing record button, list, detail, code preview |
| `src/features/admin/sap-testing/components/inventory-management-tab.tsx` | Adds `tools` category + `kind: 'tool'` to `QueryDefinition`, mounts the `RecorderPanel` |

## API reference
| Method | Path | Purpose |
|---|---|---|
| POST | `/sap/recording/start` | Begin a new recording (only one allowed at a time) |
| POST | `/sap/recording/stop`  | Finalise + flush to disk + return events |
| GET  | `/sap/recording/status` | Live progress (polled 1Hz by UI while recording) |
| GET  | `/sap/recording/list?limit&since` | List meta sidecars (no decrypt) |
| GET  | `/sap/recording/{id}` | Decrypted full recording |
| DELETE | `/sap/recording/{id}` | Hard-delete (.enc + .meta.json) |
| POST | `/sap/recording/{id}/translate` | Generate Python + VBS + confidence |
| POST | `/sap/recording/{id}/replay` | DRY-RUN replay (requires opt-in header) |

## Capabilities (advertised in `/health`)
`recording-start`, `recording-stop`, `recording-translate`, `recording-replay`, `recording-list`. The frontend `RecorderPanel` checks `recording-start` and shows an upgrade banner if missing.

## Security model
- All endpoints respect the existing `enforce_agent_token` middleware.
- Recordings encrypted at rest with AES-256-GCM. Key = SHA-256(agent_token + COMPUTERNAME)[:32]. Key is **never** written to disk.
- Recordings never leave the agent. The browser only renders what the user explicitly opens.
- Replay is opt-in via `X-Recording-Allow-Replay: yes` header to prevent accidental SAP mutations.
- 30-day auto-purge in `_purge_old_recordings`.

## Audit logging
All lifecycle events go to `sap_audit_log` with `action='recording_start'|'recording_stop'|'recording_translate'|'recording_replay'`. Payload includes `recording_id`, `event_count`, `transactions`, `mode_used`, `confidence`, `warnings`.

## Robustness
- SAP scripting disabled mid-recording → status='partial', returns what we have.
- Agent crash mid-recording → `_scan_for_orphaned_recordings` on next startup flags the sidecar.
- Polling auto-stops after 30 minutes.
- Recording size cap: 50 MB → stop with 'partial' status.
- Hooks failure → silent fallback to polling.

## Translator output convention
- Python output is deterministic (stable header, sorted dict keys) so users can `git diff` translations across sessions.
- Inline `# TODO: review` comments flag ambiguous parts (popups, sbar messages without obvious dispatch policy).
- Confidence score (0.05–0.99) with high/medium/low colour bands in the UI.

## Related
- [[Patterns/SAP-Event-Capture]]
- [[Implementations/Implement-Self-Recording-Mode]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Patterns/Agent-Capability-Negotiation]]
- [[Implementations/SAP-Audit-Trail]]
