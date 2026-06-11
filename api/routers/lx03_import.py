# Created and developed by Jai Singh
"""
FastAPI router for LX03 data import operations.
Handles large dataset imports server-side to avoid browser timeout limitations.
"""

import logging
import asyncio
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel, Field
import time

try:
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
    from ..config.database import db
    from ..config.settings import settings
    from ..utils.error_responses import sanitized_error
except ImportError:
    from auth.supabase_auth import get_current_user, AuthenticatedUser
    from config.database import db
    from config.settings import settings
    from api.utils.error_responses import sanitized_error

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/lx03",
    tags=["LX03 Data Import"],
    responses={404: {"description": "Not found"}}
)

# ==================== MODELS ====================

class LX03ImportRow(BaseModel):
    """Single row of LX03 data for import"""
    storage_type: Optional[str] = None
    plant: Optional[str] = None
    storage_bin: Optional[str] = None
    storage_location: Optional[str] = None
    material: Optional[str] = None
    stock_category: Optional[str] = None
    special_stock: Optional[str] = None
    storage_type_2: Optional[str] = None
    total_stock: Optional[float] = None
    available_stock: Optional[float] = None
    stock_for_putaway: Optional[float] = None
    pick_quantity: Optional[float] = None
    last_movement: Optional[str] = None
    last_movement_2: Optional[str] = None
    last_inventory: Optional[str] = None
    special_stock_number: Optional[str] = None
    batch: Optional[str] = None
    inventory_active: Optional[str] = None
    stock_removal_block: Optional[str] = None
    putaway_block: Optional[str] = None
    delivery: Optional[str] = None
    inventory_record: Optional[str] = None
    inventory_record_2: Optional[str] = None
    warehouse: Optional[str] = None


class LX03ImportRequest(BaseModel):
    """Request model for LX03 data import"""
    data: List[LX03ImportRow] = Field(..., description="Array of LX03 data rows to import")
    clear_existing: bool = Field(default=True, description="Whether to clear existing data before import")


class LX03ImportResponse(BaseModel):
    """Response model for LX03 import"""
    success: bool
    total_rows: int
    inserted_rows: int
    error_rows: int
    errors: List[str]
    message: str
    duration_seconds: float


# ==================== ENDPOINTS ====================

