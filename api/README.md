# OneBox AI Logistics FastAPI Integration

Advanced analytics and data processing API that complements the existing React/TypeScript frontend with Python-powered capabilities.

## Features

### 🔐 Authentication
- **Supabase JWT Integration**: Seamless compatibility with existing authentication
- **Role-Based Access Control**: Maintains existing RBAC and organization isolation
- **RLS Security**: Preserves all Row Level Security policies

### 📊 Analytics API (`/api/analytics/`)
- **Outbound Analytics**: Comprehensive metrics, throughput analysis, top materials
- **Delivery Status Summaries**: Executive-level insights and KPIs  
- **Performance Metrics**: Throughput, quality, and efficiency analysis
- **Trend Analysis**: Daily trends and comparative period analysis

### 📈 Reports API (`/api/reports/`)
- **Advanced Data Export**: CSV, Excel, JSON formats with filtering
- **Large Dataset Processing**: Efficient handling of bulk data exports
- **Background Report Generation**: Complex reports processed asynchronously
- **Custom Report Templates**: Predefined report configurations

## Architecture

```
api/
├── main.py                 # FastAPI application entry point
├── config/                 # Configuration management
│   ├── settings.py         # Pydantic settings with env support
│   └── database.py         # Supabase connection management
├── auth/                   # Authentication & authorization
│   └── supabase_auth.py    # JWT validation & user context
├── models/                 # Pydantic data models
│   ├── outbound.py         # Outbound operation models
│   └── delivery.py         # Delivery status models
├── services/               # Business logic layer
│   └── analytics.py        # Advanced analytics processing
├── routers/               # API endpoint definitions
│   ├── analytics.py       # Analytics endpoints
│   └── reports.py         # Reporting endpoints
└── utils/                 # Utility functions
    └── supabase_client.py # Database helpers
```

## Installation

1. **Install Dependencies**:
   ```bash
   cd api
   pip install -r requirements.txt
   ```

2. **Environment Configuration**:
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

3. **Run Development Server**:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

## Environment Variables

```bash
# Application
API_APP_NAME=OneBox AI Logistics API
API_DEBUG=true
API_HOST=localhost
API_PORT=8000

# Supabase (must match frontend config)
API_SUPABASE_URL=https://your-project.supabase.co
API_SUPABASE_ANON_KEY=your-anon-key
API_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Authentication
API_JWT_SECRET_KEY=your-jwt-secret
```

## Integration with Frontend

### Authentication Headers
The API expects the same Supabase JWT token used by the frontend:

```typescript
const token = supabase.auth.getSession().access_token;

const response = await fetch('/api/analytics/outbound/summary', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

### Example Frontend Integration

```typescript
// services/fastapi-client.ts
export class FastAPIClient {
  private baseURL = process.env.VITE_FASTAPI_URL || 'http://localhost:8000';
  
  async getOutboundAnalytics(dateFrom?: Date, dateTo?: Date) {
    const token = await this.getToken();
    const params = new URLSearchParams();
    
    if (dateFrom) params.append('date_from', dateFrom.toISOString());
    if (dateTo) params.append('date_to', dateTo.toISOString());
    
    const response = await fetch(
      `${this.baseURL}/api/analytics/outbound/summary?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.json();
  }
  
  private async getToken(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('No authentication token available');
    }
    return session.access_token;
  }
}
```

## Key Endpoints

### Analytics
- `GET /api/analytics/outbound/summary` - Comprehensive outbound metrics
- `GET /api/analytics/delivery-status/summary` - Delivery status insights
- `GET /api/analytics/performance/{metric_type}` - Performance metrics
- `GET /api/analytics/trends/daily` - Daily trend analysis

### Reports  
- `GET /api/reports/outbound/export` - Export outbound data
- `GET /api/reports/delivery-status/export` - Export delivery status
- `POST /api/reports/custom-report` - Generate custom reports
- `GET /api/reports/templates` - Available report templates

### Health Checks
- `GET /health` - Basic health check
- `GET /health/database` - Database connectivity
- `GET /health/auth` - Authentication system

## Development

### Adding New Endpoints

1. **Create Model** (if needed):
   ```python
   # models/new_feature.py
   from pydantic import BaseModel
   
   class NewFeatureResponse(BaseModel):
       data: str
       count: int
   ```

2. **Create Service**:
   ```python
   # services/new_feature.py
   class NewFeatureService:
       async def get_data(self, org_id: str):
           # Business logic here
           pass
   ```

3. **Create Router**:
   ```python
   # routers/new_feature.py
   from fastapi import APIRouter, Depends
   
   router = APIRouter()
   
   @router.get("/data")
   async def get_data(user: AuthenticatedUser = Depends(get_current_user)):
       # Endpoint logic
       pass
   ```

4. **Register Router**:
   ```python
   # main.py
   from .routers import new_feature
   app.include_router(new_feature.router, prefix="/api/new-feature")
   ```

## Production Deployment

### Docker
```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Docker Compose
```yaml
version: '3.8'
services:
  fastapi:
    build: ./api
    ports:
      - "8000:8000"
    environment:
      - API_SUPABASE_URL=${SUPABASE_URL}
      - API_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

## Security Considerations

- **JWT Validation**: All endpoints validate Supabase JWT tokens
- **Organization Isolation**: RLS policies ensure data segregation
- **Rate Limiting**: Consider implementing rate limiting for production
- **CORS**: Configured for frontend domain integration
- **Environment Variables**: Never commit secrets to version control

## Performance

- **Async Operations**: All database operations are asynchronous
- **Background Tasks**: Heavy processing uses FastAPI's background tasks
- **Caching**: Redis integration for performance optimization
- **Batch Processing**: Efficient handling of large datasets

## Monitoring

- **Health Endpoints**: Built-in health checks for monitoring
- **Logging**: Structured logging with configurable levels
- **Error Handling**: Comprehensive error handling and reporting
- **Metrics**: Ready for integration with monitoring solutions

This API extends the OneBox AI Logistics platform with advanced analytics and data processing capabilities while maintaining full compatibility with the existing architecture.

