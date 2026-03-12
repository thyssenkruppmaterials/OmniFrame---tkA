# OmniFrame Logistics FastAPI - Installation Guide

## 🚀 Complete Installation & Setup

### 1. Prerequisites

```bash
# Python 3.8+ required
python --version

# Install Python dependencies
cd api
pip install -r requirements.txt
```

### 2. Environment Configuration

**Create `.env` file in the `api/` directory:**

```bash
# Copy configuration from env_config.txt
cp env_config.txt .env
```

**Your `.env` should contain:**
```bash
# FastAPI Configuration
API_APP_NAME=OmniFrame Logistics API
API_APP_VERSION=1.0.0
API_DEBUG=true
API_HOST=0.0.0.0
API_PORT=8000
API_RELOAD=true

# Supabase Configuration
API_SUPABASE_URL=<YOUR_SUPABASE_URL>
API_SUPABASE_ANON_KEY=<YOUR_SUPABASE_ANON_KEY>
API_SUPABASE_SERVICE_ROLE_KEY=<YOUR_SUPABASE_SERVICE_ROLE_KEY>

# Authentication
API_JWT_SECRET_KEY=<YOUR_JWT_SECRET_KEY>
API_JWT_ALGORITHM=HS256
API_ACCESS_TOKEN_EXPIRE_MINUTES=30

# Optional Features
API_REDIS_URL=redis://localhost:6379
API_LOG_LEVEL=INFO
```

### 3. Test Database Connection

```bash
cd api
python scripts/test_connection.py
```

**Expected Output:**
```
🧪 OmniFrame Logistics FastAPI - Connection Test
🔗 Testing Supabase Connection...
✅ Basic connection established
✅ Organizations table accessible: 1 record(s)
✅ Outbound TO Data table accessible: 895+ record(s)
✅ Delivery Status table accessible: 978+ record(s)
🎉 All database connections successful!
```

### 4. Start Development Server

```bash
cd api
python scripts/start_dev.py
```

**Server will start on:** `http://localhost:8000`

### 5. API Endpoints Available

#### 🔧 System Health
- **Health Check:** `GET /health`
- **API Documentation:** `GET /docs` (Swagger UI)
- **OpenAPI Schema:** `GET /openapi.json`

#### 📊 Analytics API (`/api/analytics/`)
- **Outbound Summary:** `GET /api/analytics/outbound/summary`
- **Delivery Analytics:** `GET /api/analytics/delivery/summary`
- **Performance Metrics:** `GET /api/analytics/performance/metrics`
- **Trend Analysis:** `GET /api/analytics/trends/daily`

#### 📈 Reports API (`/api/reports/`)
- **Export Outbound Data:** `GET /api/reports/outbound/export?format=csv|excel|json`
- **Export Delivery Data:** `GET /api/reports/delivery/export?format=csv|excel|json`
- **Generate Background Report:** `POST /api/reports/generate`

### 6. Authentication

**All API endpoints require valid Supabase JWT token:**

```bash
# Example API call with authentication
curl -X GET "http://localhost:8000/api/analytics/outbound/summary" \
  -H "Authorization: Bearer YOUR_SUPABASE_JWT_TOKEN"
```

**Get JWT Token from your React app:**
```javascript
// In your React component
const { data: session } = useSession();
const token = session?.access_token;

// Use token in API calls
fetch('http://localhost:8000/api/analytics/outbound/summary', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

### 7. Frontend Integration

**Update your React app to use FastAPI endpoints:**

```javascript
// Example: Fetch analytics data
const fetchAnalytics = async () => {
  try {
    const response = await fetch('http://localhost:8000/api/analytics/outbound/summary', {
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Analytics API error:', error);
  }
};
```

## 🎯 Verified Data Access

Your FastAPI integration has access to:
- **✅ 884 pending deliveries** in outbound_to_data
- **✅ 6 shipped deliveries** with full tracking
- **✅ 978 total delivery records** in rr_all_deliveries  
- **✅ Complete RBAC system** with organization isolation
- **✅ Real-time data** with RLS security preserved

## 🔐 Security Features

- **JWT Authentication:** Supabase token validation
- **RLS Preserved:** All Row Level Security policies maintained
- **Organization Isolation:** Data filtered by organization_id
- **RBAC Integration:** Role-based permissions enforced
- **CORS Configured:** React frontend integration ready

## 🚀 Production Deployment

```bash
# Install production server
pip install gunicorn

# Start production server
cd api
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

**Your FastAPI integration is now fully operational!** 🎉
