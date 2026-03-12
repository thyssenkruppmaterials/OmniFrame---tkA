# OmniFrame

Full-stack logistics management platform.

## Overview

OmniFrame is a multi-tenant warehouse management system (WMS) built with a
React/TypeScript frontend, a Python FastAPI backend, and a fleet of
high-performance Rust microservices. Data is stored in Supabase (PostgreSQL)
with Row Level Security for tenant isolation, and Redis handles caching and
real-time messaging.

## Architecture

The platform follows a three-tier architecture:

1. **Frontend** -- SPA served by Vite in development and by the FastAPI process
   in production. Communicates with the backend over REST and with Rust services
   for performance-critical paths.
2. **API Gateway** -- FastAPI application providing analytics, reports, SAP
   integration, and authentication passthrough. Serves the built frontend in
   production deployments.
3. **Microservices** -- Rust services (Axum) handling database queries, caching,
   work queues, streaming, and AI inference. Connected via REST and gRPC.

## Repository Layout

```
OmniFrame/
├── src/                       # React + TypeScript frontend (Vite, TanStack Router)
├── api/                       # Python FastAPI backend
├── rust-core-service/         # High-perf database queries, caching, JWT validation
├── rust-work-service/         # Work queue management
├── rust-ai-service/           # Drone image analysis (Hugging Face)
├── rust-streaming-service/    # Real-time WebSocket streaming
├── rust-dashboard-service/    # Dashboard statistics aggregation
├── rust-mdm-service/          # Master data management
├── supabase/                  # Database config and edge functions
├── ios/                       # iOS app (Capacitor + DJI drone plugin)
├── scripts/                   # Build and utility scripts
└── tests/                     # Integration tests
```

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, TanStack Router/Query, Zustand, shadcn/ui, Tailwind CSS
- **Backend:** Python FastAPI, Supabase (PostgreSQL + Auth + RLS)
- **Microservices:** Rust (Axum, sqlx, Redis)
- **Mobile:** Capacitor (iOS), DJI SDK integration
- **Infrastructure:** Docker, Railway

## Getting Started

### Prerequisites

- Node.js 20+ and pnpm
- Python 3.11+
- Rust 1.75+ (for microservices)
- A Supabase project (PostgreSQL + Auth)
- Redis instance

### Setup

```bash
# Clone and install frontend dependencies
pnpm install

# Copy environment template and fill in credentials
cp .env.example .env

# Install Python dependencies
pip install -r api/requirements.txt

# Start the development server (frontend)
pnpm dev

# Start the API server
python start.py
```

The frontend dev server runs on `http://localhost:5173` and the API on
`http://localhost:8000`.

## Services

| Service | Port | Description |
|---------|------|-------------|
| **Frontend** | 5173 | React SPA with TanStack Router |
| **FastAPI** | 8000 | Analytics, reports, SAP integration, auth |
| **rust-core-service** | 8010 | Compiled database queries, JWT validation, Redis caching |
| **rust-work-service** | 8020 | RF work queue orchestration |
| **rust-ai-service** | 8030 | Drone image analysis via Hugging Face models |
| **rust-streaming-service** | 8040 | WebSocket streaming for real-time updates |
| **rust-dashboard-service** | 8050 | Pre-aggregated dashboard statistics |
| **rust-mdm-service** | 8060 | Master data management and sync |

## Author

Developed and created by Jai Singh.

## License

MIT