@router.post("/import", response_model=LX03ImportResponse)
async def import_lx03_data(
    request: LX03ImportRequest = Body(...),
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Import LX03 data in bulk from frontend.
    Handles large datasets server-side to avoid browser timeouts.
    Processes in chunks with proper error handling and progress tracking.
    """
    start_time = time.time()
    
    try:
        logger.info(f"🚀 LX03 Import started by user {current_user.email}: {len(request.data)} rows")
        
        # Validate user has organization
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User must belong to an organization")
        
        # Step 1: Clear existing data if requested
        if request.clear_existing:
            logger.info("🗑️ Clearing existing LX03 data...")
            try:
                # Use admin client to bypass RLS for bulk delete
                delete_result = db.admin_client.table('rr_lx03_data') \
                    .delete() \
                    .eq('organization_id', current_user.organization_id) \
                    .execute()
                logger.info(f"✅ Cleared existing data")
            except Exception as e:
                logger.error(f"❌ Error clearing data: {e}")
                raise sanitized_error(500, public_message="Failed to clear existing data.", exc=e, context="LX03 import clear data")
        
        # Step 2: Process data in chunks
        chunk_size = 100  # Smaller chunks for better reliability
        total_rows = len(request.data)
        inserted_rows = 0
        error_rows = 0
        errors = []
        
        logger.info(f"📊 Processing {total_rows} rows in chunks of {chunk_size}...")
        
        for i in range(0, total_rows, chunk_size):
            chunk = request.data[i:i + chunk_size]
            chunk_num = (i // chunk_size) + 1
            total_chunks = (total_rows + chunk_size - 1) // chunk_size
            
            # Transform chunk to database format
            db_rows = []
            for row in chunk:
                # Include ALL rows - do not filter empty locations (per user request)
                # Skip only if storage_bin is missing
                if not row.storage_bin:
                    continue
                
                # Build database row
                db_row = {
                    'organization_id': current_user.organization_id,
                    'storage_type': row.storage_type,
                    'plant': row.plant,
                    'storage_bin': row.storage_bin,
                    'storage_location': row.storage_location,
                    'material': row.material,
                    'stock_category': row.stock_category,
                    'special_stock': row.special_stock,
                    'storage_type_2': row.storage_type_2,
                    'total_stock': row.total_stock or 0,
                    'available_stock': row.available_stock or 0,
                    'stock_for_putaway': row.stock_for_putaway,
                    'pick_quantity': row.pick_quantity,
                    'last_movement': row.last_movement,
                    'last_movement_2': row.last_movement_2,
                    'last_inventory': row.last_inventory,
                    'special_stock_number': row.special_stock_number,
                    'batch': row.batch,
                    'inventory_active': row.inventory_active,
                    'stock_removal_block': row.stock_removal_block,
                    'putaway_block': row.putaway_block,
                    'delivery': row.delivery,
                    'inventory_record': row.inventory_record,
                    'inventory_record_2': row.inventory_record_2,
                    'warehouse': row.warehouse
                }
                db_rows.append(db_row)
            
            if not db_rows:
                continue
            
            # Insert chunk with retry logic
            max_retries = 3
            retry_count = 0
            chunk_inserted = False
            
            while not chunk_inserted and retry_count < max_retries:
                try:
                    # Use admin client for bulk insert (bypasses RLS)
                    insert_result = db.admin_client.table('rr_lx03_data') \
                        .insert(db_rows) \
                        .execute()
                    
                    inserted_count = len(insert_result.data) if insert_result.data else 0
                    inserted_rows += inserted_count
                    chunk_inserted = True
                    
                    if chunk_num % 10 == 0 or chunk_num == total_chunks:
                        logger.info(f"✅ Chunk {chunk_num}/{total_chunks}: Inserted {inserted_count} rows (Total: {inserted_rows}/{total_rows})")
                    
                except Exception as insert_error:
                    retry_count += 1
                    error_msg = str(insert_error)
                    
                    # Check if it's a retryable error
                    if retry_count < max_retries and ('timeout' in error_msg.lower() or 'connection' in error_msg.lower()):
                        logger.warning(f"⚠️ Chunk {chunk_num} error, retrying ({retry_count}/{max_retries}): {error_msg}")
                        await asyncio.sleep(2 * retry_count)  # Exponential backoff
                    else:
                        # Final failure or non-retryable error
                        logger.error(f"❌ Chunk {chunk_num} failed: {error_msg}")
                        error_rows += len(db_rows)
                        errors.append(f"Chunk {chunk_num}: {error_msg}")
                        chunk_inserted = True
            
            # Small delay between chunks to avoid overwhelming the server
            if i + chunk_size < total_rows:
                await asyncio.sleep(0.01)  # 10ms delay
        
        # Calculate duration
        duration = time.time() - start_time
        
        # Build result
        success = inserted_rows > 0
        message = f"Successfully imported {inserted_rows:,} records in {duration:.1f}s"
        if error_rows > 0:
            message += f" ({error_rows} errors)"
        
        logger.info(f"✅ Import complete: {message}")
        
        return LX03ImportResponse(
            success=success,
            total_rows=total_rows,
            inserted_rows=inserted_rows,
            error_rows=error_rows,
            errors=errors,
            message=message,
            duration_seconds=duration
        )
        
    except HTTPException:
        raise
    except Exception as e:
        duration = time.time() - start_time
        logger.error(f"❌ Import failed after {duration:.1f}s: {str(e)}")
        raise sanitized_error(500, public_message="Import failed.", exc=e, context="LX03 import")


@router.delete("/clear", response_model=Dict[str, Any])
async def clear_lx03_data(
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """Clear all LX03 data for the current organization."""
    try:
        logger.info(f"🗑️ Clearing LX03 data for organization {current_user.organization_id}")
        
        if not current_user.organization_id:
            raise HTTPException(status_code=400, detail="User must belong to an organization")
        
        # Use admin client to delete all records for this organization
        delete_result = db.admin_client.table('rr_lx03_data') \
            .delete() \
            .eq('organization_id', current_user.organization_id) \
            .execute()
        
        logger.info(f"✅ LX03 data cleared successfully")
        
        return {
            "success": True,
            "message": "All LX03 data cleared successfully"
        }
        
    except Exception as e:
        logger.error(f"❌ Error clearing LX03 data: {str(e)}")
        raise sanitized_error(500, public_message="Failed to clear data.", exc=e, context="LX03 clear")


@router.get("/health")
async def lx03_health_check():
    """Health check endpoint for LX03 import service."""
    return {
        "status": "healthy",
        "service": "LX03 Import API",
        "version": "1.0.0"
    }

# Created and developed by Jai Singh
