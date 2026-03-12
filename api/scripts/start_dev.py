#!/usr/bin/env python3
"""
Development startup script for OmniFrame Logistics FastAPI
"""

import uvicorn
import sys
import os
from pathlib import Path

# Add the api directory to Python path
api_dir = Path(__file__).parent.parent
sys.path.insert(0, str(api_dir))

def main():
    """Start the FastAPI development server"""
    print("🚀 Starting OmniFrame Logistics FastAPI Development Server...")
    print("📊 Analytics API will be available at: http://localhost:8000/api/analytics")
    print("📈 Reports API will be available at: http://localhost:8000/api/reports")
    print("📚 API Documentation: http://localhost:8000/docs")
    print("🔧 Health Check: http://localhost:8000/health")
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=[str(api_dir)],
        log_level="info"
    )

if __name__ == "__main__":
    main()
