# Created and developed by Jai Singh
"""
FastAPI router for CubiScan dimensional scanning integration.
Bridge endpoints use API-key auth. Operator endpoints use JWT auth.
"""

import logging
import os
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query, Header, status

logger = logging.getLogger(__name__)

try:
    from ..models.cubiscan_models import (
        CubiScanHeartbeat,
        CubiScanMeasurementIngest,
        CubiScanBridgeError,
        CubiScanDeviceStateChange,
        CubiScanReconciliationRequest,
        CubiScanAPIResponse,
        CubiScanPaginatedResponse,
        CubiScanStatistics,
        CubiScanMeasurementResponse,
    )
    from ..services.cubiscan_ingest_service import get_cubiscan_ingest_service, CubiScanIngestService
    from ..services.cubiscan_reconciliation_service import (
        get_cubiscan_reconciliation_service,
        CubiScanReconciliationService,
    )
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
except ImportError:
    from models.cubiscan_models import (
        CubiScanHeartbeat,
        CubiScanMeasurementIngest,
        CubiScanBridgeError,
        CubiScanDeviceStateChange,
        CubiScanReconciliationRequest,
        CubiScanAPIResponse,
        CubiScanPaginatedResponse,
        CubiScanStatistics,
        CubiScanMeasurementResponse,
    )
    from services.cubiscan_ingest_service import get_cubiscan_ingest_service, CubiScanIngestService
    from services.cubiscan_reconciliation_service import (
        get_cubiscan_reconciliation_service,
        CubiScanReconciliationService,
    )
    from auth.supabase_auth import get_current_user, AuthenticatedUser

router = APIRouter(
    prefix="/cubiscan",
    tags=["CubiScan"],
    responses={404: {"description": "Not found"}},
)

CUBISCAN_API_KEY = os.environ.get("CUBISCAN_API_KEY", "")


# ==================== Auth Dependencies ====================

async def get_cubiscan_api_key(
    x_cubiscan_api_key: str = Header(..., alias="X-CubiScan-API-Key"),
) -> str:
    """Validate the bridge API key."""
    if not CUBISCAN_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CubiScan API key not configured on server",
        )
    if x_cubiscan_api_key != CUBISCAN_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid CubiScan API key",
        )
    return x_cubiscan_api_key


# ==================== Health ====================

@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "cubiscan"}


# ==================== Bridge Endpoints (API-key auth) ====================

@router.post("/bridge/heartbeat", response_model=CubiScanAPIResponse)
async def bridge_heartbeat(
    heartbeat: CubiScanHeartbeat,
    _api_key: str = Depends(get_cubiscan_api_key),
    svc: CubiScanIngestService = Depends(get_cubiscan_ingest_service),
):
    result = await svc.process_heartbeat(heartbeat)
    return CubiScanAPIResponse(success=result["success"], data=result.get("device"))


@router.post("/bridge/measurement", response_model=CubiScanAPIResponse)
async def bridge_measurement(
    payload: CubiScanMeasurementIngest,
    _api_key: str = Depends(get_cubiscan_api_key),
    svc: CubiScanIngestService = Depends(get_cubiscan_ingest_service),
):
    result = await svc.ingest_measurement(payload)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error"))
    return CubiScanAPIResponse(success=True, data=result)


@router.post("/bridge/error", response_model=CubiScanAPIResponse)
async def bridge_error(
    error: CubiScanBridgeError,
    _api_key: str = Depends(get_cubiscan_api_key),
    svc: CubiScanIngestService = Depends(get_cubiscan_ingest_service),
):
    result = await svc.log_bridge_error(error)
    return CubiScanAPIResponse(success=True)


@router.post("/bridge/state-change", response_model=CubiScanAPIResponse)
async def bridge_state_change(
    change: CubiScanDeviceStateChange,
    _api_key: str = Depends(get_cubiscan_api_key),
    svc: CubiScanIngestService = Depends(get_cubiscan_ingest_service),
):
    result = await svc.update_device_state(change)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error"))
    return CubiScanAPIResponse(success=True)


