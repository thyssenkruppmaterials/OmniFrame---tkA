# Created and developed by Jai Singh
"""Status pill pulse animation helpers."""

from __future__ import annotations

from typing import Callable, Optional


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    if len(value) != 6:
        raise ValueError(f"invalid hex color: {hex_color}")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def _rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


def pulse_color_steps(from_hex: str, to_hex: str, steps: int = 10) -> list[str]:
    """Interpolate RGB and return intermediate hex color strings."""
    if steps < 1:
        return []
    fr, fg, fb = _hex_to_rgb(from_hex)
    tr, tg, tb = _hex_to_rgb(to_hex)
    out: list[str] = []
    for i in range(1, steps + 1):
        t = i / steps
        r = round(fr + (tr - fr) * t)
        g = round(fg + (tg - fg) * t)
        b = round(fb + (tb - fb) * t)
        out.append(_rgb_to_hex(r, g, b))
    return out


def schedule_pulse(
    widget,
    pill_widget,
    from_hex: str,
    to_hex: str,
    *,
    steps: int = 10,
    step_ms: int = 40,
    on_complete: Optional[Callable[[], None]] = None,
) -> None:
    """Run a Tk ``after``-driven pulse on ``pill_widget`` (no threads)."""
    colors = pulse_color_steps(from_hex, to_hex, steps=steps)
    if not colors:
        if on_complete:
            on_complete()
        return

    state = {"index": 0, "after_id": None}

    def _step() -> None:
        idx = state["index"]
        if idx >= len(colors):
            pill_widget.configure(text_color=to_hex)
            if on_complete:
                on_complete()
            return
        pill_widget.configure(text_color=colors[idx])
        state["index"] = idx + 1
        state["after_id"] = widget.after(step_ms, _step)

    _step()

# Created and developed by Jai Singh
