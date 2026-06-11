#!/usr/bin/env python3
# Created and developed by Jai Singh
"""
Apply schema migration to expand field sizes for GS1-128 data.
"""

import os
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

try:
    from dotenv import load_dotenv
    from supabase import create_client, Client
except ImportError:
    print("ERROR: Required packages not installed.")
    print("Please run: pip install python-dotenv supabase")
    sys.exit(1)

# Load environment variables
try:
    load_dotenv(encoding='utf-8')
except:
    pass

# Supabase connection
SUPABASE_URL = os.getenv("API_SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("API_SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("ERROR: Missing Supabase credentials")
    sys.exit(1)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

print("=" * 80)
print("Applying Schema Migration: Expand Fields for GS1-128 Data")
print("=" * 80)
print()

# Read migration file
migration_file = "supabase/migrations/013_expand_inbound_scans_fields_for_gs1128.sql"
with open(migration_file, 'r') as f:
    migration_sql = f.read()

# Remove comments for execution
sql_lines = []
for line in migration_sql.split('\n'):
    line = line.strip()
    if line and not line.startswith('--'):
        sql_lines.append(line)

# Execute migration
print("Executing migration...")
print()

try:
    # Step 1: Expand VARCHAR fields
    print("Step 1: Expanding VARCHAR fields (100 → 500 characters)...")
    varchar_sql = """
    ALTER TABLE rr_inbound_scans
    ALTER COLUMN tracking_number TYPE VARCHAR(500),
    ALTER COLUMN so_line_rma_afa TYPE VARCHAR(500),
    ALTER COLUMN material_number TYPE VARCHAR(500),
    ALTER COLUMN tka_batch_number TYPE VARCHAR(500),
    ALTER COLUMN barcode TYPE VARCHAR(500);
    """
    result = supabase.rpc('exec_sql', {'query': varchar_sql}).execute()
    print("✓ VARCHAR fields expanded successfully")
    print()
    
except Exception as e:
    # Try direct execution via postgrest
    print(f"Note: {e}")
    print("Attempting direct SQL execution...")
    print()

# For Supabase, we need to use the SQL editor or execute via psql
# Let's create a simpler approach using individual ALTER statements

sql_statements = [
    ("Expand tracking_number", "ALTER TABLE rr_inbound_scans ALTER COLUMN tracking_number TYPE VARCHAR(500)"),
    ("Expand so_line_rma_afa", "ALTER TABLE rr_inbound_scans ALTER COLUMN so_line_rma_afa TYPE VARCHAR(500)"),
    ("Expand material_number", "ALTER TABLE rr_inbound_scans ALTER COLUMN material_number TYPE VARCHAR(500)"),
    ("Expand tka_batch_number", "ALTER TABLE rr_inbound_scans ALTER COLUMN tka_batch_number TYPE VARCHAR(500)"),
    ("Expand barcode", "ALTER TABLE rr_inbound_scans ALTER COLUMN barcode TYPE VARCHAR(500)"),
    ("Expand quantity", "ALTER TABLE rr_inbound_scans ALTER COLUMN quantity TYPE NUMERIC(20,3)"),
]

print("Applying schema changes...")
print()

for description, sql in sql_statements:
    try:
        print(f"  {description}...", end=" ")
        # Note: Supabase Python client doesn't support DDL directly
        # We'll need to use the Supabase dashboard or CLI
        print("⚠️  (requires manual execution)")
    except Exception as e:
        print(f"✗ Error: {e}")

print()
print("=" * 80)
print("Migration SQL Ready")
print("=" * 80)
print()
print("⚠️  IMPORTANT: The Supabase Python client doesn't support DDL operations.")
print("Please apply the migration using ONE of these methods:")
print()
print("1. Supabase Dashboard SQL Editor:")
print("   - Go to: https://supabase.com/dashboard/project/wncpqxwmbxjgxvrpcake/sql")
print("   - Paste the contents of: supabase/migrations/013_expand_inbound_scans_fields_for_gs1128.sql")
print("   - Click 'Run'")
print()
print("2. Supabase CLI:")
print("   - Run: supabase db push")
print()
print("3. Direct psql connection:")
print("   - Use your database connection string")
print()
print("The migration file is ready at:")
print(f"  {migration_file}")
print()

if __name__ == "__main__":
    pass

# Created and developed by Jai Singh
