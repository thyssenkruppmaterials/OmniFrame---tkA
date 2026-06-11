# Created and developed by Jai Singh
"""
Drone Scanner Service for OneBox AI Logistics.
Handles drone scan uploads, AI analysis queuing, and search operations.
"""

import logging
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel

logger = logging.getLogger(__name__)

try:
    from ..utils.supabase_client import get_supabase_client
    from ..config.settings import settings
except ImportError:
    from utils.supabase_client import get_supabase_client
    from config.settings import settings


# ==================== Models ====================

class DroneScanCreate(BaseModel):
    """Model for creating a new drone scan."""
    image_url: str
    thumbnail_url: Optional[str] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    altitude_m: Optional[float] = None
    heading_degrees: Optional[float] = None
    warehouse_zone: Optional[str] = None
    aisle: Optional[str] = None
    shelf_position: Optional[str] = None
    rack_level: Optional[str] = None
    drone_id: Optional[str] = None
    mission_id: Optional[str] = None
    image_size_bytes: Optional[int] = None
    image_dimensions: Optional[str] = None


class DroneMissionCreate(BaseModel):
    """Model for creating a new drone mission."""
    mission_name: str
    mission_type: str = "inventory_scan"
    waypoints: Optional[List[Dict[str, Any]]] = None
    estimated_duration_minutes: Optional[int] = None
    coverage_zones: Optional[List[str]] = None
    drone_id: Optional[str] = None
    drone_model: Optional[str] = None


class DroneScanResponse(BaseModel):
    """Response model for drone scan."""
    id: str
    captured_at: str
    image_url: str
    thumbnail_url: Optional[str] = None
    warehouse_zone: Optional[str] = None
    aisle: Optional[str] = None
    shelf_position: Optional[str] = None
    ai_analysis_status: str
    detected_texts: Optional[List[Dict]] = None
    detected_barcodes: Optional[List[Dict]] = None
    inventory_assessment: Optional[Dict] = None
    spatial_description: Optional[str] = None
    raw_text: Optional[str] = None


class DroneMissionResponse(BaseModel):
    """Response model for drone mission."""
    id: str
    mission_name: str
    mission_type: str
    status: str
    total_scans: int
    successful_analyses: int
    failed_analyses: int
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class SearchResult(BaseModel):
    """Search result with rank."""
    id: str
    captured_at: str
    image_url: str
    thumbnail_url: Optional[str] = None
    warehouse_zone: Optional[str] = None
    aisle: Optional[str] = None
    raw_text: Optional[str] = None
    spatial_description: Optional[str] = None
    rank: float


# ==================== Service ====================