# ==================== Operator Endpoints (JWT auth) ====================

@router.get("/measurements", response_model=CubiScanPaginatedResponse)
async def list_measurements(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: Optional[str] = Query(None),
    measurement_status: Optional[str] = Query(None),
    reconciliation_status: Optional[str] = Query(None),
    device_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    user: AuthenticatedUser = Depends(get_current_user),
    svc: CubiScanIngestService = Depends(get_cubiscan_ingest_service),
):
    if not user.organization_id:
        raise HTTPException(status_code=403, detail="No organization")

    result = await svc.search_measurements(
        organization_id=user.organization_id,
        page=page,
        page_size=page_size,
        search=search,
        measurement_status=measurement_status,
        reconciliation_status=reconciliation_status,
        device_id=device_id,
        date_from=date_from,
        date_to=date_to,
    )
    return CubiScanPaginatedResponse(success=True, **result)


@router.get("/measurements/{measurement_id}")
async def get_measurement(
    measurement_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    svc: CubiScanIngestService = Depends(get_cubiscan_ingest_service),
):
    if not user.organization_id:
        raise HTTPException(status_code=403, detail="No organization")
    data = await svc.get_measurement(measurement_id, user.organization_id)
    if not data:
        raise HTTPException(status_code=404, detail="Measurement not found")
    return CubiScanAPIResponse(success=True, data=data)


@router.get("/statistics", response_model=CubiScanStatistics)
async def get_statistics(
    user: AuthenticatedUser = Depends(get_current_user),
    svc: CubiScanIngestService = Depends(get_cubiscan_ingest_service),
):
    if not user.organization_id:
        raise HTTPException(status_code=403, detail="No organization")
    return await svc.get_statistics(user.organization_id)


@router.get("/devices")
async def list_devices(
    user: AuthenticatedUser = Depends(get_current_user),
    svc: CubiScanIngestService = Depends(get_cubiscan_ingest_service),
):
    if not user.organization_id:
        raise HTTPException(status_code=403, detail="No organization")
    devices = await svc.list_devices(user.organization_id)
    return CubiScanAPIResponse(success=True, data=devices)


@router.get("/export")
async def export_measurements(
    measurement_status: Optional[str] = Query(None),
    reconciliation_status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    user: AuthenticatedUser = Depends(get_current_user),
    svc: CubiScanIngestService = Depends(get_cubiscan_ingest_service),
):
    if not user.organization_id:
        raise HTTPException(status_code=403, detail="No organization")
    data = await svc.export_measurements(
        organization_id=user.organization_id,
        measurement_status=measurement_status,
        reconciliation_status=reconciliation_status,
        date_from=date_from,
        date_to=date_to,
    )
    return CubiScanAPIResponse(success=True, data=data)


# ==================== Reconciliation ====================

@router.post("/measurements/{measurement_id}/reconcile", response_model=CubiScanAPIResponse)
async def reconcile_measurement(
    measurement_id: str,
    request: CubiScanReconciliationRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    svc: CubiScanReconciliationService = Depends(get_cubiscan_reconciliation_service),
):
    if not user.organization_id:
        raise HTTPException(status_code=403, detail="No organization")

    result = await svc.perform_action(
        measurement_id=measurement_id,
        organization_id=user.organization_id,
        actor_id=user.id,
        actor_name=user.full_name,
        action_type=request.action_type,
        reason=request.reason,
        target_table=request.target_table,
        target_id=request.target_id,
        payload=request.payload,
    )
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result.get("error"))
    return CubiScanAPIResponse(success=True, data=result)


@router.get("/measurements/{measurement_id}/actions")
async def get_measurement_actions(
    measurement_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    svc: CubiScanReconciliationService = Depends(get_cubiscan_reconciliation_service),
):
    actions = await svc.get_actions_for_measurement(measurement_id)
    return CubiScanAPIResponse(success=True, data=actions)

# Created and developed by Jai Singh
