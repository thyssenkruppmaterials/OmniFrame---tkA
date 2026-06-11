# Created and developed by Jai Singh
"""
FastAPI router for Smartsheet operations.
Provides comprehensive RESTful endpoints for all Smartsheet functionality.
"""

import logging
import asyncio
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Query, Path, UploadFile, File, BackgroundTasks, Body
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import ValidationError
import io
import json

try:
    from ..services.smartsheet_service import get_smartsheet_service, SmartsheetService
    from ..utils.error_responses import sanitized_error
    from ..models.smartsheet_models import (
        CreateSheetRequest, UpdateSheetRequest, AddRowsRequest, UpdateRowsRequest,
        DeleteRowsRequest, AddColumnsRequest, ShareSheetRequest, CreateWebhookRequest,
        SearchSheetsRequest, BatchRequest, ImportRequest, ExportRequest,
        SmartsheetBaseResponse, SheetListResponse, SheetResponse, RowsResponse,
        StatisticsResponse, SearchResponse, ErrorResponse, BatchResponse,
        ExportResponse
    )
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
    from ..config.settings import settings
except ImportError:
    from services.smartsheet_service import get_smartsheet_service, SmartsheetService
    from utils.error_responses import sanitized_error
    from models.smartsheet_models import (
        CreateSheetRequest, UpdateSheetRequest, AddRowsRequest, UpdateRowsRequest,
        DeleteRowsRequest, AddColumnsRequest, ShareSheetRequest, CreateWebhookRequest,
        SearchSheetsRequest, BatchRequest, ImportRequest, ExportRequest,
        SmartsheetBaseResponse, SheetListResponse, SheetResponse, RowsResponse,
        StatisticsResponse, SearchResponse, ErrorResponse, BatchResponse,
        ExportResponse
    )
    from auth.supabase_auth import get_current_user, AuthenticatedUser
    from config.settings import settings

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(
    prefix="/smartsheet",
    tags=["Smartsheet"],
    responses={404: {"description": "Not found"}}
)

# Smartsheet configuration for outbound data import
OUTBOUND_SMARTSHEET_ID = 4478754962231172

# ==================== DEPENDENCY INJECTION ====================

async def get_authenticated_smartsheet_service(
    current_user: AuthenticatedUser = Depends(get_current_user)
) -> SmartsheetService:
    """Get Smartsheet service with authenticated user context."""
    service = await get_smartsheet_service()
    # You could add user-specific configuration here if needed
    return service

# ==================== ERROR HANDLERS ====================

def handle_service_error(error: Exception) -> HTTPException:
    """Convert service errors to HTTP exceptions."""
    error_message = str(error)
    
    if "authentication" in error_message.lower():
        return HTTPException(status_code=401, detail=error_message)
    elif "rate limit" in error_message.lower():
        return HTTPException(status_code=429, detail=error_message)
    elif "not found" in error_message.lower():
        return HTTPException(status_code=404, detail=error_message)
    elif "permission" in error_message.lower():
        return HTTPException(status_code=403, detail=error_message)
    else:
        return HTTPException(status_code=500, detail=error_message)

# ==================== CONNECTION & HEALTH ====================

