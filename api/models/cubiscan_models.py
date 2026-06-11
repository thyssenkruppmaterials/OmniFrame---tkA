# Created and developed by Jai Singh
"""
Pydantic models for CubiScan dimensional scanning integration.
Supports local bridge ingest, operator search, and reconciliation workflows.
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum


# ==================== Enums ====================

class DeviceConnectionState(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    MEASURING = "measuring"
    ERROR = "error"
    CALIBRATING = "calibrating"
    STALE = "stale"


class ConnectionMethod(str, Enum):
    SERIAL = "serial"
    USB = "usb"
    TCP = "tcp"
    ETHERNET = "ethernet"


class SessionStatus(str, Enum):
    ACTIVE = "active"
    STALE = "stale"
    ENDED = "ended"


class MeasurementStatus(str, Enum):
    RECEIVED = "received"
    PARSED = "parsed"
    PARSE_FAILED = "parse_failed"
    VALIDATED = "validated"
    MISMATCH = "mismatch"
    SUPERSEDED = "superseded"


class ReconciliationStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    APPLIED = "applied"
    REJECTED = "rejected"
    QUARANTINED = "quarantined"
    OVERRIDDEN = "overridden"


class ReconciliationActionType(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    APPLY = "apply"
    QUARANTINE = "quarantine"
    OVERRIDE = "override"
    REPROCESS = "reprocess"


class DimensionUnit(str, Enum):
    CM = "cm"
    IN = "in"


class WeightUnit(str, Enum):
    KG = "kg"
    LB = "lb"


# ==================== Bridge Ingest Models ====================

class CubiScanHeartbeat(BaseModel):
    """Heartbeat payload from local bridge service."""
    device_id: str = Field(..., description="Unique device identifier from the bridge")
    device_name: str = Field(..., description="Human-readable device name")
    model: str = Field(..., description="CubiScan model (e.g. CubiScan 125)")
    firmware_version: str = Field(..., description="Device firmware version")
    connection_method: ConnectionMethod
    endpoint_config: str = Field(..., description="Connection endpoint (e.g. COM3:9600, 192.168.1.50:1025)")
    station_id: Optional[str] = None
    operator_id: Optional[str] = None
    organization_id: str
    timestamp: datetime


class CubiScanMeasurementIngest(BaseModel):
    """Raw measurement payload from local bridge service."""
    device_id: str
    organization_id: str
    idempotency_key: str = Field(..., description="Bridge-generated dedup key")
    measured_at: datetime
    barcode_raw: str
    length: Decimal = Field(..., gt=0)
    width: Decimal = Field(..., gt=0)
    height: Decimal = Field(..., gt=0)
    weight: Decimal = Field(..., gt=0)
    dimension_unit: DimensionUnit = DimensionUnit.CM
    weight_unit: WeightUnit = WeightUnit.KG
    stability_score: Decimal = Field(..., ge=0, le=1, description="Measurement stability (1.0 = rock-solid)")
    raw_payload: Dict[str, Any] = Field(default_factory=dict)
    parser_version: str = Field(default="1.0.0")
    material_number: Optional[str] = None
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None
    operator_id: Optional[str] = None
    station_id: Optional[str] = None


class CubiScanBridgeError(BaseModel):
    """Error event from the bridge."""
    device_id: str
    organization_id: str
    error_code: str
    error_message: str
    raw_payload: Optional[Dict[str, Any]] = None
    timestamp: datetime


class CubiScanDeviceStateChange(BaseModel):
    """Device state transition from the bridge."""
    device_id: str
    organization_id: str
    previous_state: DeviceConnectionState
    new_state: DeviceConnectionState
    reason: Optional[str] = None
    timestamp: datetime


# ==================== Device Models ====================

class CubiScanDeviceResponse(BaseModel):
    """Device record API response."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    device_id: str
    device_name: str
    model: str
    firmware_version: str
    connection_method: str
    endpoint_config: str
    calibration_metadata: Optional[Dict[str, Any]] = None
    health_score: Optional[Decimal] = None
    last_heartbeat_at: Optional[datetime] = None
    connection_state: str
    station_id: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ==================== Measurement Models ====================

class CubiScanMeasurementResponse(BaseModel):
    """Measurement record API response."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    device_id: str
    session_id: Optional[str] = None
    measured_at: datetime
    barcode_raw: str
    barcode_normalized: Optional[str] = None
    material_number: Optional[str] = None
    material_description: Optional[str] = None
    reference_type: Optional[str] = None
    reference_id: Optional[str] = None
    length: Decimal
    width: Decimal
    height: Decimal
    weight: Decimal
    dimensional_weight: Optional[Decimal] = None
    volume: Optional[Decimal] = None
    dimension_unit: str
    weight_unit: str
    dim_factor: Decimal
    stability_score: Optional[Decimal] = None
    measurement_status: str
    reconciliation_status: str
    superseded_by_measurement_id: Optional[str] = None
    operator_id: Optional[str] = None
    operator_name: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CubiScanMeasurementFilter(BaseModel):
    """Filter params for measurement search."""
    search: Optional[str] = None
    measurement_status: Optional[MeasurementStatus] = None
    reconciliation_status: Optional[ReconciliationStatus] = None
    device_id: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None


# ==================== Reconciliation Models ====================

class CubiScanReconciliationRequest(BaseModel):
    """Request to perform a reconciliation action on a measurement."""
    action_type: ReconciliationActionType
    reason: Optional[str] = Field(None, max_length=500)
    target_table: Optional[str] = None
    target_id: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None


class CubiScanReconciliationActionResponse(BaseModel):
    """Reconciliation action API response."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    measurement_id: str
    action_type: str
    previous_status: str
    new_status: str
    target_table: Optional[str] = None
    target_id: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    actor_id: str
    actor_name: Optional[str] = None
    reason: Optional[str] = None
    created_at: datetime


# ==================== Statistics & Pagination ====================

class CubiScanStatistics(BaseModel):
    """Aggregated statistics for the CubiScan dashboard."""
    total_measurements: int = 0
    today_measurements: int = 0
    live_devices: int = 0
    needs_review: int = 0
    failed_ingests: int = 0
    stale_devices: int = 0
    avg_length: Optional[float] = None
    avg_width: Optional[float] = None
    avg_height: Optional[float] = None
    avg_weight: Optional[float] = None
    scans_last_15_min: int = 0


class CubiScanPaginatedResponse(BaseModel):
    """Paginated measurement list."""
    success: bool
    data: List[CubiScanMeasurementResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class CubiScanAPIResponse(BaseModel):
    """Standard CubiScan API response."""
    success: bool
    message: Optional[str] = None
    data: Optional[Any] = None
    error: Optional[str] = None

# Created and developed by Jai Singh
