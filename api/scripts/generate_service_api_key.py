#!/usr/bin/env python3
"""
Generate secure API keys for service-to-service authentication.

This script generates cryptographically secure API keys for internal
microservice communication as part of the OmniFrame security infrastructure.

Usage:
    python generate_service_api_key.py --service rust-ai-service --description "AI Service auth key"
    python generate_service_api_key.py --service rust-ai-service --dry-run  # Preview without storing

Environment Variables Required (when not using --dry-run):
    SUPABASE_URL: Your Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY: Your Supabase service role key

Created: January 27, 2026
Part of: Comprehensive Authentication Security Overhaul - Phase 1
"""

import argparse
import hashlib
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone

# Service name to prefix mapping
SERVICE_PREFIXES = {
    "rust-ai-service": "ai",
    "rust-dashboard-service": "da",
    "python-api": "py",
    "frontend": "fe",
}

# Default permissions for known services
DEFAULT_PERMISSIONS = {
    "rust-ai-service": ["auth:validate", "auth:permissions"],
    "rust-dashboard-service": ["auth:validate", "stats:read"],
    "python-api": ["auth:validate", "auth:permissions", "admin:*"],
}


def generate_api_key(service_name: str) -> tuple[str, str, str]:
    """
    Generate a new API key with prefix, full key, and hash.
    
    Args:
        service_name: The name of the service (e.g., "rust-ai-service")
        
    Returns:
        Tuple of (prefix, full_key, key_hash)
    """
    # Get service short name for prefix
    service_short = SERVICE_PREFIXES.get(
        service_name,
        service_name.replace("rust-", "").replace("-service", "")[:2]
    )
    prefix = f"omnf_{service_short}_"
    
    # Ensure prefix is exactly 8 characters
    prefix = prefix[:8].ljust(8, "_")
    
    # Generate 32 random hex characters (16 bytes = 32 hex chars)
    random_part = secrets.token_hex(16)
    
    # Full key
    full_key = prefix + random_part
    
    # SHA-256 hash
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    
    return prefix, full_key, key_hash


def validate_service_name(service_name: str) -> bool:
    """Validate that the service name is in expected format."""
    if not service_name:
        return False
    # Allow known services or custom names with reasonable format
    if service_name in SERVICE_PREFIXES:
        return True
    # Custom service names should be alphanumeric with hyphens
    return all(c.isalnum() or c == "-" for c in service_name)


def print_key_info(service_name: str, full_key: str, prefix: str, key_hash: str):
    """Print the generated key information in a formatted way."""
    print(f"\n{'='*70}")
    print(f"Generated API Key for: {service_name}")
    print(f"{'='*70}")
    print()
    print("  \u26a0\ufe0f  IMPORTANT: Save this key securely. It cannot be retrieved later!")
    print()
    print(f"  API Key: {full_key}")
    print(f"  Prefix:  {prefix}")
    print(f"  Hash:    {key_hash[:16]}...{key_hash[-16:]}")
    print()
    print(f"{'='*70}")
    print()
    print("  Environment Variable Setup:")
    print(f"  RUST_CORE_API_KEY={full_key}")
    print()


def store_key_in_database(
    supabase_url: str,
    supabase_key: str,
    service_name: str,
    key_hash: str,
    prefix: str,
    description: str,
    permissions: list[str],
    rate_limit: int,
    expires_days: int | None
) -> dict:
    """Store the API key hash in the Supabase database."""
    try:
        from supabase import create_client
    except ImportError:
        print("\n\u274c Error: supabase package required.")
        print("  Install with: pip install supabase")
        sys.exit(1)
    
    client = create_client(supabase_url, supabase_key)
    
    expires_at = None
    if expires_days:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=expires_days)).isoformat()
    
    result = client.table("service_api_keys").insert({
        "service_name": service_name,
        "key_hash": key_hash,
        "key_prefix": prefix,
        "description": description,
        "permissions": permissions,
        "rate_limit_per_minute": rate_limit,
        "is_active": True,
        "expires_at": expires_at,
    }).execute()
    
    return result.data[0] if result.data else {}