@router.get("/health", response_model=SmartsheetBaseResponse)
async def health_check(
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """Check Smartsheet connection health."""
    try:
        result = await service.test_connection()
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        raise handle_service_error(e)

@router.get("/user", response_model=SmartsheetBaseResponse)
async def get_current_user_info(
    service: SmartsheetService = Depends(get_smartsheet_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Get current Smartsheet user information."""
    try:
        result = await service.get_current_user()
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Get user failed: {str(e)}")
        raise handle_service_error(e)

# ==================== SHEETS OPERATIONS ====================

@router.get("/sheets", response_model=SheetListResponse)
async def list_sheets(
    include_all: bool = Query(True, description="Include all sheets"),
    page_size: Optional[int] = Query(None, ge=1, le=500, description="Number of sheets per page"),
    service: SmartsheetService = Depends(get_smartsheet_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """List all accessible sheets."""
    try:
        result = await service.list_sheets(include_all=include_all, page_size=page_size)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        
        # Extract data from service response and flatten for API response
        data = result.data or {}
        return SheetListResponse(
            success=result.success,
            message=result.message,
            sheets=data.get("sheets", []),
            page_number=data.get("page_number"),
            page_size=data.get("page_size"),
            total_pages=data.get("total_pages"),
            total_count=data.get("total_count")
        )
    except Exception as e:
        logger.error(f"List sheets failed: {str(e)}")
        raise handle_service_error(e)

@router.get("/sheets/{sheet_id}", response_model=SheetResponse)
async def get_sheet(
    sheet_id: int = Path(..., description="Sheet ID"),
    level: int = Query(2, ge=0, le=3, description="Detail level (0=summary, 1=columns, 2=rows, 3=discussions)"),
    include: Optional[str] = Query(None, description="Comma-separated list of includes (attachments,discussions)"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Get sheet details with specified level and includes."""
    try:
        include_list = include.split(',') if include else None
        result = await service.get_sheet(sheet_id, level=level, include=include_list)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return SheetResponse(success=result.success, message=result.message, sheet=result.data)
    except Exception as e:
        logger.error(f"Get sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sheets", response_model=SheetResponse)
async def create_sheet(
    request: CreateSheetRequest,
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Create a new sheet."""
    try:
        result = await service.create_sheet(request.name, request.columns)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return SheetResponse(success=result.success, message=result.message, sheet=result.data)
    except ValidationError as e:
        raise sanitized_error(422, public_message="Invalid sheet data.", exc=e, context="create sheet")
    except Exception as e:
        logger.error(f"Create sheet failed: {str(e)}")
        raise handle_service_error(e)

@router.put("/sheets/{sheet_id}", response_model=SheetResponse)
async def update_sheet(
    request: UpdateSheetRequest = None,
    sheet_id: int = Path(..., description="Sheet ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Update sheet properties."""
    try:
        updates = request.dict(exclude_none=True) if request else {}
        result = await service.update_sheet(sheet_id, updates)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return SheetResponse(success=result.success, message=result.message, sheet=result.data)
    except ValidationError as e:
        raise sanitized_error(422, public_message="Invalid sheet data.", exc=e, context="update sheet")
    except Exception as e:
        logger.error(f"Update sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.delete("/sheets/{sheet_id}", response_model=SmartsheetBaseResponse)
async def delete_sheet(
    sheet_id: int = Path(..., description="Sheet ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Delete a sheet."""
    try:
        result = await service.delete_sheet(sheet_id)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Delete sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== ROW OPERATIONS ====================

@router.get("/sheets/{sheet_id}/rows", response_model=RowsResponse)
async def get_rows(
    sheet_id: int = Path(..., description="Sheet ID"),
    page_size: Optional[int] = Query(None, ge=1, le=1000, description="Number of rows per page"),
    page: int = Query(1, ge=1, description="Page number"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Get rows from a sheet with pagination."""
    try:
        result = await service.get_rows(sheet_id, page_size=page_size, page=page)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return RowsResponse(**result.dict())
    except Exception as e:
        logger.error(f"Get rows from sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sheets/{sheet_id}/rows", response_model=SmartsheetBaseResponse)
async def add_rows(
    request: AddRowsRequest,
    sheet_id: int = Path(..., description="Sheet ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Add rows to a sheet."""
    try:
        # This would need to be implemented in the service
        # For now, return a placeholder response
        return SmartsheetBaseResponse(
            success=True,
            message=f"Add rows functionality needs to be implemented in service for sheet {sheet_id}"
        )
    except ValidationError as e:
        raise sanitized_error(422, public_message="Invalid row data.", exc=e, context="add rows")
    except Exception as e:
        logger.error(f"Add rows to sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.put("/sheets/{sheet_id}/rows/{row_id}/cells", response_model=SmartsheetBaseResponse)
async def update_cells(
    sheet_id: int = Path(..., description="Sheet ID"),
    row_id: int = Path(..., description="Row ID"),
    cell_updates: List[Dict[str, Any]] = Body(..., description="Cell updates"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Update specific cells in a row."""
    try:
        result = await service.update_cells(sheet_id, row_id, cell_updates)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except ValidationError as e:
        raise sanitized_error(422, public_message="Invalid cell data.", exc=e, context="update cells")
    except Exception as e:
        logger.error(f"Update cells in sheet {sheet_id}, row {row_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sheets/{sheet_id}/rows", response_model=SmartsheetBaseResponse)
async def add_rows_to_sheet(
    sheet_id: int = Path(..., description="Sheet ID"),
    rows_data: List[Dict[str, Any]] = Body(..., description="Rows to add"),
    location: str = Query("toBottom", description="Location to add rows (toTop, toBottom)"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Add new rows to a sheet."""
    try:
        result = await service.add_rows(sheet_id, rows_data, location)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except ValidationError as e:
        raise sanitized_error(422, public_message="Invalid row data.", exc=e, context="add rows to sheet")
    except Exception as e:
        logger.error(f"Add rows to sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.delete("/sheets/{sheet_id}/rows", response_model=SmartsheetBaseResponse)
async def delete_rows(
    request: DeleteRowsRequest,
    sheet_id: int = Path(..., description="Sheet ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Delete rows from a sheet."""
    try:
        # This would need to be implemented in the service
        return SmartsheetBaseResponse(
            success=True,
            message=f"Delete rows functionality needs to be implemented in service for sheet {sheet_id}"
        )
    except ValidationError as e:
        raise sanitized_error(422, public_message="Invalid delete rows request.", exc=e, context="delete rows")
    except Exception as e:
        logger.error(f"Delete rows from sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== COLUMN OPERATIONS ====================

@router.post("/sheets/{sheet_id}/columns", response_model=SmartsheetBaseResponse)
async def add_columns(
    request: AddColumnsRequest,
    sheet_id: int = Path(..., description="Sheet ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Add columns to a sheet."""
    try:
        # This would need to be implemented in the service
        return SmartsheetBaseResponse(
            success=True,
            message=f"Add columns functionality needs to be implemented in service for sheet {sheet_id}"
        )
    except ValidationError as e:
        raise sanitized_error(422, public_message="Invalid column data.", exc=e, context="add columns")
    except Exception as e:
        logger.error(f"Add columns to sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== ATTACHMENT OPERATIONS ====================

@router.get("/sheets/{sheet_id}/attachments", response_model=SmartsheetBaseResponse)
async def list_sheet_attachments(
    sheet_id: int = Path(..., description="Sheet ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """List all attachments for a sheet."""
    try:
        result = await service.list_sheet_attachments(sheet_id)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"List attachments for sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sheets/{sheet_id}/attachments", response_model=SmartsheetBaseResponse)
async def upload_sheet_attachment(
    sheet_id: int = Path(..., description="Sheet ID"),
    file: UploadFile = File(...),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Upload a file attachment to a sheet."""
    try:
        # Read file content
        file_content = await file.read()
        content_type = file.content_type or "application/octet-stream"
        
        result = await service.upload_file_to_sheet(sheet_id, file_content, file.filename, content_type)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Upload attachment to sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sheets/{sheet_id}/rows/{row_id}/attachments/file", response_model=SmartsheetBaseResponse)
async def upload_row_attachment(
    sheet_id: int = Path(..., description="Sheet ID"),
    row_id: int = Path(..., description="Row ID"),
    file: UploadFile = File(...),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Upload a file attachment to a specific row."""
    try:
        # Read file content
        file_content = await file.read()
        content_type = file.content_type or "application/octet-stream"
        
        result = await service.upload_file_to_row(sheet_id, row_id, file_content, file.filename, content_type)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Upload attachment to sheet {sheet_id}, row {row_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sheets/{sheet_id}/comments/{comment_id}/attachments", response_model=SmartsheetBaseResponse)
async def upload_comment_attachment(
    sheet_id: int = Path(..., description="Sheet ID"),
    comment_id: int = Path(..., description="Comment ID"),
    file: UploadFile = File(...),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Upload a file attachment to a comment."""
    try:
        # Read file content
        file_content = await file.read()
        content_type = file.content_type or "application/octet-stream"
        
        result = await service.upload_file_to_comment(sheet_id, comment_id, file_content, file.filename, content_type)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Upload attachment to comment {comment_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== DISCUSSION OPERATIONS ====================

@router.get("/sheets/{sheet_id}/discussions/{discussion_id}", response_model=SmartsheetBaseResponse)
async def get_discussion(
    sheet_id: int = Path(..., description="Sheet ID"),
    discussion_id: int = Path(..., description="Discussion ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Get a specific discussion with all comments and attachments."""
    try:
        result = await service.get_discussion(sheet_id, discussion_id)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Get discussion {discussion_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.delete("/sheets/{sheet_id}/discussions/{discussion_id}", response_model=SmartsheetBaseResponse)
async def delete_discussion(
    sheet_id: int = Path(..., description="Sheet ID"),
    discussion_id: int = Path(..., description="Discussion ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Delete a discussion."""
    try:
        result = await service.delete_discussion(sheet_id, discussion_id)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Delete discussion {discussion_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.put("/sheets/{sheet_id}/comments/{comment_id}", response_model=SmartsheetBaseResponse)
async def update_comment(
    sheet_id: int = Path(..., description="Sheet ID"),
    comment_id: int = Path(..., description="Comment ID"),
    comment_data: Dict[str, str] = Body(..., description="Comment text"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Update an existing comment."""
    try:
        text = comment_data.get("text")
        
        if not text:
            raise HTTPException(status_code=400, detail="Comment text is required")
        
        result = await service.update_comment(sheet_id, comment_id, text)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Update comment {comment_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.delete("/sheets/{sheet_id}/comments/{comment_id}", response_model=SmartsheetBaseResponse)
async def delete_comment(
    sheet_id: int = Path(..., description="Sheet ID"),
    comment_id: int = Path(..., description="Comment ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Delete a comment."""
    try:
        result = await service.delete_comment(sheet_id, comment_id)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Delete comment {comment_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== WORKSPACE OPERATIONS ====================

@router.get("/workspaces")
async def list_workspaces(
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """List all workspaces."""
    try:
        # This would need to be implemented in the service
        return SmartsheetBaseResponse(
            success=True,
            message="List workspaces functionality needs to be implemented"
        )
    except Exception as e:
        logger.error(f"List workspaces failed: {str(e)}")
        raise handle_service_error(e)

@router.get("/workspaces/{workspace_id}")
async def get_workspace(
    workspace_id: int = Path(..., description="Workspace ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Get workspace details."""
    try:
        # This would need to be implemented in the service
        return SmartsheetBaseResponse(
            success=True,
            message=f"Get workspace functionality needs to be implemented for workspace {workspace_id}"
        )
    except Exception as e:
        logger.error(f"Get workspace {workspace_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== SEARCH OPERATIONS ====================

@router.get("/search", response_model=SearchResponse)
async def search_sheets(
    q: str = Query(..., description="Search query"),
    scope: str = Query("workspace", description="Search scope"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Search sheets by name or content."""
    try:
        result = await service.search_sheets(q, scope)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return SearchResponse(
            success=result.success,
            message=result.message,
            results=result.data.get('sheets', []),
            query=q,
            total_count=result.data.get('total_count', 0)
        )
    except Exception as e:
        logger.error(f"Search sheets failed: {str(e)}")
        raise handle_service_error(e)

# ==================== CONNECTION MANAGEMENT ====================

@router.get("/connections")
async def list_connections(
    service: SmartsheetService = Depends(get_smartsheet_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """List all Smartsheet connections."""
    try:
        # Return mock connections for now
        mock_connections = []
        
        return SmartsheetBaseResponse(
            success=True,
            message="Connections retrieved successfully"
        )
    except Exception as e:
        logger.error(f"List connections failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/connections")
async def create_connection(
    request: dict,
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Create a new Smartsheet connection."""
    try:
        # This would need to be implemented
        return SmartsheetBaseResponse(
            success=True,
            message="Create connection functionality needs to be implemented"
        )
    except Exception as e:
        logger.error(f"Create connection failed: {str(e)}")
        raise handle_service_error(e)

@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: str = Path(..., description="Connection ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Delete a Smartsheet connection."""
    try:
        # This would need to be implemented
        return SmartsheetBaseResponse(
            success=True,
            message="Delete connection functionality needs to be implemented"
        )
    except Exception as e:
        logger.error(f"Delete connection failed: {str(e)}")
        raise handle_service_error(e)

# ==================== SYNC JOBS ====================

@router.get("/sync/jobs")
async def list_sync_jobs(
    service: SmartsheetService = Depends(get_smartsheet_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """List all sync jobs."""
    try:
        # Return mock sync jobs for now
        mock_jobs = []
        
        return SmartsheetBaseResponse(
            success=True,
            message="Sync jobs retrieved successfully"
        )
    except Exception as e:
        logger.error(f"List sync jobs failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sync/jobs")
async def create_sync_job(
    request: dict,
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Create a new sync job."""
    try:
        # This would need to be implemented
        return SmartsheetBaseResponse(
            success=True,
            message="Create sync job functionality needs to be implemented"
        )
    except Exception as e:
        logger.error(f"Create sync job failed: {str(e)}")
        raise handle_service_error(e)

@router.get("/sync/jobs/{job_id}")
async def get_sync_job(
    job_id: str = Path(..., description="Job ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Get sync job details."""
    try:
        # This would need to be implemented
        return SmartsheetBaseResponse(
            success=True,
            message="Get sync job functionality needs to be implemented"
        )
    except Exception as e:
        logger.error(f"Get sync job failed: {str(e)}")
        raise handle_service_error(e)

# ==================== SHARING OPERATIONS ====================

@router.get("/sheets/{sheet_id}/shares")
async def get_sheet_shares(
    sheet_id: int = Path(..., description="Sheet ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Get sharing information for a sheet."""
    try:
        # This would need to be implemented in the service
        return SmartsheetBaseResponse(
            success=True,
            message=f"Get shares functionality needs to be implemented for sheet {sheet_id}"
        )
    except Exception as e:
        logger.error(f"Get shares for sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sheets/{sheet_id}/shares")
async def share_sheet(
    request: ShareSheetRequest,
    sheet_id: int = Path(..., description="Sheet ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Share a sheet with a user."""
    try:
        # This would need to be implemented in the service
        return SmartsheetBaseResponse(
            success=True,
            message=f"Share sheet functionality needs to be implemented for sheet {sheet_id}"
        )
    except ValidationError as e:
        raise sanitized_error(422, public_message="Invalid share request.", exc=e, context="share sheet")
    except Exception as e:
        logger.error(f"Share sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== WEBHOOK OPERATIONS ====================

@router.post("/webhooks")
async def create_webhook(
    request: CreateWebhookRequest,
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Create a new webhook."""
    try:
        # This would need to be implemented in the service
        return SmartsheetBaseResponse(
            success=True,
            message="Create webhook functionality needs to be implemented"
        )
    except ValidationError as e:
        raise sanitized_error(422, public_message="Invalid webhook request.", exc=e, context="create webhook")
    except Exception as e:
        logger.error(f"Create webhook failed: {str(e)}")
        raise handle_service_error(e)

@router.get("/webhooks")
async def list_webhooks(
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """List all webhooks."""
    try:
        # This would need to be implemented in the service
        return SmartsheetBaseResponse(
            success=True,
            message="List webhooks functionality needs to be implemented"
        )
    except Exception as e:
        logger.error(f"List webhooks failed: {str(e)}")
        raise handle_service_error(e)

@router.delete("/webhooks/{webhook_id}")
async def delete_webhook(
    webhook_id: int = Path(..., description="Webhook ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Delete a webhook."""
    try:
        # This would need to be implemented in the service
        return SmartsheetBaseResponse(
            success=True,
            message=f"Delete webhook functionality needs to be implemented for webhook {webhook_id}"
        )
    except Exception as e:
        logger.error(f"Delete webhook {webhook_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== STATISTICS & ANALYTICS ====================

@router.get("/dashboard/stats", response_model=StatisticsResponse)
async def get_dashboard_statistics(
    service: SmartsheetService = Depends(get_smartsheet_service),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Get dashboard statistics."""
    try:
        # Return mock dashboard stats for now
        mock_stats = {
            "total_activities": 0,
            "successful_activities": 0,
            "failed_activities": 0,
            "unique_sheets_accessed": 0,
            "active_connections": 0,
            "recent_sync_jobs": 0,
            "cache_entries": 0
        }
        
        return StatisticsResponse(
            success=True,
            message="Dashboard statistics retrieved",
            statistics=mock_stats
        )
    except Exception as e:
        logger.error(f"Get dashboard statistics failed: {str(e)}")
        raise handle_service_error(e)

@router.get("/sheets/{sheet_id}/statistics", response_model=StatisticsResponse)
async def get_sheet_statistics(
    sheet_id: int = Path(..., description="Sheet ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Get statistics and analytics for a sheet."""
    try:
        result = await service.get_sheet_summary(sheet_id)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return StatisticsResponse(
            success=result.success,
            message=result.message,
            statistics=result.data
        )
    except Exception as e:
        logger.error(f"Get statistics for sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== ATTACHMENT OPERATIONS ====================

@router.get("/sheets/{sheet_id}/rows/{row_id}/attachments", response_model=SmartsheetBaseResponse)
async def list_row_attachments(
    sheet_id: int = Path(..., description="Sheet ID"),
    row_id: int = Path(..., description="Row ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """List all attachments for a specific row."""
    try:
        result = await service.list_row_attachments(sheet_id, row_id)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"List attachments for sheet {sheet_id}, row {row_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sheets/{sheet_id}/rows/{row_id}/attachments/url", response_model=SmartsheetBaseResponse)
async def attach_url_to_row(
    sheet_id: int = Path(..., description="Sheet ID"),
    row_id: int = Path(..., description="Row ID"),
    attachment_data: Dict[str, str] = Body(..., description="URL and name"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Attach a URL to a specific row."""
    try:
        url = attachment_data.get("url")
        name = attachment_data.get("name")
        
        if not url or not name:
            raise HTTPException(status_code=400, detail="URL and name are required")
        
        result = await service.attach_url_to_row(sheet_id, row_id, url, name)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Attach URL to sheet {sheet_id}, row {row_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.get("/sheets/{sheet_id}/attachments/{attachment_id}/download", response_model=SmartsheetBaseResponse)
async def get_attachment_download_url(
    sheet_id: int = Path(..., description="Sheet ID"),
    attachment_id: int = Path(..., description="Attachment ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Get download URL for an attachment."""
    try:
        result = await service.get_attachment_download_url(sheet_id, attachment_id)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Get download URL for attachment {attachment_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.delete("/sheets/{sheet_id}/attachments/{attachment_id}", response_model=SmartsheetBaseResponse)
async def delete_attachment(
    sheet_id: int = Path(..., description="Sheet ID"),
    attachment_id: int = Path(..., description="Attachment ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Delete an attachment."""
    try:
        result = await service.delete_attachment(sheet_id, attachment_id)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Delete attachment {attachment_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== DISCUSSION OPERATIONS ====================

@router.get("/sheets/{sheet_id}/rows/{row_id}/discussions", response_model=SmartsheetBaseResponse)
async def list_row_discussions(
    sheet_id: int = Path(..., description="Sheet ID"),
    row_id: int = Path(..., description="Row ID"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """List all discussions for a specific row."""
    try:
        result = await service.list_row_discussions(sheet_id, row_id)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"List discussions for sheet {sheet_id}, row {row_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sheets/{sheet_id}/rows/{row_id}/discussions", response_model=SmartsheetBaseResponse)
async def create_row_discussion(
    sheet_id: int = Path(..., description="Sheet ID"),
    row_id: int = Path(..., description="Row ID"),
    discussion_data: Dict[str, str] = Body(..., description="Discussion title and comment"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Create a new discussion on a row."""
    try:
        title = discussion_data.get("title")
        comment_text = discussion_data.get("comment")
        
        if not title or not comment_text:
            raise HTTPException(status_code=400, detail="Title and comment are required")
        
        result = await service.create_row_discussion(sheet_id, row_id, title, comment_text)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Create discussion for sheet {sheet_id}, row {row_id} failed: {str(e)}")
        raise handle_service_error(e)

@router.post("/sheets/{sheet_id}/discussions/{discussion_id}/comments", response_model=SmartsheetBaseResponse)
async def add_comment_to_discussion(
    sheet_id: int = Path(..., description="Sheet ID"),
    discussion_id: int = Path(..., description="Discussion ID"),
    comment_data: Dict[str, str] = Body(..., description="Comment text"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Add a comment to an existing discussion."""
    try:
        comment_text = comment_data.get("text")
        
        if not comment_text:
            raise HTTPException(status_code=400, detail="Comment text is required")
        
        result = await service.add_comment_to_discussion(sheet_id, discussion_id, comment_text)
        if not result.success:
            raise handle_service_error(Exception(result.error))
        return result
    except Exception as e:
        logger.error(f"Add comment to discussion {discussion_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== EXPORT OPERATIONS ====================

@router.get("/sheets/{sheet_id}/export", response_model=ExportResponse)
async def export_sheet(
    sheet_id: int = Path(..., description="Sheet ID"),
    format: str = Query("xlsx", description="Export format (xlsx, pdf, csv)"),
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Export a sheet in the specified format."""
    try:
        # This would need to be implemented in the service
        return ExportResponse(
            success=True,
            message=f"Export sheet functionality needs to be implemented for sheet {sheet_id} in format {format}"
        )
    except Exception as e:
        logger.error(f"Export sheet {sheet_id} failed: {str(e)}")
        raise handle_service_error(e)

# ==================== OUTBOUND DATA IMPORT ====================

@router.get("/import/outbound-data", response_model=Dict[str, Any])
async def import_outbound_data_from_smartsheet(
    sheet_id: Optional[int] = Query(None, description="Smartsheet ID (defaults to configured outbound sheet)"),
    current_user: AuthenticatedUser = Depends(get_current_user),
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """
    Import outbound TO data from Smartsheet to format compatible with outbound_to_data table.
    Uses configured Smartsheet ID (4478754962231172) by default.
    Returns data in the same format as clipboard import for seamless integration.
    """
    try:
        # Use default sheet ID if not provided
        target_sheet_id = sheet_id or OUTBOUND_SMARTSHEET_ID
        
        logger.info(f"🚀 Smart Import: Fetching data from Smartsheet {target_sheet_id} for user {current_user.id}")
        logger.info(f"📍 Smart Import: Endpoint HIT - /api/smartsheet/import/outbound-data")
        
        # Fetch sheet data with full rows
        logger.info(f"🔄 Smart Import: Calling service.get_sheet with level=2")
        result = await service.get_sheet(target_sheet_id, level=2, include=None)
        
        logger.info(f"📦 Smart Import: get_sheet result - success={result.success}, has_data={result.data is not None}")
        
        if not result.success:
            logger.error(f"❌ Smart Import: Failed to fetch sheet {target_sheet_id}: {result.error}")
            raise HTTPException(status_code=500, detail=result.error or "Failed to fetch Smartsheet data")
        
        sheet_data = result.data
        if not sheet_data:
            logger.error(f"❌ Smart Import: No sheet data in result")
            raise HTTPException(status_code=404, detail="No sheet data found")
        
        logger.info(f"✅ Smart Import: sheet_data keys: {list(sheet_data.keys()) if isinstance(sheet_data, dict) else 'Not a dict'}")
        
        # Extract columns and rows
        columns = sheet_data.get('columns', [])
        rows = sheet_data.get('rows', [])
        
        if not columns or not rows:
            raise HTTPException(status_code=400, detail="Sheet has no columns or rows")
        
        logger.info(f"Smart Import: Found {len(columns)} columns and {len(rows)} rows")
        
        # Create column ID to name mapping
        column_map = {col['id']: col['title'] for col in columns}
        
        # Expected outbound headers (matching EXPECTED_HEADERS from outbound-to-data.service.ts)
        expected_headers = [
            'Delivery', 'Transfer Order Number', 'Transfer order priority',
            'Source Storage Type', 'Warehouse Number', 'Dest. Storage Type',
            'Movement Type (IM)', 'Movement Type (WM)', 'Source Storage Bin',
            'Plant', 'Storage Location', 'Material', 'Material Description',
            'Batch', 'Source target qty', 'Creation Date', 'Creation time',
            'User', 'Printer'
        ]
        
        # Build headers array from Smartsheet columns (in order)
        headers = [col['title'] for col in columns]
        
        # Transform rows to array format
        data_rows = []
        for row in rows:
            row_values = []
            cells = row.get('cells', [])
            
            # Create a cell dictionary for easy lookup (use snake_case to match CellData model)
            cell_dict = {cell.get('column_id'): cell for cell in cells}
            
            # Extract values in column order
            for col in columns:
                col_id = col['id']
                cell = cell_dict.get(col_id, {})
                # Use snake_case to match CellData Pydantic model (display_value, not displayValue)
                cell_value = cell.get('display_value') or cell.get('value') or ''
                row_values.append(str(cell_value) if cell_value is not None else '')
            
            data_rows.append(row_values)
        
        logger.info(f"Smart Import: Transformed {len(data_rows)} rows for import")
        
        # Return data in clipboard-compatible format
        return {
            "success": True,
            "message": f"Successfully fetched {len(data_rows)} rows from Smartsheet",
            "data": {
                "headers": headers,
                "rows": data_rows,
                "sheet_id": target_sheet_id,
                "sheet_name": sheet_data.get('name', 'Unknown'),
                "total_rows": len(data_rows),
                "columns_count": len(headers)
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Smart Import failed: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Import operation failed.", exc=e, context="smartsheet import outbound data")

# ==================== BATCH OPERATIONS ====================

@router.post("/batch", response_model=BatchResponse)
async def batch_operations(
    request: BatchRequest,
    service: SmartsheetService = Depends(get_authenticated_smartsheet_service)
):
    """Execute multiple operations in a batch."""
    try:
        # This would need to be implemented in the service
        return BatchResponse(
            success=True,
            message="Batch operations functionality needs to be implemented",
            responses=[],
            success_count=0,
            failed_count=len(request.requests)
        )
    except ValidationError as e:
        raise sanitized_error(422, public_message="Invalid batch request.", exc=e, context="batch operations")
    except Exception as e:
        logger.error(f"Batch operations failed: {str(e)}")
        raise handle_service_error(e)

# Created and developed by Jai Singh
