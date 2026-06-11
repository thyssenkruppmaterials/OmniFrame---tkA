# Created and developed by Jai Singh
"""
Frontend static file serving for the OneBox AI SPA.

Configures routes to serve the React SPA (index.html) and its associated
static assets, PWA files, and images with appropriate cache headers.

Must be called AFTER all API routers so the catch-all does not shadow /api/...
"""

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}

SHORT_CACHE_HEADERS = {
    "Cache-Control": "public, no-cache, must-revalidate",
}


def configure_frontend_routes(app: FastAPI, dist_dir: Path) -> None:
    """Mount all SPA-related routes on *app* using *dist_dir* as the build root."""

    assets_dir = dist_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="static")
        logger.info("Frontend: /assets mounted (immutable hashed files)")

    # ---- Build info (version checker needs fresh data every time) ----

    @app.get("/build-info.json")
    async def get_build_info():
        build_info_path = dist_dir / "build-info.json"
        if build_info_path.exists():
            return FileResponse(
                str(build_info_path),
                media_type="application/json",
                headers=NO_CACHE_HEADERS,
            )
        return JSONResponse(status_code=404, content={"error": "build-info.json not found"})

    # ---- PWA manifests ----

    @app.get("/manifest.webmanifest")
    async def get_manifest():
        return FileResponse(str(dist_dir / "manifest.webmanifest"), headers=SHORT_CACHE_HEADERS)

    @app.get("/timeclock-manifest.webmanifest")
    async def get_timeclock_manifest():
        return FileResponse(
            str(dist_dir / "timeclock-manifest.webmanifest"),
            media_type="application/manifest+json",
            headers=SHORT_CACHE_HEADERS,
        )

    # ---- Service worker files (must never be cached) ----

    @app.get("/registerSW.js")
    async def get_register_sw():
        return FileResponse(
            str(dist_dir / "registerSW.js"),
            media_type="application/javascript",
            headers=NO_CACHE_HEADERS,
        )

    @app.get("/sw.js")
    async def get_service_worker():
        return FileResponse(
            str(dist_dir / "sw.js"),
            media_type="application/javascript",
            headers=NO_CACHE_HEADERS,
        )

    @app.get("/workbox-{filename}")
    async def get_workbox_file(filename: str):
        workbox_files = list(dist_dir.glob("workbox-*.js"))
        if workbox_files:
            return FileResponse(str(workbox_files[0]))
        raise HTTPException(status_code=404, detail=f"Workbox file not found: workbox-{filename}")

    # ---- Static images (1-day cache) ----

    @app.get("/images/{filename:path}")
    async def get_images(filename: str):
        image_path = dist_dir / "images" / filename
        if image_path.exists():
            return FileResponse(
                str(image_path),
                headers={"Cache-Control": "public, max-age=86400"},
            )
        raise HTTPException(status_code=404, detail=f"Image not found: {filename}")

    # ---- SPA entry point ----

    @app.get("/")
    async def spa_root():
        """Serve the main SPA application."""
        return FileResponse(
            str(dist_dir / "index.html"),
            media_type="text/html",
            headers=NO_CACHE_HEADERS,
        )

    # ---- SPA catch-all (MUST be last route registered) ----

    @app.get("/{full_path:path}")
    async def spa_catch_all(full_path: str):
        """Return index.html for client-side routing; 404 for /api/* misses."""
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail=f"API endpoint not found: {full_path}")
        return FileResponse(
            str(dist_dir / "index.html"),
            media_type="text/html",
            headers=NO_CACHE_HEADERS,
        )

    logger.info("Frontend: SPA routes configured (root + catch-all)")

# Created and developed by Jai Singh
