"""
Webhook endpoints for receiving Smartsheet real-time updates.
Handles webhook verification and event processing.
"""

import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Request, Header, Depends
from fastapi.responses import JSONResponse

try:
    from ..services.webhook_service import get_webhook_service
    from ..models.ticket_models import WebhookCallback
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser, require_admin_role
    from ..utils.error_responses import sanitized_error
except ImportError:
    from services.webhook_service import get_webhook_service
    from models.ticket_models import WebhookCallback
    from api.utils.error_responses import sanitized_error
    try:
        from auth.supabase_auth import get_current_user, AuthenticatedUser, require_admin_role
    except ImportError:
        from api.auth.supabase_auth import get_current_user, AuthenticatedUser, require_admin_role

logger = logging.getLogger(__name__)

# Create router - PUBLIC webhook endpoint
router = APIRouter(
    prefix="/webhooks",
    tags=["Webhooks"],
    responses={404: {"description": "Not found"}}
)


@router.post("/smartsheet")
async def smartsheet_webhook_callback(
    request: Request,
    x_smartsheet_hook_signature: Optional[str] = Header(None, alias="X-Smartsheet-Hook-Signature")
):
    """
    Receive webhook callbacks from Smartsheet.
    
    Handles:
    - Webhook verification challenges (signature not required)
    - Event processing and storage (signature REQUIRED and verified)
    """
    try:
        # Get raw body for signature verification
        body = await request.body()
        
        # Parse JSON payload
        try:
            payload = await request.json()
        except Exception as e:
            logger.error(f"Failed to parse webhook payload: {e}")
            raise HTTPException(status_code=400, detail="Invalid JSON payload")
        
        webhook_service = get_webhook_service()
        
        # Handle webhook challenge (verification) - Smartsheet sends this
        # during initial webhook setup; signature may not be present yet.
        if 'challenge' in payload:
            challenge = payload['challenge']
            logger.info("Responding to webhook verification challenge")
            return JSONResponse(
                content={"smartsheetHookResponse": challenge},
                status_code=200
            )
        
        # For actual webhook data, signature is REQUIRED (fail-closed)
        if not x_smartsheet_hook_signature:
            logger.warning("Webhook callback rejected: missing signature header")
            raise HTTPException(status_code=401, detail="Missing webhook signature")
        
        is_valid = webhook_service.verify_webhook_signature(
            body,
            x_smartsheet_hook_signature
        )
        if not is_valid:
            logger.warning("Webhook callback rejected: invalid signature")
            raise HTTPException(status_code=401, detail="Invalid webhook signature")
        
        # Process webhook events
        logger.info(f"Received webhook callback with {len(payload.get('events', []))} events")
        
        result = await webhook_service.process_webhook_callback(payload)
        
        logger.info(f"Webhook processed: {result}")
        
        return JSONResponse(
            content={
                "status": "success",
                "message": f"Processed {result.get('processed_events', 0)} events"
            },
            status_code=200
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing webhook: {str(e)}", exc_info=True)
        # Return 200 to avoid Smartsheet retries for application errors
        return JSONResponse(
            content={
                "status": "error",
                "message": str(e)
            },
            status_code=200
        )


@router.get("/smartsheet/status")
async def webhook_status(
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get webhook service status and statistics.
    Requires authentication.
    """
    try:
        webhook_service = get_webhook_service()
        stats = webhook_service.event_store.get_stats()
        
        return JSONResponse(
            content={
                "status": "active",
                "event_store_stats": stats,
                "registered_webhooks": len(webhook_service._registered_webhooks)
            },
            status_code=200
        )
        
    except Exception as e:
        logger.error(f"Error getting webhook status: {str(e)}")
        raise sanitized_error(500, public_message="Webhook status retrieval failed.", exc=e, context="webhook status")


@router.post("/smartsheet/test")
async def test_webhook_processing(
    test_payload: Dict[str, Any],
    current_user: AuthenticatedUser = Depends(get_current_user),
    _admin=Depends(require_admin_role()),
):
    """
    Test endpoint for webhook processing.
    Useful for development and testing without actual Smartsheet webhooks.
    Requires admin authentication.
    """
    try:
        webhook_service = get_webhook_service()
        result = await webhook_service.process_webhook_callback(test_payload)
        
        return JSONResponse(
            content={
                "status": "success",
                "result": result
            },
            status_code=200
        )
        
    except Exception as e:
        logger.error(f"Error in test webhook: {str(e)}")
        raise sanitized_error(500, public_message="Webhook processing failed.", exc=e, context="test webhook")

# Developer and Creator: Jai Singh

