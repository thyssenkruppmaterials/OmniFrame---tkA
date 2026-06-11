#!/usr/bin/env python3
# Created and developed by Jai Singh
"""
FastAPI Startup Check (MANUAL OPERATION -- NOT A PYTEST TEST)

Renamed from test_startup.py to prevent accidental pytest collection.

Usage:
  python startup_check.py
"""

import sys
import traceback

try:
    print("🧪 Testing FastAPI startup...")
    
    # Test basic imports
    print("📦 Testing imports...")
    import uvicorn
    from main import app
    print("✅ Imports successful")
    
    # Test app creation
    print("🏗️ Testing app creation...")
    print(f"✅ FastAPI app created: {type(app)}")
    
    # Test routes
    print("🛣️ Testing routes...")
    routes = [route.path for route in app.routes]
    print(f"✅ Found {len(routes)} routes:")
    for route in routes[:5]:  # Show first 5
        print(f"   - {route}")
    
    # Try to start server
    print("🚀 Starting test server on port 8001...")
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
    
except Exception as e:
    print(f"❌ Error: {e}")
    print("🔍 Full traceback:")
    traceback.print_exc()

# Created and developed by Jai Singh
