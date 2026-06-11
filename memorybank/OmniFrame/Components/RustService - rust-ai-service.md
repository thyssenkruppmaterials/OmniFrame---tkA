---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# rust-ai-service (drone-ai-service)

## Purpose
Vision-model drone scan image analysis service for warehouse inventory. Uses vision models (Qwen3-VL-8B-Instruct via Hugging Face Inference API) to analyze drone-captured images, detecting text, barcodes, objects, inventory levels, and damage. Supports primary + fallback inference providers (Hugging Face primary, Novita fallback).

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | Public | Health check with DB and Inference provider status |
| POST | `/analyze` | JWT | Analyze a single drone image with selectable prompt type (warehouse/damage/barcode) |
| POST | `/analyze/batch` | JWT | Batch analyze multiple images |
| POST | `/process-pending` | JWT (service/admin) | Process pending scans from database |
| GET | `/status/:scan_id` | JWT | Get analysis status for a specific scan |

## Key Modules

| File | Role |
|------|------|
| `main.rs` | App bootstrap, router, CORS, state init. Port 8001 |
| `api/handlers.rs` | HTTP endpoint handlers with org-scoped access control |
| `ai/mod.rs` | Inference module re-exports (HuggingFace, Novita, prompts, fallback) |
| `ai/huggingface.rs` | Primary inference provider — Qwen3-VL-8B-Instruct via HF Inference API |
| `ai/novita.rs` | Fallback inference provider |
| `ai/prompts.rs` | Prompt templates (WAREHOUSE_ANALYSIS, DAMAGE_DETECTION, BARCODE_FOCUS) |
| `ai/fallback.rs` | InferenceService orchestrator with automatic fallback logic |
| `models/mod.rs` | Data models: AnalysisResult, DetectedText, DetectedBarcode, InventoryAssessment, etc. |
| `auth.rs` | JWT validation client — delegates to rust-core-service `/auth/validate-with-profile` |
| `middleware.rs` | Auth middleware (service API key or Bearer token) |
| `storage/mod.rs` | Supabase Storage client for image upload, signed URLs, deletion |

## Dependencies (Cargo.toml)
- **Web**: axum 0.7, tokio, tower-http (cors, trace)
- **Inference/HTTP**: reqwest 0.11 (json, multipart), base64, image
- **Database**: sqlx 0.7 (postgres, uuid, chrono, json)
- **Observability**: tracing, tracing-subscriber
- **Error Handling**: thiserror, anyhow
- **Retry**: backoff (with tokio feature)
- **Misc**: uuid, chrono, dotenvy, serde, serde_json

## Deployment
- **Port**: 8001 (configurable via `PORT` env)
- **Dockerfile**: Multi-stage Rust build
- **Railway**: Deployed as standalone service
- **Env vars**: `HUGGINGFACE_API_KEY`, `NOVITA_API_KEY` (optional), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RUST_CORE_URL`, `RUST_CORE_API_KEY`, `DATABASE_URL` (optional — REST API fallback if unavailable)

## Architecture Notes
- Database is optional — service degrades gracefully to REST API mode
- Auth delegated to rust-core-service (centralized JWT validation)
- Organization-scoped access: users can only access/process scans in their org
- Service accounts (`role: service`) bypass org restrictions
- Analysis results stored via `save_drone_scan_analysis` and `fail_drone_scan_analysis` RPC functions

## Related
- [[Architecture]]
- [[RustService - Core Service]]
- [[RustCore - Frontend Client]]