# OmniFrame Rust Core Service - Development Startup Script
# Run this script to start the Rust core service locally

Write-Host "🚀 Starting OmniFrame Rust Core Service..." -ForegroundColor Cyan

# Set environment variables
$env:DATABASE_URL = "postgres://postgres:<YOUR_DATABASE_PASSWORD>@db.<YOUR_SUPABASE_PROJECT_REF>.supabase.co:5432/postgres"
$env:REDIS_URL = "redis://:<YOUR_REDIS_PASSWORD>@<YOUR_REDIS_HOST>:<YOUR_REDIS_PORT>/0"
$env:SUPABASE_URL = "https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co"
$env:SUPABASE_JWT_SECRET = "<YOUR_JWT_SECRET>"
$env:PORT = "8010"
$env:GRPC_PORT = "8011"
$env:RUST_LOG = "info,rust_core_service=debug,tower_http=debug,sqlx=warn"

Write-Host "📊 API will be available at: http://localhost:8010/api/v1" -ForegroundColor Green
Write-Host "🔐 Auth validation: http://localhost:8010/api/v1/auth/validate" -ForegroundColor Green
Write-Host "❤️ Health check: http://localhost:8010/api/v1/health" -ForegroundColor Green
Write-Host "📈 Metrics: http://localhost:8010/metrics" -ForegroundColor Green
Write-Host ""

# Run the service
cargo run --release
