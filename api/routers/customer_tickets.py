# Created and developed by Jai Singh
"""
Customer Portal Ticketing API endpoints.
Public-facing endpoints with optional authentication for productivity tracking.
"""

import logging
import asyncio
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query, Path, UploadFile, File, Body, Request
from fastapi.responses import JSONResponse

try:
    from ..services.smartsheet_service import get_smartsheet_service, SmartsheetService
    from ..services.smartsheet_column_mapping import get_column_mapper
    from ..services.webhook_service import get_webhook_service
    from ..utils.error_responses import sanitized_error
    from ..models.ticket_models import (
        TicketCreate, TicketUpdate, TicketSearchRequest, CommentCreate,
        TicketResponse, TicketListResponse, TicketCreateResponse,
        TicketOperationResponse, TicketEventResponse, TicketStatus,
        TicketPriority, TicketCategory
    )
except ImportError:
    from services.smartsheet_service import get_smartsheet_service, SmartsheetService
    from services.smartsheet_column_mapping import get_column_mapper
    from services.webhook_service import get_webhook_service
    from utils.error_responses import sanitized_error
    from models.ticket_models import (
        TicketCreate, TicketUpdate, TicketSearchRequest, CommentCreate,
        TicketResponse, TicketListResponse, TicketCreateResponse,
        TicketOperationResponse, TicketEventResponse, TicketStatus,
        TicketPriority, TicketCategory
    )

# Optional auth for productivity tracking
try:
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
    from ..config.database import get_supabase_client
except ImportError:
    from auth.supabase_auth import get_current_user, AuthenticatedUser
    from config.database import get_supabase_client

logger = logging.getLogger(__name__)

# Create router - PUBLIC endpoints (no authentication required)
router = APIRouter(
    prefix="/customer-tickets",
    tags=["Customer Tickets"],
    responses={404: {"description": "Not found"}}
)

# Ticket sheet ID
TICKET_SHEET_ID = 2987059899748228

# ==================== AUTH & TRACKING HELPERS ====================

async def get_optional_current_user(request: Request) -> Optional[AuthenticatedUser]:
    """Extract user from JWT if present, return None for public access."""
    auth_header = request.headers.get("authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    try:
        # Import security scheme inline to avoid circular imports
        from fastapi.security import HTTPAuthorizationCredentials
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=auth_header.split(" ", 1)[1])
        return await get_current_user(credentials)
    except Exception:
        return None


async def record_user_action(
    user_id: str,
    organization_id: str,
    ticket_row_id: int,
    action_type: str,
    details: Optional[dict] = None,
    response_time_ms: Optional[int] = None
):
    """Record a user action to ticket_user_actions for productivity tracking.
    
    Fire-and-forget: failures are logged but never propagate to the caller.
    """
    try:
        client = await get_supabase_client()
        action_data = {
            "user_id": user_id,
            "organization_id": organization_id,
            "ticket_row_id": ticket_row_id,
            "action_type": action_type,
            "details": details or {},
        }
        if response_time_ms is not None:
            action_data["response_time_ms"] = response_time_ms
        client.table('ticket_user_actions').insert(action_data).execute()
        logger.debug(f"Recorded user action: {action_type} by {user_id} on ticket {ticket_row_id}")
    except Exception as e:
        logger.error(f"Failed to record user action: {e}")


# ==================== HELPER FUNCTIONS ====================

