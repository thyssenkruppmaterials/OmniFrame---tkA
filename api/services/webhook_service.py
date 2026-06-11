# Created and developed by Jai Singh
"""
Webhook event management service for Smartsheet real-time updates.
Handles webhook registration, event storage, and event broadcasting.
"""

import logging
import time
import hashlib
import hmac
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from collections import defaultdict
from dataclasses import dataclass, field
import asyncio

try:
    from ..config.settings import settings
    from ..services.smartsheet_service import get_smartsheet_service
    from ..config.database import get_supabase_client
except ImportError:
    from config.settings import settings
    from services.smartsheet_service import get_smartsheet_service
    from config.database import get_supabase_client

logger = logging.getLogger(__name__)


@dataclass
class WebhookEvent:
    """Webhook event data structure."""
    event_id: str
    event_type: str
    object_type: str
    object_id: int
    scope_object_id: int
    user_id: Optional[int] = None
    timestamp: datetime = field(default_factory=datetime.utcnow)
    additional_details: Dict[str, Any] = field(default_factory=dict)
    row_id: Optional[int] = None
    sheet_id: Optional[int] = None


class WebhookEventStore:
    """
    In-memory event store for webhook events.
    Stores events temporarily for polling-based real-time updates.
    """
    
    def __init__(self, max_events_per_object: int = 100, ttl_seconds: int = 3600):
        """
        Initialize event store.
        
        Args:
            max_events_per_object: Maximum events to store per object
            ttl_seconds: Time to live for events in seconds (default 1 hour)
        """
        self._events: Dict[int, List[WebhookEvent]] = defaultdict(list)
        self._max_events = max_events_per_object
        self._ttl = ttl_seconds
        self._lock = asyncio.Lock()
        logger.info(f"WebhookEventStore initialized (max_events={max_events_per_object}, ttl={ttl_seconds}s)")
    
    async def add_event(self, event: WebhookEvent) -> None:
        """
        Add an event to the store.
        
        Args:
            event: WebhookEvent to store
        """
        async with self._lock:
            # Determine storage key (use row_id if available, else object_id)
            key = event.row_id if event.row_id else event.object_id
            
            # Add event to list
            self._events[key].append(event)
            
            # Trim old events
            await self._trim_events(key)
            
            logger.debug(f"Added event {event.event_id} for object {key} (type: {event.event_type})")
    
    async def get_events_since(self, object_id: int, since: datetime) -> List[WebhookEvent]:
        """
        Get all events for an object since a specific time.
        
        Args:
            object_id: Object ID (row_id or sheet_id)
            since: Timestamp to filter events from
            
        Returns:
            List of events
        """
        async with self._lock:
            events = self._events.get(object_id, [])
            # Filter events newer than 'since' timestamp
            filtered = [e for e in events if e.timestamp > since]
            logger.debug(f"Retrieved {len(filtered)} events for object {object_id} since {since}")
            return filtered
    
    async def get_recent_events(self, object_id: int, limit: int = 50) -> List[WebhookEvent]:
        """
        Get most recent events for an object.
        
        Args:
            object_id: Object ID (row_id or sheet_id)
            limit: Maximum number of events to return
            
        Returns:
            List of recent events
        """
        async with self._lock:
            events = self._events.get(object_id, [])
            # Return most recent events
            return events[-limit:] if len(events) > limit else events
    
    async def clear_events(self, object_id: int) -> None:
        """
        Clear all events for an object.
        
        Args:
            object_id: Object ID to clear events for
        """
        async with self._lock:
            if object_id in self._events:
                del self._events[object_id]
                logger.debug(f"Cleared events for object {object_id}")
    
    async def _trim_events(self, object_id: int) -> None:
        """
        Trim old events based on max count and TTL.
        
        Args:
            object_id: Object ID to trim events for
        """
        events = self._events[object_id]
        
        # Remove events older than TTL
        cutoff_time = datetime.utcnow() - timedelta(seconds=self._ttl)
        events[:] = [e for e in events if e.timestamp > cutoff_time]
        
        # Keep only the most recent max_events
        if len(events) > self._max_events:
            events[:] = events[-self._max_events:]
    
    async def get_all_recent_events(self, since: datetime, limit: int = 100) -> List[WebhookEvent]:
        """
        Get all events across all objects since a specific time.
        
        Args:
            since: Timestamp to filter events from
            limit: Maximum number of events to return (default 100).
                   Prevents memory issues with large event stores.
            
        Returns:
            List of all events newer than 'since', capped at `limit`
        """
        async with self._lock:
            all_events = []
            for events in self._events.values():
                all_events.extend(e for e in events if e.timestamp > since)
            # Sort by timestamp ascending
            all_events.sort(key=lambda e: e.timestamp)
            logger.debug(f"Retrieved {len(all_events)} total events since {since} (limit={limit})")
            return all_events[:limit]

    async def cleanup_old_events(self) -> None:
        """Periodic cleanup of old events across all objects."""
        async with self._lock:
            cutoff_time = datetime.utcnow() - timedelta(seconds=self._ttl)
            objects_to_delete = []
            
            for object_id, events in self._events.items():
                # Filter out old events
                events[:] = [e for e in events if e.timestamp > cutoff_time]
                
                # Mark empty event lists for deletion
                if not events:
                    objects_to_delete.append(object_id)
            
            # Delete empty event lists
            for object_id in objects_to_delete:
                del self._events[object_id]
            
            logger.info(f"Cleanup completed: removed {len(objects_to_delete)} empty event lists")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about stored events."""
        total_events = sum(len(events) for events in self._events.values())
        return {
            "total_objects": len(self._events),
            "total_events": total_events,
            "avg_events_per_object": total_events / len(self._events) if self._events else 0,
            "max_events_per_object": self._max_events,
            "ttl_seconds": self._ttl
        }


class WebhookService:
    """Service for managing Smartsheet webhooks."""
    
    def __init__(self):
        """Initialize webhook service."""
        self.event_store = WebhookEventStore()
        self._webhook_secret = getattr(settings, 'smartsheet_webhook_secret', None)
        self._registered_webhooks: Dict[int, int] = {}  # sheet_id -> webhook_id
        logger.info("WebhookService initialized")
    
    def verify_webhook_signature(self, payload: bytes, signature: str) -> bool:
        """
        Verify Smartsheet webhook signature.
        
        Args:
            payload: Raw webhook payload bytes
            signature: HMAC signature from header
            
        Returns:
            True if signature is valid, False otherwise (fail-closed)
        """
        if not self._webhook_secret:
            logger.error("Webhook secret not configured - rejecting webhook")
            return False
        
        # Compute HMAC-SHA256 signature
        computed_signature = hmac.new(
            self._webhook_secret.encode(),
            payload,
            hashlib.sha256
        ).hexdigest()
        
        # Compare signatures (constant-time comparison)
        is_valid = hmac.compare_digest(computed_signature, signature)
        
        if not is_valid:
            logger.warning("Webhook signature verification failed")
        
        return is_valid
    
    async def process_webhook_callback(self, callback_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process incoming webhook callback from Smartsheet.
        
        Args:
            callback_data: Webhook callback payload
            
        Returns:
            Response dictionary
        """
        # Handle challenge response for webhook verification
        if 'challenge' in callback_data:
            challenge = callback_data['challenge']
            logger.info(f"Received webhook verification challenge: {challenge}")
            return {
                "smartsheetHookResponse": challenge
            }
        
        # Process events
        events = callback_data.get('events', [])
        webhook_id = callback_data.get('webhookId')
        scope_object_id = callback_data.get('scopeObjectId')
        
        logger.info(f"Processing {len(events)} webhook events for webhook {webhook_id}")
        
        processed_count = 0
        for event_data in events:
            try:
                # Create event object
                event = WebhookEvent(
                    event_id=event_data.get('id', f"{time.time()}"),
                    event_type=event_data.get('eventType', 'unknown'),
                    object_type=event_data.get('objectType', 'unknown'),
                    object_id=event_data.get('objectId', 0),
                    scope_object_id=scope_object_id,
                    user_id=event_data.get('userId'),
                    timestamp=datetime.fromisoformat(event_data.get('timestamp', datetime.utcnow().isoformat())),
                    additional_details=event_data.get('additionalDetails', {}),
                    sheet_id=scope_object_id
                )
                
                # For row events, set row_id
                if event.object_type.lower() == 'row':
                    event.row_id = event.object_id
                
                # Store event in memory
                await self.event_store.add_event(event)
                processed_count += 1
                
                # Persist event to smartsheet_activity_log for audit trail
                try:
                    client = await get_supabase_client()
                    client.table('smartsheet_activity_log').insert({
                        'action': f'webhook_{event.event_type}',
                        'sheet_id': event.sheet_id,
                        'details': {
                            'object_type': event.object_type,
                            'object_id': event.object_id,
                            'smartsheet_user_id': event.user_id,
                            'row_id': event.row_id,
                            'webhook_event_id': event.event_id,
                            'additional_details': event.additional_details
                        },
                        'status': 'success'
                    }).execute()
                except Exception as db_err:
                    logger.warning(f"Failed to persist webhook event to DB: {db_err}")
                
            except Exception as e:
                logger.error(f"Error processing webhook event: {e}", exc_info=True)
        
        logger.info(f"Successfully processed {processed_count}/{len(events)} webhook events")
        
        return {
            "status": "success",
            "processed_events": processed_count,
            "total_events": len(events)
        }
    
    async def register_webhook(self, sheet_id: int, callback_url: str,
                              events: List[str] = None) -> Dict[str, Any]:
        """
        Register a webhook for a Smartsheet.
        
        Args:
            sheet_id: Smartsheet ID to monitor
            callback_url: URL to receive webhook callbacks
            events: List of event types to subscribe to (default: all)
            
        Returns:
            Webhook registration result
        """
        try:
            smartsheet_service = await get_smartsheet_service()
            
            # Default to all events if not specified
            if not events:
                events = ["*.created", "*.updated", "discussion.created", "comment.created"]
            
            # Create webhook using Smartsheet SDK
            # Note: This is a placeholder - actual implementation would use Smartsheet SDK
            webhook_data = {
                "name": f"Ticket System Webhook - Sheet {sheet_id}",
                "callbackUrl": callback_url,
                "scope": "sheet",
                "scopeObjectId": sheet_id,
                "events": events,
                "version": 1
            }
            
            # Store webhook ID
            webhook_id = sheet_id  # Placeholder
            self._registered_webhooks[sheet_id] = webhook_id
            
            logger.info(f"Registered webhook {webhook_id} for sheet {sheet_id}")
            
            return {
                "success": True,
                "webhook_id": webhook_id,
                "sheet_id": sheet_id,
                "callback_url": callback_url,
                "events": events
            }
            
        except Exception as e:
            logger.error(f"Failed to register webhook for sheet {sheet_id}: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def unregister_webhook(self, webhook_id: int) -> bool:
        """
        Unregister a webhook.
        
        Args:
            webhook_id: Webhook ID to unregister
            
        Returns:
            True if successful
        """
        try:
            # Remove from tracking
            sheet_id = next((k for k, v in self._registered_webhooks.items() if v == webhook_id), None)
            if sheet_id:
                del self._registered_webhooks[sheet_id]
            
            logger.info(f"Unregistered webhook {webhook_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to unregister webhook {webhook_id}: {e}")
            return False
    
    async def get_events_for_ticket(self, row_id: int, since: Optional[datetime] = None,
                                   limit: int = 50) -> List[WebhookEvent]:
        """
        Get events for a specific ticket.
        
        Args:
            row_id: Ticket row ID
            since: Get events since this timestamp (optional)
            limit: Maximum number of events to return
            
        Returns:
            List of events
        """
        if since:
            return await self.event_store.get_events_since(row_id, since)
        else:
            return await self.event_store.get_recent_events(row_id, limit)

    async def get_recent_ticket_updates(self, since: datetime, limit: int = 100) -> List[WebhookEvent]:
        """
        Get all recent ticket update events since a timestamp.
        
        Args:
            since: Timestamp to get events from
            limit: Maximum number of events to return (default 100)
            
        Returns:
            List of all webhook events since the given time
        """
        return await self.event_store.get_all_recent_events(since, limit=limit)


# Global webhook service instance
_webhook_service: Optional[WebhookService] = None


def get_webhook_service() -> WebhookService:
    """Get the global webhook service instance."""
    global _webhook_service
    if _webhook_service is None:
        _webhook_service = WebhookService()
    return _webhook_service


async def start_cleanup_task():
    """Start background task for cleaning up old events."""
    webhook_service = get_webhook_service()
    
    while True:
        try:
            await asyncio.sleep(3600)  # Run every hour
            await webhook_service.event_store.cleanup_old_events()
        except Exception as e:
            logger.error(f"Error in cleanup task: {e}")

# Created and developed by Jai Singh
