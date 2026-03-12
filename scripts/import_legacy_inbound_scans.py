#!/usr/bin/env python3
"""
Import legacy inbound scans from CSV into Supabase rr_inbound_scans table.

This script:
1. Reads the CSV file with legacy inbound scan data
2. Maps CSV columns to database columns
3. Transforms data (dates, user names to UUIDs, hot truck boolean)
4. Imports data in batches with error handling
5. Provides detailed logging and statistics

Usage:
    python scripts/import_legacy_inbound_scans.py

Requirements:
    pip install python-dotenv supabase pandas
"""

import os
import sys
import csv
import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from pathlib import Path
import re

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

try:
    from dotenv import load_dotenv
    from supabase import create_client, Client
    import pandas as pd
except ImportError:
    print("ERROR: Required packages not installed.")
    print("Please run: pip install python-dotenv supabase pandas")
    sys.exit(1)

# Load environment variables
try:
    load_dotenv(encoding='utf-8')
except UnicodeDecodeError:
    # Try with different encoding if UTF-8 fails
    try:
        load_dotenv(encoding='utf-16')
    except:
        print("WARNING: Could not load .env file, will use system environment variables")

# Configuration
CSV_FILE_PATH = os.getenv("LEGACY_CSV_PATH", "./data/legacy_inbound_scans.csv")
ORGANIZATION_ID = "c9d89a74-7179-4033-93ea-56267cf42a17"  # OmniFrame
BATCH_SIZE = 100  # Import in batches to avoid timeouts
DRY_RUN = False  # Set to True to test without actually importing

