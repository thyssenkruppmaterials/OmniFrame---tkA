# Created and developed by Jai Singh
"""
CubiScan Ingest Service.
Handles bridge heartbeats, measurement ingestion, device state, and search.
Uses service-role Supabase client for bridge-facing writes.
"""

import hashlib
import json
import logging
import math
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

try:
    from ..models.cubiscan_models import (
        CubiScanHeartbeat,
        CubiScanMeasurementIngest,
        CubiScanBridgeError,
        CubiScanDeviceStateChange,
        CubiScanStatistics,
        MeasurementStatus,
        ReconciliationStatus,
    )
    from ..config.settings import settings
except ImportError:
    from models.cubiscan_models import (
        CubiScanHeartbeat,
        CubiScanMeasurementIngest,
        CubiScanBridgeError,
        CubiScanDeviceStateChange,
        CubiScanStatistics,
        MeasurementStatus,
        ReconciliationStatus,
    )
    from config.settings import settings


def _get_admin_client():
    """Get service-role Supabase client for bridge writes."""
    from supabase import create_client
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase URL or service role key not configured")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


class CubiScanIngestService:
    """Handles all CubiScan device and measurement operations."""

    def __init__(self):
        self._admin = None

    @property
    def admin(self):
        if self._admin is None:
            self._admin = _get_admin_client()
        return self._admin

    # ------------------------------------------------------------------
    # Heartbeat
    # ------------------------------------------------------------------

    async def process_heartbeat(self, heartbeat: CubiScanHeartbeat) -> Dict[str, Any]:
        """Upsert device record and update session from a bridge heartbeat."""
        now = datetime.now(timezone.utc).isoformat()

        device_data = {
            "organization_id": heartbeat.organization_id,
            "device_id": heartbeat.device_id,
            "device_name": heartbeat.device_name,
            "model": heartbeat.model,
            "firmware_version": heartbeat.firmware_version,
            "connection_method": heartbeat.connection_method.value,
            "endpoint_config": heartbeat.endpoint_config,
            "last_heartbeat_at": now,
            "connection_state": "online",
            "station_id": heartbeat.station_id,
            "is_active": True,
            "updated_at": now,
        }

        result = self.admin.table("cubiscan_devices").upsert(
            device_data,
            on_conflict="organization_id,device_id",
        ).execute()

        device_row = result.data[0] if result.data else None

        self._log_ingest_event(
            organization_id=heartbeat.organization_id,
            device_db_id=device_row["id"] if device_row else None,
            event_type="heartbeat",
            raw_payload=heartbeat.model_dump(mode="json"),
        )

        return {"success": True, "device": device_row}

    # ------------------------------------------------------------------
    # Measurement ingest
    # ------------------------------------------------------------------

    async def ingest_measurement(self, payload: CubiScanMeasurementIngest) -> Dict[str, Any]:
        """
        Process a raw measurement from the bridge.
        Writes an ingest event, then a normalized measurement row.
        Idempotent on idempotency_key.
        """
        existing = self.admin.table("cubiscan_ingest_events").select("id").eq(
            "idempotency_key", payload.idempotency_key
        ).maybe_single().execute()

        if existing and existing.data:
            logger.info("Duplicate ingest_event for key=%s, skipping", payload.idempotency_key)
            return {"success": True, "duplicate": True, "ingest_event_id": existing.data["id"]}

        device_result = self.admin.table("cubiscan_devices").select("id").eq(
            "organization_id", payload.organization_id
        ).eq("device_id", payload.device_id).maybe_single().execute()

        if not device_result or not device_result.data:
            return {"success": False, "error": f"Unknown device {payload.device_id}"}

        device_db_id = device_result.data["id"]
        payload_json = payload.model_dump(mode="json")
        payload_hash = hashlib.sha256(json.dumps(payload_json, sort_keys=True).encode()).hexdigest()

        event_data = {
            "organization_id": payload.organization_id,
            "device_id": device_db_id,
            "event_type": "measurement_received",
            "raw_payload": payload_json,
            "parsed_payload": payload_json,
            "payload_hash": payload_hash,
            "idempotency_key": payload.idempotency_key,
        }
        event_result = self.admin.table("cubiscan_ingest_events").insert(event_data).execute()
        event_row = event_result.data[0] if event_result.data else None

        active_session = self.admin.table("cubiscan_device_sessions").select("id").eq(
            "device_id", device_db_id
        ).eq("status", "active").order("started_at", desc=True).limit(1).maybe_single().execute()

        session_id = active_session.data["id"] if active_session and active_session.data else None

        measurement_data = {
            "organization_id": payload.organization_id,
            "device_id": device_db_id,
            "session_id": session_id,
            "ingest_event_id": event_row["id"] if event_row else None,
            "measured_at": payload.measured_at.isoformat(),
            "barcode_raw": payload.barcode_raw,
            "barcode_normalized": payload.barcode_raw.strip().upper(),
            "material_number": payload.material_number,
            "reference_type": payload.reference_type,
            "reference_id": payload.reference_id,
            "length": float(payload.length),
            "width": float(payload.width),
            "height": float(payload.height),
            "weight": float(payload.weight),
            "dimension_unit": payload.dimension_unit.value,
            "weight_unit": payload.weight_unit.value,
            "dim_factor": 5000,
            "stability_score": float(payload.stability_score),
            "measurement_status": MeasurementStatus.RECEIVED.value,
            "reconciliation_status": ReconciliationStatus.PENDING.value,
            "operator_id": payload.operator_id,
        }
        meas_result = self.admin.table("cubiscan_measurements").insert(measurement_data).execute()
        meas_row = meas_result.data[0] if meas_result.data else None

        if session_id:
            self.admin.rpc("", {}).execute()  # placeholder — increment via direct SQL below
            self.admin.table("cubiscan_device_sessions").update({
                "measurements_count": (active_session.data.get("measurements_count", 0) or 0) + 1,
                "last_heartbeat_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", session_id).execute()

        return {
            "success": True,
            "duplicate": False,
            "measurement_id": meas_row["id"] if meas_row else None,
            "ingest_event_id": event_row["id"] if event_row else None,
        }

    # ------------------------------------------------------------------
    # Bridge errors
    # ------------------------------------------------------------------

    async def log_bridge_error(self, error: CubiScanBridgeError) -> Dict[str, Any]:
        device_result = self.admin.table("cubiscan_devices").select("id").eq(
            "organization_id", error.organization_id
        ).eq("device_id", error.device_id).maybe_single().execute()

        device_db_id = device_result.data["id"] if device_result and device_result.data else None

        if device_db_id:
            self._log_ingest_event(
                organization_id=error.organization_id,
                device_db_id=device_db_id,
                event_type="bridge_error",
                raw_payload=error.model_dump(mode="json"),
                error_code=error.error_code,
                error_message=error.error_message,
            )
            self.admin.table("cubiscan_devices").update({
                "connection_state": "error",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", device_db_id).execute()

        return {"success": True}

    # ------------------------------------------------------------------
    # Device state change
    # ------------------------------------------------------------------

    async def update_device_state(self, change: CubiScanDeviceStateChange) -> Dict[str, Any]:
        device_result = self.admin.table("cubiscan_devices").select("id").eq(
            "organization_id", change.organization_id
        ).eq("device_id", change.device_id).maybe_single().execute()

        if not device_result or not device_result.data:
            return {"success": False, "error": f"Unknown device {change.device_id}"}

        device_db_id = device_result.data["id"]

        self.admin.table("cubiscan_devices").update({
            "connection_state": change.new_state.value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", device_db_id).execute()

        self._log_ingest_event(
            organization_id=change.organization_id,
            device_db_id=device_db_id,
            event_type="device_state_changed",
            raw_payload=change.model_dump(mode="json"),
        )

        return {"success": True}

    # ------------------------------------------------------------------
    # Search (server-side pagination)
    # ------------------------------------------------------------------

    async def search_measurements(
        self,
        organization_id: str,
        page: int = 1,
        page_size: int = 25,
        search: Optional[str] = None,
        measurement_status: Optional[str] = None,
        reconciliation_status: Optional[str] = None,
        device_id: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> Dict[str, Any]:
        query = self.admin.table("cubiscan_measurements").select(
            "*, operator:user_profiles!cubiscan_measurements_operator_id_fkey(full_name, email)",
            count="exact",
        ).eq("organization_id", organization_id)

        if search:
            query = query.or_(
                f"barcode_raw.ilike.%{search}%,"
                f"barcode_normalized.ilike.%{search}%,"
                f"material_number.ilike.%{search}%,"
                f"material_description.ilike.%{search}%"
            )

        if measurement_status:
            query = query.eq("measurement_status", measurement_status)
        if reconciliation_status:
            query = query.eq("reconciliation_status", reconciliation_status)
        if device_id:
            query = query.eq("device_id", device_id)
        if date_from:
            query = query.gte("measured_at", date_from)
        if date_to:
            query = query.lte("measured_at", date_to)

        offset = (page - 1) * page_size
        query = query.order("measured_at", desc=True).range(offset, offset + page_size - 1)

        result = query.execute()
        total = result.count or 0

        return {
            "data": result.data or [],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": math.ceil(total / page_size) if page_size > 0 else 0,
        }

    # ------------------------------------------------------------------
    # Measurement detail
    # ------------------------------------------------------------------

    async def get_measurement(self, measurement_id: str, organization_id: str) -> Optional[Dict[str, Any]]:
        result = self.admin.table("cubiscan_measurements").select(
            "*, operator:user_profiles!cubiscan_measurements_operator_id_fkey(full_name, email)"
        ).eq("id", measurement_id).eq("organization_id", organization_id).maybe_single().execute()
        return result.data if result else None

    # ------------------------------------------------------------------
    # Statistics
    # ------------------------------------------------------------------

    async def get_statistics(self, organization_id: str) -> CubiScanStatistics:
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        fifteen_min_ago = (now - timedelta(minutes=15)).isoformat()
        stale_threshold = (now - timedelta(minutes=5)).isoformat()

        total_result = self.admin.table("cubiscan_measurements").select(
            "*", count="exact"
        ).eq("organization_id", organization_id).execute()
        total = total_result.count or 0

        today_result = self.admin.table("cubiscan_measurements").select(
            "*", count="exact"
        ).eq("organization_id", organization_id).gte("measured_at", today_start).execute()
        today = today_result.count or 0

        recent_result = self.admin.table("cubiscan_measurements").select(
            "*", count="exact"
        ).eq("organization_id", organization_id).gte("measured_at", fifteen_min_ago).execute()
        recent = recent_result.count or 0

        live_result = self.admin.table("cubiscan_devices").select(
            "*", count="exact"
        ).eq("organization_id", organization_id).eq("connection_state", "online").execute()
        live = live_result.count or 0

        review_result = self.admin.table("cubiscan_measurements").select(
            "*", count="exact"
        ).eq("organization_id", organization_id).in_(
            "reconciliation_status", ["pending", "quarantined"]
        ).execute()
        needs_review = review_result.count or 0

        failed_result = self.admin.table("cubiscan_ingest_events").select(
            "*", count="exact"
        ).eq("organization_id", organization_id).eq("event_type", "bridge_error").gte(
            "created_at", today_start
        ).execute()
        failed = failed_result.count or 0

        stale_result = self.admin.table("cubiscan_devices").select(
            "*", count="exact"
        ).eq("organization_id", organization_id).eq("is_active", True).lt(
            "last_heartbeat_at", stale_threshold
        ).execute()
        stale = stale_result.count or 0

        return CubiScanStatistics(
            total_measurements=total,
            today_measurements=today,
            live_devices=live,
            needs_review=needs_review,
            failed_ingests=failed,
            stale_devices=stale,
            scans_last_15_min=recent,
        )

    # ------------------------------------------------------------------
    # Devices listing
    # ------------------------------------------------------------------

    async def list_devices(self, organization_id: str) -> List[Dict[str, Any]]:
        result = self.admin.table("cubiscan_devices").select("*").eq(
            "organization_id", organization_id
        ).eq("is_active", True).order("device_name").execute()
        return result.data or []

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------

    async def export_measurements(
        self,
        organization_id: str,
        measurement_status: Optional[str] = None,
        reconciliation_status: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        query = self.admin.table("cubiscan_measurements").select("*").eq(
            "organization_id", organization_id
        )
        if measurement_status:
            query = query.eq("measurement_status", measurement_status)
        if reconciliation_status:
            query = query.eq("reconciliation_status", reconciliation_status)
        if date_from:
            query = query.gte("measured_at", date_from)
        if date_to:
            query = query.lte("measured_at", date_to)

        query = query.order("measured_at", desc=True).limit(10000)
        result = query.execute()
        return result.data or []

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _log_ingest_event(
        self,
        organization_id: str,
        device_db_id: Optional[str],
        event_type: str,
        raw_payload: Dict[str, Any],
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
    ):
        if not device_db_id:
            return
        data = {
            "organization_id": organization_id,
            "device_id": device_db_id,
            "event_type": event_type,
            "raw_payload": raw_payload,
            "error_code": error_code,
            "error_message": error_message,
        }
        try:
            self.admin.table("cubiscan_ingest_events").insert(data).execute()
        except Exception as exc:
            logger.error("Failed to log CubiScan ingest event: %s", exc)


_instance: Optional[CubiScanIngestService] = None


def get_cubiscan_ingest_service() -> CubiScanIngestService:
    global _instance
    if _instance is None:
        _instance = CubiScanIngestService()
    return _instance

# Created and developed by Jai Singh