class DroneService:
    """Service for drone scan operations."""
    
    def __init__(self):
        self.supabase = None
    
    async def _get_client(self):
        """Get Supabase client lazily."""
        if self.supabase is None:
            self.supabase = await get_supabase_client()
        return self.supabase
    
    # ==================== Scans ====================
    
    async def create_scan(
        self, 
        scan_data: DroneScanCreate, 
        organization_id: str,
        user_id: str
    ) -> Dict[str, Any]:
        """Create a new drone scan record."""
        try:
            client = await self._get_client()
            
            data = {
                "image_url": scan_data.image_url,
                "thumbnail_url": scan_data.thumbnail_url,
                "gps_lat": scan_data.gps_lat,
                "gps_lng": scan_data.gps_lng,
                "altitude_m": scan_data.altitude_m,
                "heading_degrees": scan_data.heading_degrees,
                "warehouse_zone": scan_data.warehouse_zone,
                "aisle": scan_data.aisle,
                "shelf_position": scan_data.shelf_position,
                "rack_level": scan_data.rack_level,
                "drone_id": scan_data.drone_id,
                "mission_id": scan_data.mission_id,
                "image_size_bytes": scan_data.image_size_bytes,
                "image_dimensions": scan_data.image_dimensions,
                "organization_id": organization_id,
                "scanned_by": user_id,
                "captured_at": datetime.utcnow().isoformat(),
                "ai_analysis_status": "pending"
            }
            
            # Remove None values
            data = {k: v for k, v in data.items() if v is not None}
            
            result = client.table("drone_scans").insert(data).execute()
            
            if result.data:
                logger.info(f"Created drone scan: {result.data[0]['id']}")
                return {"success": True, "data": result.data[0]}
            else:
                return {"success": False, "error": "Failed to create scan"}
                
        except Exception as e:
            logger.error(f"Error creating drone scan: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def get_scan(self, scan_id: str, organization_id: str) -> Dict[str, Any]:
        """Get a single drone scan by ID."""
        try:
            client = await self._get_client()
            
            result = client.table("drone_scans")\
                .select("*")\
                .eq("id", scan_id)\
                .eq("organization_id", organization_id)\
                .single()\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data}
            else:
                return {"success": False, "error": "Scan not found"}
                
        except Exception as e:
            logger.error(f"Error getting drone scan: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def list_scans(
        self,
        organization_id: str,
        warehouse_zone: Optional[str] = None,
        aisle: Optional[str] = None,
        status: Optional[str] = None,
        mission_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """List drone scans with optional filters."""
        try:
            client = await self._get_client()
            
            query = client.table("drone_scans")\
                .select("*")\
                .eq("organization_id", organization_id)\
                .order("captured_at", desc=True)
            
            if warehouse_zone:
                query = query.eq("warehouse_zone", warehouse_zone)
            if aisle:
                query = query.eq("aisle", aisle)
            if status:
                query = query.eq("ai_analysis_status", status)
            if mission_id:
                query = query.eq("mission_id", mission_id)
            
            query = query.range(offset, offset + limit - 1)
            
            result = query.execute()
            
            return {
                "success": True, 
                "data": result.data,
                "count": len(result.data)
            }
                
        except Exception as e:
            logger.error(f"Error listing drone scans: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def search_scans(
        self,
        organization_id: str,
        query: str,
        warehouse_zone: Optional[str] = None,
        aisle: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """Full-text search drone scans."""
        try:
            client = await self._get_client()
            
            # Use the RPC function for full-text search
            result = client.rpc(
                "search_drone_scans",
                {
                    "p_query": query,
                    "p_organization_id": organization_id,
                    "p_warehouse_zone": warehouse_zone,
                    "p_aisle": aisle,
                    "p_limit": limit,
                    "p_offset": offset
                }
            ).execute()
            
            return {
                "success": True,
                "data": result.data,
                "count": len(result.data) if result.data else 0
            }
                
        except Exception as e:
            logger.error(f"Error searching drone scans: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def get_scan_statistics(
        self,
        organization_id: str,
        days: int = 7
    ) -> Dict[str, Any]:
        """Get scan statistics by zone."""
        try:
            client = await self._get_client()
            
            result = client.rpc(
                "get_drone_scan_statistics",
                {
                    "p_organization_id": organization_id,
                    "p_days": days
                }
            ).execute()
            
            return {
                "success": True,
                "data": result.data
            }
                
        except Exception as e:
            logger.error(f"Error getting scan statistics: {str(e)}")
            return {"success": False, "error": str(e)}
    
    # ==================== Missions ====================
    
    async def create_mission(
        self,
        mission_data: DroneMissionCreate,
        organization_id: str,
        user_id: str
    ) -> Dict[str, Any]:
        """Create a new drone mission."""
        try:
            client = await self._get_client()
            
            data = {
                "mission_name": mission_data.mission_name,
                "mission_type": mission_data.mission_type,
                "waypoints": mission_data.waypoints,
                "estimated_duration_minutes": mission_data.estimated_duration_minutes,
                "coverage_zones": mission_data.coverage_zones,
                "drone_id": mission_data.drone_id,
                "drone_model": mission_data.drone_model,
                "organization_id": organization_id,
                "created_by": user_id,
                "status": "planned"
            }
            
            # Remove None values
            data = {k: v for k, v in data.items() if v is not None}
            
            result = client.table("drone_missions").insert(data).execute()
            
            if result.data:
                logger.info(f"Created drone mission: {result.data[0]['id']}")
                return {"success": True, "data": result.data[0]}
            else:
                return {"success": False, "error": "Failed to create mission"}
                
        except Exception as e:
            logger.error(f"Error creating drone mission: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def get_mission(self, mission_id: str, organization_id: str) -> Dict[str, Any]:
        """Get a single drone mission by ID."""
        try:
            client = await self._get_client()
            
            result = client.table("drone_missions")\
                .select("*")\
                .eq("id", mission_id)\
                .eq("organization_id", organization_id)\
                .single()\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data}
            else:
                return {"success": False, "error": "Mission not found"}
                
        except Exception as e:
            logger.error(f"Error getting drone mission: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def list_missions(
        self,
        organization_id: str,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """List drone missions with optional filters."""
        try:
            client = await self._get_client()
            
            query = client.table("drone_missions")\
                .select("*")\
                .eq("organization_id", organization_id)\
                .order("created_at", desc=True)
            
            if status:
                query = query.eq("status", status)
            
            query = query.range(offset, offset + limit - 1)
            
            result = query.execute()
            
            return {
                "success": True,
                "data": result.data,
                "count": len(result.data)
            }
                
        except Exception as e:
            logger.error(f"Error listing drone missions: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def update_mission_status(
        self,
        mission_id: str,
        organization_id: str,
        status: str
    ) -> Dict[str, Any]:
        """Update mission status."""
        try:
            client = await self._get_client()
            
            update_data = {"status": status}
            
            if status == "in_progress":
                update_data["started_at"] = datetime.utcnow().isoformat()
            elif status in ["completed", "aborted", "failed"]:
                update_data["completed_at"] = datetime.utcnow().isoformat()
            
            result = client.table("drone_missions")\
                .update(update_data)\
                .eq("id", mission_id)\
                .eq("organization_id", organization_id)\
                .execute()
            
            if result.data:
                return {"success": True, "data": result.data[0]}
            else:
                return {"success": False, "error": "Mission not found"}
                
        except Exception as e:
            logger.error(f"Error updating mission status: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def get_mission_scans(
        self,
        mission_id: str,
        organization_id: str,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """Get all scans for a mission."""
        try:
            client = await self._get_client()
            
            result = client.table("drone_scans")\
                .select("*")\
                .eq("mission_id", mission_id)\
                .eq("organization_id", organization_id)\
                .order("captured_at", desc=True)\
                .range(offset, offset + limit - 1)\
                .execute()
            
            return {
                "success": True,
                "data": result.data,
                "count": len(result.data)
            }
                
        except Exception as e:
            logger.error(f"Error getting mission scans: {str(e)}")
            return {"success": False, "error": str(e)}


# Singleton instance
_drone_service: Optional[DroneService] = None


async def get_drone_service() -> DroneService:
    """Get or create the drone service singleton."""
    global _drone_service
    if _drone_service is None:
        _drone_service = DroneService()
    return _drone_service

# Created and developed by Jai Singh
