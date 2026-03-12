# Analytics API Edge Function

This Supabase Edge Function acts as a proxy to the FastAPI backend, forwarding all requests and returning responses.

## Configuration

### Required Environment Variable

- `FASTAPI_BACKEND_URL`: The base URL of your FastAPI backend
  - **Production**: `https://your-app.railway.app` (or your deployed URL)
  - **Local Development**: `http://host.docker.internal:8000` (to access local FastAPI from Edge Function)

### Setting the Environment Variable

**Via Supabase Dashboard:**
1. Go to your Supabase project settings
2. Navigate to Edge Functions → Environment Variables
3. Add `FASTAPI_BACKEND_URL` with your backend URL

**Via Supabase CLI:**
```bash
supabase secrets set FASTAPI_BACKEND_URL=https://your-app.railway.app
```

**For Local Development:**
Create a `.env` file in `supabase/`:
```
FASTAPI_BACKEND_URL=http://host.docker.internal:8000
```

## Deployment

### Deploy to Supabase

```bash
# Deploy the Edge Function
supabase functions deploy analytics-api

# Or deploy with environment variable inline
supabase functions deploy analytics-api --env-file supabase/.env
```

### Test Locally

```bash
# Start local Edge Function (requires FastAPI running on port 8000)
supabase functions serve analytics-api --env-file supabase/.env

# Test the endpoint
curl http://localhost:54321/functions/v1/analytics-api/api/health
```

## Usage

Once deployed, the Edge Function will be available at:
```
https://<your-project-ref>.supabase.co/functions/v1/analytics-api/api/...
```

All requests to this endpoint will be proxied to your FastAPI backend.

## Example Endpoints

- `GET /analytics-api/api/health` → Health check
- `GET /analytics-api/api/smartsheet/import/outbound-data` → Smart Import from Smartsheet
- `GET /analytics-api/api/analytics/outbound` → Outbound analytics
- `POST /analytics-api/api/reports/outbound/export` → Export reports

## Troubleshooting

If you get a configuration error:
1. Verify `FASTAPI_BACKEND_URL` is set in Supabase secrets
2. Check that your FastAPI backend is accessible from the Edge Function
3. Ensure your FastAPI backend allows CORS from Supabase domain

If requests fail:
1. Check Edge Function logs: `supabase functions logs analytics-api`
2. Verify FastAPI is running and accessible
3. Check network/firewall settings