# Supabase connection
SUPABASE_URL = os.getenv("API_SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("API_SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("ERROR: Missing Supabase credentials in environment variables")
    print("Required: API_SUPABASE_URL and API_SUPABASE_SERVICE_ROLE_KEY")
    print("(or VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)")
    sys.exit(1)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# User name to UUID mapping (case-insensitive)
USER_MAPPING: Dict[str, str] = {}

# Statistics
stats = {
    "total_rows": 0,
    "successful_imports": 0,
    "failed_imports": 0,
    "skipped_rows": 0,
    "errors": []
}


def fetch_user_mapping() -> Dict[str, str]:
    """Fetch all users from Supabase and create case-insensitive name-to-ID mapping."""
    print("Fetching user profiles from Supabase...")
    
    try:
        response = supabase.table("user_profiles").select("id, full_name").execute()
        users = response.data
        
        # Create case-insensitive mapping
        mapping = {}
        for user in users:
            full_name = user["full_name"]
            user_id = user["id"]
            # Store both original and lowercase versions
            mapping[full_name.lower()] = user_id
            
        print(f"✓ Loaded {len(mapping)} user profiles")
        return mapping
        
    except Exception as e:
        print(f"ERROR: Failed to fetch user profiles: {e}")
        sys.exit(1)


def parse_datetime(date_str: str, time_str: str) -> Optional[str]:
    """
    Parse date and time strings into ISO 8601 timestamp.
    
    Args:
        date_str: Date in format "10/4/2025"
        time_str: Time in format "11:42:05"
    
    Returns:
        ISO 8601 formatted timestamp or None if parsing fails
    """
    try:
        # Combine date and time
        datetime_str = f"{date_str} {time_str}"
        # Parse with format MM/DD/YYYY HH:MM:SS
        dt = datetime.strptime(datetime_str, "%m/%d/%Y %H:%M:%S")
        # Convert to ISO 8601 format with timezone (assuming EST/EDT)
        return dt.isoformat() + "-05:00"  # EST offset
    except Exception as e:
        return None


def parse_hot_truck(value: str) -> bool:
    """Convert Hot Truck string value to boolean."""
    if not value:
        return False
    value_lower = value.strip().lower()
    return value_lower in ["hot", "true", "yes", "1"]


def get_user_id(name: str) -> Optional[str]:
    """Get user UUID from name (case-insensitive)."""
    if not name or not name.strip():
        return None
    
    name_lower = name.strip().lower()
    return USER_MAPPING.get(name_lower)


def is_valid_row(row: Dict[str, str]) -> bool:
    """
    Validate if a row has the minimum required data.
    
    Returns:
        True if row is valid, False otherwise
    """
    # Check if we have essential fields
    if not row.get("Material Number"):
        return False
    
    # Check if Scanned By is a valid name (not garbage data)
    scanned_by = row.get("Scanned By", "").strip()
    if not scanned_by:
        return False
    
    # Filter out obvious garbage (numeric-only, too long, special characters)
    if len(scanned_by) > 50:
        return False
    if scanned_by.isdigit():
        return False
    if not any(c.isalpha() for c in scanned_by):
        return False
    
    return True


def transform_row(row: Dict[str, str]) -> Optional[Dict]:
    """
    Transform a CSV row into database record format.
    
    Args:
        row: Dictionary with CSV column names as keys
    
    Returns:
        Dictionary ready for database insert or None if transformation fails
    """
    try:
        # Get user ID
        user_id = get_user_id(row.get("Scanned By", ""))
        if not user_id:
            stats["errors"].append({
                "row": row,
                "error": f"User not found: {row.get('Scanned By')}"
            })
            return None
        
        # Parse timestamp
        scanned_at = parse_datetime(row.get("Date", ""), row.get("Time", ""))
        if not scanned_at:
            stats["errors"].append({
                "row": row,
                "error": f"Invalid date/time: {row.get('Date')} {row.get('Time')}"
            })
            return None
        
        # Parse quantity
        try:
            quantity = float(row.get("Quantity", "0"))
        except (ValueError, TypeError):
            quantity = 0
        
        # Parse hot truck
        hot_truck = parse_hot_truck(row.get("Hot Truck", ""))
        
        # Build database record
        material_number = row.get("Material Number", "").strip()
        
        record = {
            "organization_id": ORGANIZATION_ID,
            "scanned_by": user_id,
            "scanned_at": scanned_at,
            "material_number": material_number,
            "barcode": material_number,  # Copy material_number to barcode for legacy compatibility
            "quantity": quantity,
            "tka_batch_number": row.get("TKA Batch Number", "").strip() or None,
            "so_line_rma_afa": row.get("SO/Line or RMA/AFA #", "").strip() or None,
            "tracking_number": row.get("Tracking Number", "").strip() or None,
            "hot_truck": hot_truck,
            "scan_location": None,  # Not in CSV
            "notes": "Imported from legacy CSV on " + datetime.now().strftime("%Y-%m-%d"),
        }
        
        return record
        
    except Exception as e:
        stats["errors"].append({
            "row": row,
            "error": str(e)
        })
        return None


def import_batch(records: List[Dict]) -> Tuple[int, int]:
    """
    Import a batch of records into Supabase.
    
    Args:
        records: List of database records to import
    
    Returns:
        Tuple of (successful_count, failed_count)
    """
    if DRY_RUN:
        print(f"  [DRY RUN] Would import {len(records)} records")
        return len(records), 0
    
    try:
        response = supabase.table("rr_inbound_scans").insert(records).execute()
        return len(records), 0
    except Exception as e:
        print(f"  ERROR: Batch import failed: {e}")
        # Try importing one by one to identify problematic records
        successful = 0
        failed = 0
        for record in records:
            try:
                supabase.table("rr_inbound_scans").insert(record).execute()
                successful += 1
            except Exception as e2:
                failed += 1
                stats["errors"].append({
                    "record": record,
                    "error": str(e2)
                })
        return successful, failed


def main():
    """Main import process."""
    print("=" * 80)
    print("Legacy Inbound Scans Import Script")
    print("=" * 80)
    print()
    
    if DRY_RUN:
        print("⚠️  DRY RUN MODE - No data will be imported")
        print()
    
    # Check if CSV file exists
    if not os.path.exists(CSV_FILE_PATH):
        print(f"ERROR: CSV file not found: {CSV_FILE_PATH}")
        sys.exit(1)
    
    print(f"CSV File: {CSV_FILE_PATH}")
    print(f"Organization ID: {ORGANIZATION_ID}")
    print(f"Batch Size: {BATCH_SIZE}")
    print()
    
    # Fetch user mapping
    global USER_MAPPING
    USER_MAPPING = fetch_user_mapping()
    print()
    
    # Read and process CSV
    print("Reading CSV file...")
    records_to_import = []
    
    try:
        with open(CSV_FILE_PATH, 'r', encoding='utf-8') as csvfile:
            reader = csv.DictReader(csvfile)
            
            for row_num, row in enumerate(reader, start=2):  # Start at 2 (header is row 1)
                stats["total_rows"] += 1
                
                # Validate row
                if not is_valid_row(row):
                    stats["skipped_rows"] += 1
                    continue
                
                # Transform row
                record = transform_row(row)
                if record:
                    records_to_import.append(record)
                else:
                    stats["failed_imports"] += 1
                
                # Progress indicator
                if stats["total_rows"] % 1000 == 0:
                    print(f"  Processed {stats['total_rows']} rows...")
        
        print(f"✓ Processed {stats['total_rows']} rows from CSV")
        print(f"  Valid records to import: {len(records_to_import)}")
        print(f"  Skipped rows: {stats['skipped_rows']}")
        print(f"  Failed transformations: {stats['failed_imports']}")
        print()
        
    except Exception as e:
        print(f"ERROR: Failed to read CSV file: {e}")
        sys.exit(1)
    
    # Import in batches
    if records_to_import:
        print(f"Importing {len(records_to_import)} records in batches of {BATCH_SIZE}...")
        
        for i in range(0, len(records_to_import), BATCH_SIZE):
            batch = records_to_import[i:i + BATCH_SIZE]
            batch_num = (i // BATCH_SIZE) + 1
            total_batches = (len(records_to_import) + BATCH_SIZE - 1) // BATCH_SIZE
            
            print(f"  Batch {batch_num}/{total_batches} ({len(batch)} records)...", end=" ")
            
            successful, failed = import_batch(batch)
            stats["successful_imports"] += successful
            stats["failed_imports"] += failed
            
            print(f"✓ {successful} imported, {failed} failed")
        
        print()
    
    # Print final statistics
    print("=" * 80)
    print("Import Complete!")
    print("=" * 80)
    print(f"Total rows processed:     {stats['total_rows']}")
    print(f"Successful imports:       {stats['successful_imports']}")
    print(f"Failed imports:           {stats['failed_imports']}")
    print(f"Skipped rows:             {stats['skipped_rows']}")
    print(f"Total errors:             {len(stats['errors'])}")
    print()
    
    # Save error log if there are errors
    if stats["errors"]:
        error_log_path = "import_errors.json"
        with open(error_log_path, 'w') as f:
            json.dump(stats["errors"], f, indent=2, default=str)
        print(f"⚠️  Error details saved to: {error_log_path}")
        print()
    
    if DRY_RUN:
        print("⚠️  This was a DRY RUN - no data was actually imported")
        print("   Set DRY_RUN = False in the script to perform actual import")
    
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nImport cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nFATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
