---
tags: [type/implementation, status/active, domain/agent, domain/frontend]
created: 2026-05-21
---

# Implement — Phase H.3 OmniFrame Connect Widget Polish

End-user polish on [[Implement-Phase-H1-Connect-MVP]] + [[Implement-Phase-H2-Self-Diagnostic-Friendly-Errors-Reset]]. Position persistence, off-screen guard, hover tooltip, pill pulse animation, paused visual cue, and a single subtitle-hint priority resolver.

## Package layout (additive)

```
omni_agent/connect/
├── widget_position.py   # read/write connect_widget_pos.json + clamp_to_visible_monitor
├── tooltip.py           # ConnectTooltip overlay + build_tooltip_text
├── animation.py         # pulse_color_steps + schedule_pulse (widget.after)
├── connect_gui.py       # wiring: persist, guard, tooltip, pulse, pause cue
├── state.py             # is_paused_state, resolve_subtitle_hint
├── supervisor.py        # pill_intent_queue for GUI pulse hook
└── tests/
    ├── test_widget_position.py
    ├── test_tooltip_pure_copy.py
    ├── test_animation_steps.py
    └── test_resolve_subtitle_hint.py
```

## Position persistence

- Path: `%USERPROFILE%\.omniframe\connect_widget_pos.json`
- `Position(x, y, monitor_geometry)` stored as JSON
- Atomic write: temp file in same dir → `os.replace`
- Corrupt JSON on read: log + delete file + return `None`
- Read on launch; write on drag-end (`<ButtonRelease-1>`, throttle 500 ms) and `WM_DELETE_WINDOW` before shutdown ladder
- `cli.run_reset()` deletes the file (unchanged from H.2 stub)

## Off-screen guard

- Pure `clamp_to_visible_monitor(pos, monitors, widget_width, widget_height)`
- Fully inside any monitor → unchanged
- Otherwise snap to nearest monitor bottom-right with 12 px margin
- GUI: apply on show + `<Configure>` when monitor layout changes
- Monitors: optional `screeninfo.get_monitors()` if already installed; else primary-only fallback via `winfo_screenwidth/height` (**multi-monitor limitation documented here**)

## Hover tooltip

- `ConnectTooltip` on widget body: 500 ms hover delay, 8 px below cursor, auto-hide 8 s
- Pure `build_tooltip_text(state, cache, last_health)` — no Python jargon (test-gated)

## Pulse animation

- Pure `pulse_color_steps(from_hex, to_hex, steps=10)` → 10 RGB-interpolated hex stops
- `schedule_pulse(widget, pill, from, to)` uses `widget.after(40)` (~400 ms total); no threads
- Supervisor `pill_intent_queue` notifies GUI on pill transitions

## Paused visual cue

- Pill: amber (`PILL_CONNECTING` / `#f59e0b`)
- Subtitle row: `[Paused] — Tap Resume to start.` (ASCII-only prefix for cp1252 safety)
- Border dims via `fg_color` on root + inner tile; resets on resume

## Subtitle hint priority

`resolve_subtitle_hint(state, diagnostic_hint, probe_hint)`:

1. Paused → `Tap Resume to start.` (shown on subtitle row; hint row cleared)
2. Crash-loop / `RESET_NEEDED` → `Tap Restart to try again`
3. Diagnostic persistent (e.g. `Open SAP to connect`)
4. Probe state (`state.subtitle_hint`, then `probe_hint` like `Connecting…`)

`format_health_subtitle` unchanged for healthy user/system/transaction triplet.

## Tests

```bash
python3 -m pytest omni_agent/connect/tests/ omni_agent/master/tests/ -q
```

268 passed, 1 skipped (Windows-only creationflags on macOS).

## Deferred (H.4)

- PyInstaller `OmniFrame_Connect.exe`, self-update install, `build_exe.bat` third EXE
- `update_available` modal stub untouched

## Related

- [[Implement-Phase-H1-Connect-MVP]]
- [[Implement-Phase-H2-Self-Diagnostic-Friendly-Errors-Reset]]
- [[Implement-Phase-B-Master-GUI-Skeleton]] — master `after()` + queue marshalling pattern
