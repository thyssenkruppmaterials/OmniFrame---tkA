"""
Setup script for registering Smartsheet webhooks.
Registers webhook for ticket sheet to enable real-time updates.
"""

import sys
import os
import asyncio
import logging

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

try:
    from api.services.webhook_service import get_webhook_service
    from api.config.settings import settings
except ImportError:
    from services.webhook_service import get_webhook_service
    from config.settings import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


async def register_ticket_webhook(callback_url: str):
    """
    Register webhook for the ticket sheet.
    
    Args:
        callback_url: Full callback URL for webhook (e.g., https://api.example.com/api/webhooks/smartsheet)
    """
    try:
        webhook_service = get_webhook_service()
        
        # Ticket sheet ID
        sheet_id = 2987059899748228
        
        # Events to subscribe to
        events = [
            "row.created",
            "row.updated",
            "discussion.created",
            "comment.created",
            "attachment.created"
        ]
        
        logger.info(f"Registering webhook for sheet {sheet_id}")
        logger.info(f"Callback URL: {callback_url}")
        logger.info(f"Events: {', '.join(events)}")
        
        result = await webhook_service.register_webhook(
            sheet_id=sheet_id,
            callback_url=callback_url,
            events=events
        )
        
        if result['success']:
            logger.info(f"✅ Webhook registered successfully!")
            logger.info(f"   Webhook ID: {result['webhook_id']}")
            logger.info(f"   Sheet ID: {result['sheet_id']}")
            logger.info("")
            logger.info("⚠️  IMPORTANT: Save the following webhook ID for future reference:")
            logger.info(f"   WEBHOOK_ID={result['webhook_id']}")
            logger.info("")
            logger.info("To verify webhook is receiving events:")
            logger.info(f"   GET {callback_url}/status")
            return result
        else:
            logger.error(f"❌ Failed to register webhook: {result.get('error')}")
            return None
            
    except Exception as e:
        logger.error(f"❌ Error setting up webhook: {str(e)}", exc_info=True)
        return None


async def unregister_webhook(webhook_id: int):
    """
    Unregister a webhook.
    
    Args:
        webhook_id: Webhook ID to unregister
    """
    try:
        webhook_service = get_webhook_service()
        
        logger.info(f"Unregistering webhook {webhook_id}")
        
        success = await webhook_service.unregister_webhook(webhook_id)
        
        if success:
            logger.info("✅ Webhook unregistered successfully!")
        else:
            logger.error("❌ Failed to unregister webhook")
            
        return success
        
    except Exception as e:
        logger.error(f"❌ Error unregistering webhook: {str(e)}", exc_info=True)
        return False


def main():
    """Main execution function."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Manage Smartsheet webhooks for ticketing system')
    parser.add_argument('action', choices=['register', 'unregister'], help='Action to perform')
    parser.add_argument('--callback-url', help='Callback URL for webhook registration')
    parser.add_argument('--webhook-id', type=int, help='Webhook ID for unregistration')
    
    args = parser.parse_args()
    
    logger.info("=" * 60)
    logger.info("Smartsheet Webhook Setup Utility")
    logger.info("=" * 60)
    logger.info("")
    
    if args.action == 'register':
        if not args.callback_url:
            logger.error("❌ --callback-url is required for registration")
            logger.info("")
            logger.info("Example usage:")
            logger.info("  python setup_smartsheet_webhook.py register \\")
            logger.info("    --callback-url https://your-api.com/api/webhooks/smartsheet")
            sys.exit(1)
        
        result = asyncio.run(register_ticket_webhook(args.callback_url))
        
        if result:
            sys.exit(0)
        else:
            sys.exit(1)
    
    elif args.action == 'unregister':
        if not args.webhook_id:
            logger.error("❌ --webhook-id is required for unregistration")
            logger.info("")
            logger.info("Example usage:")
            logger.info("  python setup_smartsheet_webhook.py unregister --webhook-id 12345")
            sys.exit(1)
        
        success = asyncio.run(unregister_webhook(args.webhook_id))
        
        if success:
            sys.exit(0)
        else:
            sys.exit(1)


if __name__ == "__main__":
    main()