def parse_ticket_row_to_response(row_data: dict, columns: list) -> TicketResponse:
    """
    Parse Smartsheet row data to TicketResponse model.
    
    Args:
        row_data: Row data from Smartsheet
        columns: Column definitions from sheet
        
    Returns:
        TicketResponse model
    """
    # Create column mapping
    column_map = {}
    for col in columns:
        column_map[col['id']] = col['title']
    
    # Extract cell values
    cells_dict = {}
    for cell in row_data.get('cells', []):
        col_title = column_map.get(cell['column_id'], '')
        value = cell.get('display_value') or cell.get('value')
        cells_dict[col_title.lower().replace(' ', '_')] = value
    
    # Parse discussions
    discussions = []
    for disc in row_data.get('discussions', []):
        discussions.append({
            'id': disc.get('id'),
            'title': disc.get('title'),
            'comment_count': disc.get('comment_count', 0),
            'comments': disc.get('comments', []),
            'created_at': disc.get('created_at'),
            'created_by': disc.get('created_by')
        })
    
    # Parse attachments
    attachments = []
    for att in row_data.get('attachments', []):
        attachments.append({
            'id': att.get('id'),
            'name': att.get('name'),
            'attachment_type': att.get('attachment_type'),
            'mime_type': att.get('mime_type'),
            'size_in_kb': att.get('size_in_kb'),
            'url': att.get('url'),
            'url_expires_in_millis': att.get('url_expires_in_millis'),
            'created_at': att.get('created_at'),
            'created_by': att.get('created_by')
        })
    
    return TicketResponse(
        ticket_id=cells_dict.get('ticket_id', str(row_data['id'])),
        row_id=row_data['id'],
        customer_id=cells_dict.get('customer_id', ''),
        email=cells_dict.get('customer_email', ''),
        subject=cells_dict.get('subject', ''),
        description=cells_dict.get('description', ''),
        status=TicketStatus(cells_dict.get('status', 'Open')),
        priority=TicketPriority(cells_dict.get('priority', 'Medium')),
        category=TicketCategory(cells_dict.get('category', 'General')),
        assigned_to=cells_dict.get('assigned_to'),
        notes=cells_dict.get('notes'),
        created_at=row_data.get('created_at'),
        updated_at=row_data.get('modified_at'),
        discussions=discussions,
        attachments=attachments,
        permalink=row_data.get('permalink')
    )


# ==================== TICKET CRUD ENDPOINTS ====================

