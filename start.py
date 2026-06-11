#!/usr/bin/env python3
# Created and developed by Jai Singh
"""
OneBox AI Logistics — Thin process runner.

Sets environment flags and launches uvicorn with the canonical FastAPI app
defined in api/main.py.  All middleware, routers, and frontend-serving logic
live in the api package; this file does NOT create a second app.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent

# Allow absolute imports used inside the api package
# (e.g. "from config.settings import ..." within api/main.py)
sys.path.insert(0, str(ROOT / "api"))

# If the built SPA exists, tell api/main.py to serve it.
dist_dir = ROOT / "dist"
if dist_dir.is_dir() and (dist_dir / "index.html").is_file():
    os.environ.setdefault("SERVE_FRONTEND", "true")

# Import the canonical app eagerly so import errors (missing env, syntax bugs,
# etc.) surface in the parent process with a clean traceback instead of being
# duplicated across uvicorn worker subprocesses. The `app` symbol itself is
# unused below — uvicorn imports `api.main:app` via the import-string form so
# the same call shape works for both single- and multi-worker modes.
from api.main import app  # noqa: E402,F401

import uvicorn  # noqa: E402


def main() -> None:
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")

    behind_proxy = bool(
        os.environ.get("RAILWAY_PUBLIC_DOMAIN")
        or os.environ.get("RENDER_EXTERNAL_HOSTNAME")
    )

    serving_frontend = os.environ.get("SERVE_FRONTEND", "false").lower() == "true"

    # Multi-worker uvicorn — default 1 (preserves prior single-worker behavior).
    # Each worker is a separate Python process with its own asyncpg / Redis /
    # httpx pools, so scale the per-worker pool sizes accordingly when raising
    # this. See ADR-Capacity-Ceiling-2k-Users for the per-worker DB-budget math.
    # uvicorn ignores `workers > 1` when `reload=True`; this runner has no
    # reload path (api/scripts/start_dev.py is the dev entry point).
    workers = int(os.environ.get("WEB_CONCURRENCY", "1"))

    print("=" * 60)
    print("  OneBox AI Logistics — Unified Platform")
    print("=" * 60)
    print(f"  Host:           {host}")
    print(f"  Port:           {port}")
    print(f"  Workers:        {workers}")
    print(f"  Proxy headers:  {behind_proxy}")
    print(f"  Frontend:       {'active' if serving_frontend else 'not serving'}")
    print(f"  Health check:   http://{host}:{port}/health")
    print(f"  API info:       http://{host}:{port}/api/info")
    print("=" * 60)

    # uvicorn requires an import string (not the app object) when workers > 1,
    # because each worker subprocess re-imports the app from a fresh interpreter.
    # When workers == 1, both forms work; we pass the import string uniformly so
    # the call shape matches between single- and multi-worker modes.
    uvicorn.run(
        "api.main:app",
        host=host,
        port=port,
        proxy_headers=behind_proxy,
        forwarded_allow_ips="*" if behind_proxy else None,
        workers=workers,
    )


if __name__ == "__main__":
    main()

# Created and developed by Jai Singh
