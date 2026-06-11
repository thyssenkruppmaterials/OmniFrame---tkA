---
tags: [type/pattern, status/active, domain/backend, recorder]
created: 2026-04-29
---
# SAP Event Capture (Hooks vs Polling)

## Purpose / Context
When building anything that needs to observe what a user is doing in the SAP GUI — self-recording, undo/replay, training-data collection — there are two viable strategies. This pattern documents the trade-offs and the production-tested combination we landed on for [[Components/SAP-Recorder]].

## The two strategies

### 1. Hooks (COM event subscription)
```python
import win32com.client

class SapEventSink:
    def OnHit(self, control, name, value):
        ...   # fires for every user interaction
    def OnRecord(self, action_text):
        ...   # fires once per logical action

w32 = win32com.client
sap_app = w32.GetObject("SAPGUI").GetScriptingEngine
sap_app.Record = True            # critical: enables event firing
handler = w32.WithEvents(sap_app, SapEventSink)
# ... user interacts with SAP, sink methods are called ...
sap_app.Record = False
```

**Pros**
- Microsecond timing precision.
- Captures button presses directly (polling can only infer them).
- Catches transient UI states polling would miss (focus, caret).

**Cons / failure modes**
- `sap_app.Record = True` can throw on some SAP GUI versions (no scripting recording privilege).
- `WithEvents` requires SAP's typelib-described event interface; pywin32 sometimes can't dispatch it.
- Citrix sessions occasionally drop COM events under load.
- If hooks die mid-session, the user has no idea — they keep clicking but nothing is captured.

### 2. Polling (snapshot + diff)
```python
def _snapshot_window(sess, wnd_idx):
    out = {}
    def _walk(node):
        if node.Type in ("GuiTextField", "GuiCTextField", "GuiCheckBox", ...):
            out[node.Id] = {"type": node.Type, "value": str(node.Text), ...}
        for child in node.Children:
            _walk(child)
    _walk(sess.findById(f"wnd[{wnd_idx}]"))
    return out

while not stop:
    cur = _snapshot_window(sess, 0)
    for cid, val in cur.items():
        if prev.get(cid, {}).get("value") != val["value"]:
            emit("set_text", target=cid, value=val["value"])
    prev = cur
    time.sleep(0.20)
```

**Pros**
- Works on every SAP version we've tested.
- Survives Citrix flakiness (next iteration just re-snapshots).
- Failure modes are loud (COM error → stop event set → status='partial' surfaced to user).

**Cons**
- 200ms granularity (so very-fast typing collapses into one event).
- Button presses must be inferred from screen-title / sbar transitions — emit a synthetic `inferred_action` with `hint='vkey0_or_button_press'` for the translator to reason about.
- Higher CPU than hooks (still tiny — a snapshot takes <5ms in practice).

## The combined strategy we ship
```python
rec = _RecordingSession(...)
used_hooks = _try_start_hooks_capture(rec)   # best-effort; never raises
rec.mode_used = "hooks+polling" if used_hooks else "polling"

# Polling ALWAYS runs. With hooks engaged it provides the safety net
# (sbar / screen-change events the hooks don't surface). Without hooks
# it's the primary capture path.
rec.poller_thread = threading.Thread(target=_polling_capture_loop, args=(rec,), daemon=True)
rec.poller_thread.start()
```

Why this beats picking just one:
- **No worst-case failures**: if hooks fail, the user still gets a recording. If polling drops a transition, hooks usually caught it.
- **No false-positive button presses**: when both modes record the same action, the de-dup happens in the translator (`_is_useful_event` filters duplicate `sendVKey 0` events that fire within 50ms of a `set_text` on the same window).
- **Mode discoverable**: `recording.mode_used` ('hooks+polling' | 'polling') tells the user (and ops) what actually ran.

## When to use which strategy alone
- **Hooks only**: never. The reliability hit isn't worth the marginal precision.
- **Polling only**: when shipping to a controlled environment (specific SAP/Citrix combo) where SAP scripting recording can't be enabled by IT policy.
- **Both (default)**: production.

## Noise filter (translator-side)
The raw event stream keeps everything for debug. The translator uses `_is_useful_event(ev, prev)` to drop:
- Standalone `set_focus` / `caret_position` events.
- `sendVKey 0` within 50ms of a `set_text` on the same window (SAP fires both for the same physical Enter).

## Related
- [[Components/SAP-Recorder]]
- [[Implementations/Implement-Self-Recording-Mode]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Patterns/Agent-Capability-Negotiation]]
