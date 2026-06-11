# OneBox AI Logistics - Multi-stage Docker Build
# Build timestamp: 2026-02-07T04:30:00Z - Added proxy router for attachment preview

# CRITICAL: Global ARGs must be declared BEFORE any FROM statement
# These are passed by Railway as build arguments
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL
ARG RAILWAY_PUBLIC_DOMAIN
ARG VITE_RUST_CORE_ENABLED
ARG VITE_RUST_CORE_URL
ARG VITE_WORK_SERVICE_URL
ARG VITE_WORK_SERVICE_WS_URL
ARG VITE_STREAMING_SERVICE_URL
# VITE_PRESENCE_MODE selects between the legacy Supabase Realtime presence
# implementation ('supabase', the default) and the Option-2 Rust presence
# implementation ('rust') backed by rust-work-service + Redis HSETs. Vite
# inlines this at build time, so it MUST be declared as ARG here for Railway
# to bridge the runtime variable into the Docker build context. See
# memorybank/OmniFrame/Decisions/ADR-Capacity-Ceiling-2k-Users.md.
ARG VITE_PRESENCE_MODE

# Stage 1: Build React frontend with Node.js
FROM node:20-alpine AS frontend-builder

# Re-declare ARGs within the build stage to use them
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL
ARG RAILWAY_PUBLIC_DOMAIN
ARG VITE_RUST_CORE_ENABLED
ARG VITE_RUST_CORE_URL
ARG VITE_WORK_SERVICE_URL
ARG VITE_WORK_SERVICE_WS_URL
ARG VITE_STREAMING_SERVICE_URL
ARG VITE_PRESENCE_MODE

WORKDIR /app

# Copy package files and install dependencies
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@9
RUN pnpm install --frozen-lockfile

# Set environment variables for the build
# These will be embedded into the frontend bundle during build
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=${VITE_API_URL:-https://$RAILWAY_PUBLIC_DOMAIN}
ENV VITE_RUST_CORE_ENABLED=${VITE_RUST_CORE_ENABLED:-true}
ENV VITE_RUST_CORE_URL=${VITE_RUST_CORE_URL:-https://rust-core-service-production.up.railway.app}
ENV VITE_WORK_SERVICE_URL=${VITE_WORK_SERVICE_URL:-https://rust-work-service-production.up.railway.app}
ENV VITE_WORK_SERVICE_WS_URL=${VITE_WORK_SERVICE_WS_URL:-wss://rust-work-service-production.up.railway.app/ws}
ENV VITE_STREAMING_SERVICE_URL=${VITE_STREAMING_SERVICE_URL:-https://rust-streaming-service-production.up.railway.app}
# Default 'supabase' matches src/lib/presence/constants.ts fallback; set this
# to 'rust' on Railway to activate Option-2 server-side presence.
ENV VITE_PRESENCE_MODE=${VITE_PRESENCE_MODE:-supabase}

# Copy source code AFTER setting environment variables
COPY . .

# Build frontend with environment variables available
RUN pnpm run frontend:build

# Stage 2: Python runtime with FastAPI backend
FROM python:3.11-slim AS runtime

WORKDIR /app

# Install system dependencies including build tools for pyrfc
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    make \
    git \
    && rm -rf /var/lib/apt/lists/*

# ========== SAP NW RFC SDK Setup ==========
# Set SAP NW RFC SDK environment variables BEFORE pip install
ENV SAPNWRFC_HOME=/usr/local/sap/nwrfcsdk
ENV LD_LIBRARY_PATH=/usr/local/sap/nwrfcsdk/lib:$LD_LIBRARY_PATH

# Create SAP SDK directory
RUN mkdir -p /usr/local/sap/nwrfcsdk

# Copy SAP NW RFC SDK (Linux version) - Optional
# Note: This folder must contain lib/ and include/ from the SAP SDK
# The folder exists in git with .gitkeep, actual SDK files are gitignored
COPY api/nwrfcsdk/ /usr/local/sap/nwrfcsdk/

# Configure SDK libraries if they exist (gracefully handle empty folder)
RUN if [ -d "/usr/local/sap/nwrfcsdk/lib" ]; then \
        ldconfig /usr/local/sap/nwrfcsdk/lib && \
        echo "SAP NW RFC SDK configured successfully"; \
    else \
        echo "SAP NW RFC SDK not found - SAP RFC features will be disabled"; \
    fi
# ==========================================

# Copy Python requirements and install dependencies (excluding pyrfc)
COPY api/requirements.txt ./api/requirements.txt

# Install Cython first (required for building pyrfc from source)
RUN pip install --no-cache-dir cython

# Install Python dependencies. This MUST fail the build loudly on any error.
# A previous "|| (grep -v pyrfc ...)" fallback here silently swallowed install
# failures and shipped broken images that crashed at startup (e.g. a partial
# smartsheet SDK -> "cannot import name 'Smartsheet' from 'smartsheet'
# (unknown location)" -> healthcheck failure). pyrfc is NOT in requirements.txt
# (it is installed separately below from GitHub), so no pyrfc fallback is needed.
RUN pip install --no-cache-dir -r api/requirements.txt

# Verify critical third-party SDKs actually imported cleanly so a corrupted or
# missing install becomes a hard BUILD failure instead of a runtime healthcheck
# failure that only surfaces after the image is already deployed.
RUN python -c "from smartsheet import Smartsheet; import smartsheet; print(f'smartsheet SDK OK ({smartsheet.__file__})')"

# Try to install pyrfc from GitHub (latest version with Python 3.11 support)
RUN pip install --no-cache-dir git+https://github.com/SAP/PyRFC.git || \
    echo "Warning: pyrfc installation failed - SAP RFC features will be unavailable"

# Copy Python backend code
COPY api ./api
COPY start.py ./

# Copy built frontend from previous stage
COPY --from=frontend-builder /app/dist ./dist

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

# Start the unified application
CMD ["python", "start.py"]
