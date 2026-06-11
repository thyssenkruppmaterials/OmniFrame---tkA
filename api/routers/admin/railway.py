# Created and developed by Jai Singh
"""Railway service-monitoring admin endpoints.

All endpoints require admin role authentication and proxy requests to
Railway's GraphQL API v2 so the Railway API token stays server-side.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ._helpers import (
    AuthenticatedUser,
    require_admin_role,
)

try:
    from ...config.settings import settings
    from ...lib.railway_client import RailwayClient, LogKind
except ImportError:
    try:
        from config.settings import settings
        from lib.railway_client import RailwayClient, LogKind
    except ImportError:
        from api.config.settings import settings
        from api.lib.railway_client import RailwayClient, LogKind

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/railway", tags=["admin", "railway-monitoring"])


def _get_client() -> RailwayClient:
    if not settings.railway_api_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Railway API token not configured. Set RAILWAY_API_TOKEN on the server.",
        )
    return RailwayClient(
        api_url=settings.railway_api_url,
        api_token=settings.railway_api_token,
        project_id=settings.railway_project_id,
        environment_name=settings.railway_environment_name,
    )


@router.get("/overview")
async def railway_overview(
    _admin: AuthenticatedUser = Depends(require_admin_role()),
):
    """Return project metadata, environment info, and per-service deployment status."""
    client = _get_client()
    try:
        overview = await client.get_project_overview()
        return {
            "projectId": overview.project_id,
            "projectName": overview.project_name,
            "environmentId": overview.environment_id,
            "environmentName": overview.environment_name,
            "services": [
                {
                    "id": s.service.id,
                    "name": s.service.name,
                    "icon": s.service.icon,
                    "latestDeployment": asdict(s.latest_deployment) if s.latest_deployment else None,
                    "region": s.region,
                    "numReplicas": s.num_replicas,
                }
                for s in overview.services
            ],
        }
    except Exception as exc:
        logger.error("Railway overview failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/runtime-logs")
async def railway_runtime_logs(
    service_id: Optional[str] = Query(None, alias="serviceId"),
    filter_text: Optional[str] = Query(None, alias="filter"),
    limit: int = Query(200, ge=1, le=2000),
    _admin: AuthenticatedUser = Depends(require_admin_role()),
):
    """Fetch environment-wide runtime logs, optionally filtered to a single service."""
    client = _get_client()
    try:
        logs = await client.get_environment_runtime_logs(
            service_id=service_id,
            filter_text=filter_text,
            limit=limit,
        )
        return {
            "logs": [asdict(entry) for entry in logs],
            "count": len(logs),
        }
    except Exception as exc:
        logger.error("Railway runtime-logs failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/deployments")
async def railway_deployments(
    service_id: str = Query(..., alias="serviceId"),
    limit: int = Query(10, ge=1, le=50),
    _admin: AuthenticatedUser = Depends(require_admin_role()),
):
    """List recent deployments for a service."""
    client = _get_client()
    try:
        deps = await client.get_service_deployments(
            service_id, limit=limit
        )
        return {"deployments": deps, "count": len(deps)}
    except Exception as exc:
        logger.error("Railway deployments failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/deployment-logs")
async def railway_deployment_logs(
    deployment_id: str = Query(..., alias="deploymentId"),
    kind: LogKind = Query("runtime"),
    limit: int = Query(500, ge=1, le=5000),
    _admin: AuthenticatedUser = Depends(require_admin_role()),
):
    """Fetch logs for a specific deployment."""
    client = _get_client()
    try:
        logs = await client.get_deployment_logs(
            deployment_id,
            kind=kind,
            limit=limit,
        )
        return {
            "logs": [asdict(entry) for entry in logs],
            "count": len(logs),
            "kind": kind,
        }
    except Exception as exc:
        logger.error("Railway deployment-logs failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))

# Created and developed by Jai Singh