@router.post("", response_model=TicketCreateResponse, status_code=201)
async def create_ticket(
    ticket: TicketCreate,
    request: Request,
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """
    Create a new support ticket.
    Public endpoint - no authentication required.
    """
    try:
        logger.info(f"Creating ticket for customer {ticket.customer_id} ({ticket.email})")
        
        # Get sheet structure to initialize column mapping
        sheet_response = await service.get_sheet(TICKET_SHEET_ID, level=1)
        if not sheet_response.success:
            raise HTTPException(status_code=500, detail=f"Failed to access ticket sheet: {sheet_response.error}")
        
        # Initialize column mapper
        column_mapper = get_column_mapper()
        if not column_mapper.is_initialized():
            column_mapper.initialize_from_sheet(sheet_response.data)
        
        # Generate ticket ID (use timestamp-based ID)
        ticket_id = f"TKT-{int(datetime.utcnow().timestamp())}"
        
        # Create ticket data
        ticket_data = {
            'ticket_id': ticket_id,
            'customer_id': ticket.customer_id,
            'customer_email': ticket.email,
            'subject': ticket.subject,
            'description': ticket.description,
            'status': TicketStatus.OPEN.value,
            'priority': ticket.priority.value if isinstance(ticket.priority, TicketPriority) else str(ticket.priority),
            'category': ticket.category.value if isinstance(ticket.category, TicketCategory) else str(ticket.category),
            'created_date': datetime.utcnow().isoformat(),
            'updated_date': datetime.utcnow().isoformat()
        }
        
        # Create cell updates
        cells = column_mapper.create_cell_updates(ticket_data)
        
        # Add row to sheet
        rows_data = [{'cells': cells}]
        result = await service.add_rows(TICKET_SHEET_ID, rows_data, location="toBottom")
        
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Failed to create ticket: {result.error}")
        
        # Get created row ID
        created_row = result.data.get('result', {})
        row_id = None
        if isinstance(created_row, dict) and 'data' in created_row:
            rows = created_row['data']
            if rows and len(rows) > 0:
                row_id = rows[0].get('id')
        
        logger.info(f"Ticket created successfully: {ticket_id} (row_id: {row_id})")
        
        # Record user action for productivity tracking (fire-and-forget)
        current_user = await get_optional_current_user(request)
        if current_user and row_id:
            asyncio.create_task(record_user_action(
                user_id=current_user.id,
                organization_id=current_user.organization_id or "",
                ticket_row_id=row_id,
                action_type="ticket_create",
                details={"subject": ticket.subject, "priority": str(ticket.priority), "category": str(ticket.category)}
            ))
        
        # Construct response
        ticket_response = TicketResponse(
            ticket_id=ticket_id,
            row_id=row_id or 0,
            customer_id=ticket.customer_id,
            email=ticket.email,
            subject=ticket.subject,
            description=ticket.description,
            status=TicketStatus.OPEN,
            priority=ticket.priority,
            category=ticket.category,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            discussions=[],
            attachments=[]
        )
        
        return TicketCreateResponse(
            success=True,
            message=f"Ticket {ticket_id} created successfully",
            ticket=ticket_response
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating ticket: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to create ticket.", exc=e, context="create_ticket")


@router.get("/list", response_model=TicketListResponse)
async def list_all_tickets(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(100, description="Maximum number of tickets to return"),
    service: SmartsheetService = Depends(get_smartsheet_service),
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    List all tickets with optional filtering.
    Internal endpoint for dashboard views - requires authentication.
    """
    try:
        logger.info(f"Listing all tickets (status={status}, limit={limit})")
        
        # Get full sheet with all rows
        sheet_response = await service.get_sheet(
            TICKET_SHEET_ID, 
            level=2, 
            include=['discussions', 'attachments']
        )
        
        if not sheet_response.success:
            raise HTTPException(status_code=500, detail=f"Failed to access ticket sheet: {sheet_response.error}")
        
        # Parse all tickets
        tickets = []
        columns = sheet_response.data.get('columns', [])
        rows = sheet_response.data.get('rows', [])
        
        for row in rows[:limit]:
            try:
                ticket = parse_ticket_row_to_response(row, columns)
                
                # Filter by status if specified
                if status and ticket.status.value.lower() != status.lower():
                    continue
                    
                tickets.append(ticket)
            except Exception as e:
                logger.error(f"Error parsing ticket row {row.get('id')}: {e}")
        
        logger.info(f"Found {len(tickets)} tickets")
        
        return TicketListResponse(
            tickets=tickets,
            total_count=len(tickets)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing tickets: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to list tickets.", exc=e, context="list_all_tickets")


@router.get("/search", response_model=TicketListResponse)
async def search_tickets(
    email: Optional[str] = Query(None, description="Customer email"),
    customer_id: Optional[str] = Query(None, description="Customer ID"),
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """
    Search for tickets by email or customer ID.
    Public endpoint - returns tickets matching the search criteria.
    """
    try:
        if not email and not customer_id:
            raise HTTPException(status_code=400, detail="Either email or customer_id must be provided")
        
        logger.info(f"Searching tickets: email={email}, customer_id={customer_id}")
        
        # Search tickets
        result = await service.get_tickets_by_customer(
            customer_id=customer_id,
            email=email,
            ticket_sheet_id=TICKET_SHEET_ID
        )
        
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Search failed: {result.error}")
        
        # Parse tickets
        tickets = []
        columns = result.data.get('columns', [])
        for row in result.data.get('tickets', []):
            try:
                ticket = parse_ticket_row_to_response(row, columns)
                tickets.append(ticket)
            except Exception as e:
                logger.error(f"Error parsing ticket row {row.get('id')}: {e}")
        
        logger.info(f"Found {len(tickets)} tickets")
        
        return TicketListResponse(
            tickets=tickets,
            total_count=len(tickets)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching tickets: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Search failed.", exc=e, context="search_tickets")


# ==================== REAL-TIME LIST-LEVEL UPDATES ====================
# NOTE: This endpoint MUST be defined before /{row_id} to avoid route shadowing.

@router.get("/updates")
async def get_ticket_updates(
    since: Optional[str] = Query(None, description="ISO timestamp cursor — returns events after this time")
):
    """
    Get list-level update notifications for all tickets.
    Returns changed row IDs and event metadata since a timestamp cursor.
    If 'since' is not provided, returns an empty result with a last_checked cursor.

    Designed for frontend polling (default 10s interval).

    Rate-limited to 12 req/min per IP via RateLimitMiddleware public_ticket policy.
    """
    MAX_EVENTS = 100  # Cap to prevent response explosion

    now = datetime.utcnow()

    if not since:
        return JSONResponse(content={
            "updated_row_ids": [],
            "events": [],
            "last_checked": now.isoformat() + "Z",
            "count": 0,
            "truncated": False
        })

    try:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00").replace("+00:00", ""))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid 'since' timestamp. Use ISO 8601 format.")

    webhook_service = get_webhook_service()
    events = await webhook_service.get_recent_ticket_updates(since_dt, limit=MAX_EVENTS + 1)

    # Detect whether we hit the cap (fetched one extra to check)
    truncated = len(events) > MAX_EVENTS
    if truncated:
        events = events[:MAX_EVENTS]

    # Collect unique row IDs (preserve order of first appearance)
    seen_row_ids: set = set()
    updated_row_ids: list = []
    for e in events:
        rid = e.row_id if e.row_id else e.object_id
        if rid not in seen_row_ids:
            seen_row_ids.add(rid)
            updated_row_ids.append(rid)

    event_dicts = [
        {
            "event_id": e.event_id,
            "event_type": e.event_type,
            "object_type": e.object_type,
            "object_id": e.object_id,
            "timestamp": e.timestamp.isoformat(),
            "additional_details": e.additional_details,
        }
        for e in events
    ]

    return JSONResponse(content={
        "updated_row_ids": updated_row_ids,
        "events": event_dicts,
        "last_checked": now.isoformat() + "Z",
        "count": len(updated_row_ids),
        "truncated": truncated
    })


@router.get("/{row_id}", response_model=TicketResponse)
async def get_ticket(
    row_id: int = Path(..., description="Ticket row ID"),
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """
    Get ticket details by row ID.
    Public endpoint - returns full ticket information.
    """
    try:
        logger.info(f"Fetching ticket with row_id: {row_id}")
        
        # Get ticket
        result = await service.get_ticket_by_row_id(row_id, ticket_sheet_id=TICKET_SHEET_ID)
        
        if not result.success:
            raise HTTPException(status_code=404, detail=f"Ticket not found: {result.error}")
        
        # Parse ticket
        ticket_data = result.data.get('ticket')
        columns = result.data.get('columns', [])
        
        ticket = parse_ticket_row_to_response(ticket_data, columns)
        
        return ticket
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching ticket {row_id}: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to fetch ticket.", exc=e, context="get_ticket")


@router.put("/{row_id}", response_model=TicketOperationResponse)
async def update_ticket(
    ticket_update: TicketUpdate,
    request: Request,
    row_id: int = Path(..., description="Ticket row ID"),
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """
    Update ticket fields.
    Public endpoint - allows updating status, priority, notes, etc.
    """
    try:
        logger.info(f"Updating ticket {row_id}")
        
        # Get sheet structure for column mapping
        sheet_response = await service.get_sheet(TICKET_SHEET_ID, level=1)
        if not sheet_response.success:
            raise HTTPException(status_code=500, detail="Failed to access ticket sheet")
        
        # Initialize column mapper
        column_mapper = get_column_mapper()
        if not column_mapper.is_initialized():
            column_mapper.initialize_from_sheet(sheet_response.data)
        
        # Build update dictionary
        update_data = {}
        if ticket_update.status:
            update_data['status'] = ticket_update.status.value if isinstance(ticket_update.status, TicketStatus) else str(ticket_update.status)
        if ticket_update.priority:
            update_data['priority'] = ticket_update.priority.value if isinstance(ticket_update.priority, TicketPriority) else str(ticket_update.priority)
        if ticket_update.assigned_to:
            update_data['assigned_to'] = ticket_update.assigned_to
        if ticket_update.notes:
            update_data['notes'] = ticket_update.notes
        
        update_data['updated_date'] = datetime.utcnow().isoformat()
        
        # Create cell updates
        cells = column_mapper.create_cell_updates(update_data)
        
        # Update ticket
        result = await service.update_cells(TICKET_SHEET_ID, row_id, cells)
        
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Update failed: {result.error}")
        
        logger.info(f"Ticket {row_id} updated successfully")
        
        # Record user action for productivity tracking
        current_user = await get_optional_current_user(request)
        if current_user:
            asyncio.create_task(record_user_action(
                user_id=current_user.id,
                organization_id=current_user.organization_id or "",
                ticket_row_id=row_id,
                action_type="field_update",
                details={"fields_updated": list(update_data.keys())}
            ))
        
        return TicketOperationResponse(
            success=True,
            message="Ticket updated successfully",
            data={"row_id": row_id, "updated_fields": list(update_data.keys())}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating ticket {row_id}: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to update ticket.", exc=e, context="update_ticket")


@router.put("/{row_id}/status", response_model=TicketOperationResponse)
async def update_ticket_status(
    status: TicketStatus,
    request: Request,
    row_id: int = Path(..., description="Ticket row ID"),
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """
    Update ticket status only.
    Convenience endpoint for status changes.
    """
    try:
        logger.info(f"Updating status for ticket {row_id} to {status.value}")
        
        result = await service.update_ticket_status(
            row_id=row_id,
            status=status.value,
            ticket_sheet_id=TICKET_SHEET_ID
        )
        
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Status update failed: {result.error}")
        
        # Record user action for productivity tracking
        current_user = await get_optional_current_user(request)
        if current_user:
            asyncio.create_task(record_user_action(
                user_id=current_user.id,
                organization_id=current_user.organization_id or "",
                ticket_row_id=row_id,
                action_type="status_change",
                details={"new_status": status.value}
            ))
        
        return TicketOperationResponse(
            success=True,
            message=f"Ticket status updated to {status.value}",
            data={"row_id": row_id, "status": status.value}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating ticket status: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to update status.", exc=e, context="update_ticket_status")


# ==================== COMMENTS & DISCUSSIONS ====================

@router.get("/{row_id}/discussions", response_model=TicketOperationResponse)
async def get_ticket_discussions(
    row_id: int = Path(..., description="Ticket row ID"),
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """Get all discussions for a ticket."""
    try:
        result = await service.list_row_discussions(TICKET_SHEET_ID, row_id)
        
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Failed to fetch discussions: {result.error}")
        
        return TicketOperationResponse(
            success=True,
            message="Discussions retrieved successfully",
            data=result.data
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching discussions: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to fetch discussions.", exc=e, context="get_ticket_discussions")


@router.post("/{row_id}/comments", response_model=TicketOperationResponse)
async def add_comment_to_ticket(
    comment: CommentCreate,
    request: Request,
    row_id: int = Path(..., description="Ticket row ID"),
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """
    Add a comment to a ticket.
    Creates a new discussion or adds to existing discussion.
    """
    try:
        logger.info(f"Adding comment to ticket {row_id}")
        
        # Create discussion with comment
        title = f"Comment from {comment.author_name or comment.author_email or 'Customer'}"
        result = await service.create_row_discussion(
            sheet_id=TICKET_SHEET_ID,
            row_id=row_id,
            title=title,
            comment_text=comment.text
        )
        
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Failed to add comment: {result.error}")
        
        # Record user action for productivity tracking
        current_user = await get_optional_current_user(request)
        if current_user:
            asyncio.create_task(record_user_action(
                user_id=current_user.id,
                organization_id=current_user.organization_id or "",
                ticket_row_id=row_id,
                action_type="comment",
                details={"text_length": len(comment.text), "author_name": comment.author_name}
            ))
        
        return TicketOperationResponse(
            success=True,
            message="Comment added successfully",
            data=result.data
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding comment: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to add comment.", exc=e, context="add_comment_to_ticket")


# ==================== ATTACHMENTS ====================

@router.get("/{row_id}/attachments", response_model=TicketOperationResponse)
async def get_ticket_attachments(
    row_id: int = Path(..., description="Ticket row ID"),
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """Get all attachments for a ticket."""
    try:
        result = await service.list_row_attachments(TICKET_SHEET_ID, row_id)
        
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Failed to fetch attachments: {result.error}")
        
        return TicketOperationResponse(
            success=True,
            message="Attachments retrieved successfully",
            data=result.data
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching attachments: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to fetch attachments.", exc=e, context="get_ticket_attachments")


@router.post("/{row_id}/attachments/url", response_model=TicketOperationResponse)
async def attach_url_to_ticket(
    request: Request,
    url_data: dict = Body(..., description="URL and name"),
    row_id: int = Path(..., description="Ticket row ID"),
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """
    Attach a URL to a ticket.
    Useful for linking external resources.
    """
    try:
        url = url_data.get('url')
        name = url_data.get('name', 'Attachment')
        
        if not url:
            raise HTTPException(status_code=400, detail="URL is required")
        
        result = await service.attach_url_to_row(
            sheet_id=TICKET_SHEET_ID,
            row_id=row_id,
            url=url,
            attachment_name=name
        )
        
        if not result.success:
            raise HTTPException(status_code=500, detail=f"Failed to attach URL: {result.error}")
        
        # Record user action for productivity tracking
        current_user = await get_optional_current_user(request)
        if current_user:
            asyncio.create_task(record_user_action(
                user_id=current_user.id,
                organization_id=current_user.organization_id or "",
                ticket_row_id=row_id,
                action_type="attachment",
                details={"url": url, "name": name}
            ))
        
        return TicketOperationResponse(
            success=True,
            message="URL attached successfully",
            data=result.data
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error attaching URL: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to attach URL.", exc=e, context="attach_url_to_ticket")


@router.get("/{row_id}/attachments/{attachment_id}/download", response_model=TicketOperationResponse)
async def get_attachment_download_url(
    row_id: int = Path(..., description="Ticket row ID"),
    attachment_id: int = Path(..., description="Attachment ID"),
    service: SmartsheetService = Depends(get_smartsheet_service)
):
    """
    Get download URL for an attachment.
    Returns temporary download URL from Smartsheet.
    """
    try:
        result = await service.get_attachment_download_url(TICKET_SHEET_ID, attachment_id)
        
        if not result.success:
            raise HTTPException(status_code=404, detail=f"Attachment not found: {result.error}")
        
        return TicketOperationResponse(
            success=True,
            message="Download URL generated",
            data=result.data
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting download URL: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to get download URL.", exc=e, context="get_attachment_download_url")


# ==================== REAL-TIME EVENTS ====================

@router.get("/{row_id}/events", response_model=TicketEventResponse)
async def get_ticket_events(
    row_id: int = Path(..., description="Ticket row ID"),
    since: Optional[str] = Query(None, description="ISO timestamp to get events since")
):
    """
    Get real-time events for a ticket.
    Used for polling-based real-time updates.
    """
    try:
        webhook_service = get_webhook_service()
        
        since_dt = datetime.fromisoformat(since) if since else None
        events = await webhook_service.get_events_for_ticket(row_id, since=since_dt)
        
        # Convert events to dict format
        event_dicts = [
            {
                'event_id': e.event_id,
                'event_type': e.event_type,
                'object_type': e.object_type,
                'object_id': e.object_id,
                'timestamp': e.timestamp.isoformat(),
                'additional_details': e.additional_details
            }
            for e in events
        ]
        
        return TicketEventResponse(
            ticket_id=str(row_id),
            events=event_dicts,
            last_updated=datetime.utcnow(),
            has_more=len(events) >= 50
        )
        
    except Exception as e:
        logger.error(f"Error fetching events: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Failed to fetch events.", exc=e, context="get_ticket_events")

# Created and developed by Jai Singh
