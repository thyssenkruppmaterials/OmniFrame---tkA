# Created and developed by Jai Singh
"""CustomTkinter colour tokens for OmniFrame Agent Master (Plan Section 4).

Phase D/C/E/F/G consume these constants — do not duplicate hex values elsewhere.
"""

from __future__ import annotations

# Window / chrome
BG_WINDOW = "#0f172a"  # slate-900
BG_TILE = "#1e293b"  # slate-800
BORDER_TILE = "#334155"  # slate-700
TEXT_PRIMARY = "#f8fafc"
TEXT_MUTED = "#94a3b8"

# Status pill backgrounds (exact plan palette)
PILL_CONNECTED = "#10b981"  # emerald-500
PILL_CONNECTING = "#f59e0b"  # amber-500
PILL_DEGRADED = "#f97316"  # orange-500
PILL_DISCONNECTED = "#e11d48"  # rose-600
PILL_STOPPED = "#475569"  # slate-600

PILL_TEXT_LIGHT = "#ffffff"
PILL_TEXT_DARK = "#1e293b"  # slate-800 on amber

# Actions
BTN_FIX = "#10b981"
BTN_SECONDARY = "#334155"

# Phase D — SAP GUI restart banner (hidden in Phase B)
BANNER_WARNING_BG = "#7c2d12"
BANNER_WARNING_FG = "#fef3c7"

AGENT_VERSION_DISPLAY = "2.1.0"
WINDOW_TITLE = f"OmniFrame Agent Master   v{AGENT_VERSION_DISPLAY}"
DEFAULT_WIDTH = 1280
DEFAULT_HEIGHT = 800
MIN_WIDTH = 960
MIN_HEIGHT = 600
GRID_COLUMNS = 3
TILE_MIN_HEIGHT = 350

# Created and developed by Jai Singh