def main():
    parser = argparse.ArgumentParser(
        description="Generate secure API keys for service-to-service authentication",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate a key for rust-ai-service (dry run):
  python generate_service_api_key.py --service rust-ai-service --dry-run

  # Generate and store a key with custom permissions:
  python generate_service_api_key.py \\
    --service rust-ai-service \\
    --description "AI Service production key" \\
    --permissions auth:validate auth:permissions \\
    --supabase-url https://your-project.supabase.co \\
    --supabase-key your-service-role-key

  # Generate a key that expires in 90 days:
  python generate_service_api_key.py \\
    --service rust-dashboard-service \\
    --expires-days 90 \\
    --supabase-url $SUPABASE_URL \\
    --supabase-key $SUPABASE_SERVICE_ROLE_KEY
        """
    )
    
    parser.add_argument(
        "--service",
        required=True,
        help="Service name (e.g., rust-ai-service, rust-dashboard-service, python-api)"
    )
    parser.add_argument(
        "--description",
        default="",
        help="Description of the key's purpose"
    )
    parser.add_argument(
        "--permissions",
        nargs="+",
        default=None,
        help="Permissions to grant (defaults based on service type)"
    )
    parser.add_argument(
        "--rate-limit",
        type=int,
        default=1000,
        help="Rate limit per minute (default: 1000)"
    )
    parser.add_argument(
        "--expires-days",
        type=int,
        default=None,
        help="Days until expiration (optional, default: never expires)"
    )
    parser.add_argument(
        "--supabase-url",
        default=os.getenv("SUPABASE_URL") or os.getenv("API_SUPABASE_URL"),
        help="Supabase URL (or set SUPABASE_URL env var)"
    )
    parser.add_argument(
        "--supabase-key",
        default=os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("API_SUPABASE_SERVICE_ROLE_KEY"),
        help="Supabase service role key (or set SUPABASE_SERVICE_ROLE_KEY env var)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print key without storing in database"
    )
    
    args = parser.parse_args()
    
    # Validate service name
    if not validate_service_name(args.service):
        print(f"\n\u274c Error: Invalid service name '{args.service}'")
        print("  Service name should be alphanumeric with hyphens (e.g., rust-ai-service)")
        sys.exit(1)
    
    # Use default permissions if not specified
    permissions = args.permissions
    if permissions is None:
        permissions = DEFAULT_PERMISSIONS.get(args.service, ["auth:validate"])
    
    # Generate the key
    prefix, full_key, key_hash = generate_api_key(args.service)
    
    # Print key information
    print_key_info(args.service, full_key, prefix, key_hash)
    
    if args.dry_run:
        print("  [DRY RUN] Key not stored in database.")
        print("  To store the key, run without --dry-run and provide Supabase credentials.")
        return
    
    # Validate required credentials for storage
    if not args.supabase_url:
        print("\n\u274c Error: Supabase URL required for storage.")
        print("  Set SUPABASE_URL environment variable or use --supabase-url")
        sys.exit(1)
    
    if not args.supabase_key:
        print("\n\u274c Error: Supabase service role key required for storage.")
        print("  Set SUPABASE_SERVICE_ROLE_KEY environment variable or use --supabase-key")
        sys.exit(1)
    
    # Store in database
    try:
        result = store_key_in_database(
            supabase_url=args.supabase_url,
            supabase_key=args.supabase_key,
            service_name=args.service,
            key_hash=key_hash,
            prefix=prefix,
            description=args.description or f"API key for {args.service}",
            permissions=permissions,
            rate_limit=args.rate_limit,
            expires_days=args.expires_days,
        )
        
        print(f"  \u2705 Key stored successfully!")
        print(f"     Key ID: {result.get('id', 'N/A')}")
        print(f"     Service: {result.get('service_name', args.service)}")
        print(f"     Permissions: {', '.join(permissions)}")
        if args.expires_days:
            print(f"     Expires: {args.expires_days} days from now")
        
    except Exception as e:
        print(f"\n\u274c Error storing key: {e}")
        print("\n  The key was generated but NOT stored.")
        print("  You can manually store it or try again.")
        sys.exit(1)


if __name__ == "__main__":
    main()
