# Created and developed by Jai Singh
"""
CubiScan Reconciliation Service.
Handles approve, reject, apply, quarantine, override, and reprocess actions.
"""

import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

try:
    from ..models.cubiscan_models import (
        ReconciliationActionType,
        ReconciliationStatus,
    )
    from ..config.settings import settings
except ImportError:
    from models.cubiscan_models import (
        ReconciliationActionType,
        ReconciliationStatus,
    )
    from config.settings import settings


_ACTION_TO_STATUS = {
    ReconciliationActionType.APPROVE: ReconciliationStatus.APPROVED,
    ReconciliationActionType.REJECT: ReconciliationStatus.REJECTED,
    ReconciliationActionType.APPLY: ReconciliationStatus.APPLIED,
    ReconciliationActionType.QUARANTINE: ReconciliationStatus.QUARANTINED,
    ReconciliationActionType.OVERRIDE: ReconciliationStatus.OVERRIDDEN,
    ReconciliationActionType.REPROCESS: ReconciliationStatus.PENDING,
}


def _get_admin_client():
    from supabase import create_client
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase URL or service role key not configured")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


class CubiScanReconciliationService:

    def __init__(self):
        self._admin = None

    @property
    def admin(self):
        if self._admin is None:
            self._admin = _get_admin_client()
        return self._admin

    async def perform_action(
        self,
        measurement_id: str,
        organization_id: str,
        actor_id: str,
        actor_name: Optional[str],
        action_type: ReconciliationActionType,
        reason: Optional[str] = None,
        target_table: Optional[str] = None,
        target_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        meas = self.admin.table("cubiscan_measurements").select(
            "id, reconciliation_status, material_number, length, width, height, "
            "weight, dimension_unit, weight_unit, organization_id"
        ).eq("id", measurement_id).eq("organization_id", organization_id).maybe_single().execute()

        if not meas or not meas.data:
            return {"success": False, "error": "Measurement not found"}

        previous_status = meas.data["reconciliation_status"]
        new_status = _ACTION_TO_STATUS[action_type].value

        action_data = {
            "measurement_id": measurement_id,
            "action_type": action_type.value,
            "previous_status": previous_status,
            "new_status": new_status,
            "target_table": target_table,
            "target_id": target_id,
            "payload": payload,
            "actor_id": actor_id,
            "actor_name": actor_name,
            "reason": reason,
        }
        action_result = self.admin.table("cubiscan_reconciliation_actions").insert(action_data).execute()

        self.admin.table("cubiscan_measurements").update({
            "reconciliation_status": new_status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", measurement_id).execute()

        if action_type == ReconciliationActionType.APPLY:
            self._apply_to_downstream(meas.data, target_table, target_id)

        return {
            "success": True,
            "action": action_result.data[0] if action_result.data else None,
            "new_status": new_status,
        }

    def _apply_to_downstream(
        self,
        measurement: Dict[str, Any],
        target_table: Optional[str],
        target_id: Optional[str],
    ):
        """
        Push approved dimensions to a downstream table.
        Supports rr_mlgt_data (material master) and outbound_to_data (package dims).
        """
        material_number = measurement.get("material_number")
        org_id = measurement.get("organization_id")

        effective_table = target_table or "rr_mlgt_data"

        try:
            if effective_table == "rr_mlgt_data" and material_number:
                self.admin.table("rr_mlgt_data").update({
                    "length": measurement["length"],
                    "width": measurement["width"],
                    "height": measurement["height"],
                    "weight": measurement["weight"],
                }).eq("material_number", material_number).execute()
                logger.info(
                    "Applied CubiScan dimensions to rr_mlgt_data for material %s",
                    material_number,
                )

            elif effective_table == "outbound_to_data" and target_id:
                self.admin.table("outbound_to_data").update({
                    "package_length": measurement["length"],
                    "package_width": measurement["width"],
                    "package_height": measurement["height"],
                    "package_weight": measurement["weight"],
                }).eq("id", target_id).execute()
                logger.info(
                    "Applied CubiScan dimensions to outbound_to_data id=%s",
                    target_id,
                )

        except Exception as exc:
            logger.error("Failed to apply CubiScan downstream: %s", exc)

    async def get_actions_for_measurement(self, measurement_id: str) -> List[Dict[str, Any]]:
        result = self.admin.table("cubiscan_reconciliation_actions").select("*").eq(
            "measurement_id", measurement_id
        ).order("created_at", desc=False).execute()
        return result.data or []


_instance: Optional[CubiScanReconciliationService] = None


def get_cubiscan_reconciliation_service() -> CubiScanReconciliationService:
    global _instance
    if _instance is None:
        _instance = CubiScanReconciliationService()
    return _instance

# Created and developed by Jai Singh
