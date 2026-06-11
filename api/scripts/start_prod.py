#!/usr/bin/env python3
# Created and developed by Jai Singh
"""
Production startup script for OneBox AI Logistics FastAPI
"""

import subprocess
import sys
import os
from pathlib import Path

def main():
    """Start the FastAPI production server"""
    print("🚀 Starting OneBox AI Logistics FastAPI Production Server...")
    print("📊 Analytics API: http://localhost:8000/api/analytics")
    print("📈 Reports API: http://localhost:8000/api/reports")
    print("📚 Documentation: http://localhost:8000/docs")
    print("🔧 Health Check: http://localhost:8000/health")
    
    # Change to api directory
    api_dir = Path(__file__).parent.parent
    os.chdir(api_dir)
    
    # Start production server with Gunicorn
    cmd = [
        "gunicorn",
        "main:app",
        "-w", "4",  # 4 worker processes
        "-k", "uvicorn.workers.UvicornWorker",
        "--bind", "0.0.0.0:8000",
        "--access-logfile", "-",
        "--error-logfile", "-",
        "--log-level", "info"
    ]
    
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        print("❌ Gunicorn not found. Install it with: pip install gunicorn")
        print("💡 For development, use: python scripts/start_dev.py")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to start production server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

# Created and developed by Jai Singh
