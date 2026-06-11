---
tags: [type/decision, status/active, domain/infra, domain/backend]
created: 2026-05-15
---
# ADR — OmniAgent v2 RPC Wire Contract: Python helper is canonical

## Purpose / Context

OmniAgent v2 splits the v1 monolithic Python agent into a Rust shell (`agent.exe`, `agent-gui.exe`) and a long-lived Python helper (`python/sap_helper.py`) that owns every SAP COM call. The two halves talk line-delimited JSON-RPC 2.0 over stdio. The method namespace is duplicated in three places:

1. `crates/agent-types/src/rpc.rs` — Rust `enum RpcMethod` (drives `Display`/`FromStr`/serde-rename for the on-wire string).
2. `python/sap_helper.py` + `python/handlers/*.py` — Python `dispatcher.register(method, handler)` calls.
3. `gui/src/lib/types.ts` — not used today; the Tauri GUI calls Rust commands, not RPC methods by name.

During the 2026-05-15 final-integration handoff, Worker A defined 25 enum variants (legacy-style with `sap.query.lt10/lt24/mb52/mmbe` etc.) while Worker B registered 32 methods (collapsed `sap.query` with a `handler` discriminator + added `sap.health`, `sap.fleet`, `sap.sessions`/`session`/`selectSession`/`unpinSession`, full recording CRUD, etc.). Only 17 names matched.

## Decision

**Python is the wire-protocol source of truth.** The Rust `RpcMethod` enum mirrors Python's dispatcher table verbatim. New methods land in the Python handlers first; Rust catches up by adding the matching variant.

Rationale:
- The Python helper is the actual server that dispatches the calls. A misnamed Rust variant produces a runtime METHOD_NOT_FOUND (“dead code”).
- A misnamed Python registration is a SAP feature that's literally not available — forcing us to add the Python side first means we never ship a Rust route that 404s.
- Worker B authored the per-transaction handlers (LT12, LT01, LS01N, MM02/03, LS02N, LT22, LX25, ZMM60, recording, reversal) and modelled each method name on what felt natural for an asyncio handler. Matching that naming keeps the human signal-to-noise high.

## Details

### Canonical 32-method set (as of 2026-05-15)

```
sap.connect                                sap.processShipment
sap.disconnect                             sap.shipmentProgress
sap.sessions                               sap.importLt22
sap.session                                sap.zmm60Lookup
sap.selectSession                          sap.lx25InventoryCompletion
sap.unpinSession                           sap.recording.start
sap.health                                 sap.recording.stop
sap.fleet                                  sap.recording.status
sap.confirmTo                              sap.recording.list
sap.transferInventory                      sap.recording.get
sap.binBlocks                              sap.recording.delete
sap.materialMasterBin                      sap.recording.translate
sap.materialMasterStorageTypes             sap.recording.replay
sap.createStorageBin                       sap.reverseTransaction
sap.materialMasterReadBin
sap.materialMasterReadStorageTypes
sap.query
sap.queryHandlers
```

### Special-cased Rust-native endpoints (NOT in the enum)

- `POST /sap/reversal/compute-inverse` — pure function ported from Python `reversal_engine.compute_inverse`. The Rust shell answers locally via `agent_core::reversal::build_response`. Python exposes `sap.reverseTransaction` as a stub returning `{ok:false, owner:"rust-reversal-service"}` so the helper still owns a slot for future SAP-side reversal flows (e.g. wrapping a real LT0G).

### Cross-check guard

`packaging/check_rpc_contract.py` parses both sides' string literals on every `packaging/build_macos_validate.sh` run and fails the validation if the symmetric difference is non-empty. It is intentionally lenient about extra TS literals (the GUI doesn't dispatch by name) but strict about Rust↔Python parity.

## Related

- [[Implement-OmniAgent-V2-Tauri-GUI]]
- [[Plan-Multi-Session-Agent-Master]]
