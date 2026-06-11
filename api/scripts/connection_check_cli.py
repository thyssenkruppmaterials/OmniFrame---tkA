#!/usr/bin/env python3
# Created and developed by Jai Singh
"""
Supabase Connection Check CLI (MANUAL OPERATION -- NOT A PYTEST TEST)

Renamed from test_connection.py to prevent accidental pytest collection.

Usage:
  python connection_check_cli.py
"""

import asyncio
import sys
import os
from pathlib import Path

# Add the api directory to Python path
api_dir = Path(__file__).parent.parent
sys.path.insert(0, str(api_dir))

async def test_connection():
    """Test database connection and basic operations"""
    try:
        from config.database import SupabaseConnection
        from config.settings import settings
        
        print("🔗 Testing Supabase Connection...")
        print(f"📍 Project URL: {settings.supabase_url}")
        
        # Test basic connection
        db = SupabaseConnection()
        client = db.client
        
        print("✅ Basic connection established")
        
        # Test database queries
        print("📊 Testing database queries...")
        
        # Test organization query
        org_result = client.table("organizations").select("id, name").limit(1).execute()
        if org_result.data:
            print(f"✅ Organizations table accessible: {len(org_result.data)} record(s)")
        else:
            print("⚠️  Organizations table appears empty")
        
        # Test outbound_to_data query  
        outbound_result = client.table("outbound_to_data").select("id, delivery, status").limit(5).execute()
        if outbound_result.data:
            print(f"✅ Outbound TO Data table accessible: {len(outbound_result.data)} record(s)")
            for record in outbound_result.data[:2]:
                print(f"   - Delivery: {record.get('delivery', 'N/A')}, Status: {record.get('status', 'N/A')}")
        else:
            print("⚠️  Outbound TO Data table appears empty")
            
        # Test delivery data query
        delivery_result = client.table("rr_all_deliveries").select("id, delivery, customer_name").limit(5).execute()
        if delivery_result.data:
            print(f"✅ Delivery Status table accessible: {len(delivery_result.data)} record(s)")
            for record in delivery_result.data[:2]:
                print(f"   - Delivery: {record.get('delivery', 'N/A')}, Customer: {record.get('customer_name', 'N/A')}")
        else:
            print("⚠️  Delivery Status table appears empty")
            
        print("\n🎉 All database connections successful!")
        print("🚀 FastAPI integration is ready to launch!")
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("💡 Make sure all dependencies are installed: pip install -r requirements.txt")
        
    except Exception as e:
        print(f"❌ Connection error: {e}")
        print("💡 Check your .env configuration and Supabase credentials")

def main():
    """Run connection tests"""
    print("🧪 OneBox AI Logistics FastAPI - Connection Test")
    print("=" * 50)
    asyncio.run(test_connection())

if __name__ == "__main__":
    main()

# Created and developed by Jai Singh
