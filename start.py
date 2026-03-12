#!/usr/bin/env python3
"""
OmniFrame Logistics — Thin process runner.

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

# Import the canonical app — triggers all middleware / router registration
from api.main import app  # noqa: E402

import uvicorn  # noqa: E402


def main() -> None:
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")

    behind_proxy = bool(
        os.environ.get("RAILWAY_PUBLIC_DOMAIN")
        or os.environ.get("RENDER_EXTERNAL_HOSTNAME")
    )

    serving_frontend = os.environ.get("SERVE_FRONTEND", "false").lower() == "true"

    print("=" * 60)
    print("  OmniFrame Logistics — Unified Platform")
    print("=" * 60)
    print(f"  Host:           {host}")
    print(f"  Port:           {port}")
    print(f"  Proxy headers:  {behind_proxy}")
    print(f"  Frontend:       {'active' if serving_frontend else 'not serving'}")
    print(f"  Health check:   http://{host}:{port}/health")
    print(f"  API info:       http://{host}:{port}/api/info")
    print("=" * 60)

    uvicorn.run(
        app,
        host=host,
        port=port,
        proxy_headers=behind_proxy,
        forwarded_allow_ips="*" if behind_proxy else None,
    )


if __name__ == "__main__":
    main()
# Developer and Creator: Jai Singh
