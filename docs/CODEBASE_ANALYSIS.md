# OneBox AI - Comprehensive Codebase Analysis Report

**Report Date:** February 8, 2026
**Version Analyzed:** 1.4.47
**Analysis Method:** Multi-agent automated code review (4 specialist agents)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Technology Stack](#technology-stack)
4. [Frontend Analysis](#frontend-analysis)
5. [Python Backend API Analysis](#python-backend-api-analysis)
6. [Rust Microservices Analysis](#rust-microservices-analysis)
7. [Infrastructure & DevOps](#infrastructure--devops)
8. [Security Assessment](#security-assessment)
9. [Testing & Quality Assurance](#testing--quality-assurance)
10. [Scorecard](#scorecard)
11. [Recommendations](#recommendations)

---

## Executive Summary

**OneBox AI** is a large-scale, enterprise-grade warehouse/facility management platform that combines a modern React frontend with a polyglot backend consisting of a Python FastAPI service and 5 Rust microservices, all backed by Supabase (PostgreSQL). The application handles warehouse operations (RF putaway, inventory, work orders), facility security (door access, visitor logging), labor management, AI-powered analytics, and real-time dashboards with streaming capabilities. It also supports mobile deployment via Capacitor (iOS).

### Overall Score: 6.6 / 10

| Category | Score | Weight |
|---|---|---|
| Frontend Architecture | 7.5/10 | 25% |
| Backend API | 6.5/10 | 25% |
| Rust Microservices | 6.0/10 | 20% |
| Infrastructure & DevOps | 5.5/10 | 15% |
| Security | 5.0/10 | 10% |
| Testing | 4.0/10 | 5% |
| **Weighted Overall** | **6.3/10** | |

---

## Architecture Overview

```
                         +-------------------+
                         |   Mobile (iOS)    |
                         |   Capacitor App   |
                         +--------+----------+
                                  |
                         +--------v----------+
                         |   React Frontend  |
                         |   (Vite + SPA)    |
                         |   Netlify CDN     |
                         +--------+----------+
                                  |
                    +-------------+-------------+
                    |                           |
           +--------v----------+    +-----------v-----------+
           |  Python FastAPI   |    |   Rust Microservices   |
           |  (Main API)       |    |   (Railway)            |
           |  Docker/Railway   |    |                        |
           +--------+----------+    |  +------------------+  |
                    |               |  | rust-ai-service   | |
                    |               |  | rust-core-service | |
           +--------v----------+    |  | rust-dashboard    | |
           |     Supabase      |    |  | rust-streaming    | |
           |   (PostgreSQL)    |<---+  | rust-work-service | |
           |   Auth + Storage  |    |  +------------------+  |
           +-------------------+    +------------------------+
                    |
           +--------v----------+
           |   External APIs   |
           |  SAP RFC, OpenAI  |
           |  Redis, etc.      |
           +-------------------+
```

### Key Business Domains

| Domain | Description |
|---|---|
| **Warehouse Operations** | RF Putaway, inventory management, pallet tracking, bin management |
| **Work Orders** | Creation, assignment, tracking, completion workflows |
| **Facility Security** | Door access control, visitor management, badge systems |
| **Labor Management** | Labor board, employee tracking, time management |
| **AI & Analytics** | AI-powered dashboards, inference engine, predictive analytics |
| **Real-Time Streaming** | Live data feeds, WebSocket connections, SSE streams |
| **SAP Integration** | RFC connections to SAP ERP for enterprise data sync |

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 19.1.0 | UI framework |
| TypeScript | 5.8.3 | Type safety |
| Vite | 7.3.1 | Build tool & dev server |
| TanStack Router | 1.129.0 | File-based routing |
| TanStack Query | 5.83.0 | Server state management |
| TanStack Table | 8.21.3 | Data tables |
| TanStack Virtual | 3.13.18 | Virtualized lists |
| Zustand | 5.0.6 | Client state management |
| Radix UI | Various | Headless UI primitives |
| Tailwind CSS | 4.1.11 | Utility-first CSS |
| Framer Motion | 12.23.12 | Animations |
| React Hook Form | 7.60.0 | Form management |
| Zod | 4.0.5 | Schema validation |
| Recharts | 3.1.0 | Data visualization |
| Axios | 1.10.0 | HTTP client |
| Capacitor | 7.4.4 | Native mobile bridge |
| date-fns | 4.1.0 | Date utilities |

### Backend (Python)
| Technology | Version | Purpose |
|---|---|---|
| FastAPI | Latest | Web framework |
| Supabase Python | - | Database client |
| PyRFC | - | SAP RFC integration |
| Redis/ioredis | - | Caching & queues |
| Pydantic | - | Data validation |
| Python | 3.x | Runtime |

### Backend (Rust)
| Technology | Purpose |
|---|---|
| Actix-Web | HTTP framework |
| Tokio | Async runtime |
| SQLx | Database queries |
| Reqwest | HTTP client |
| Serde | Serialization |
| jsonwebtoken | JWT auth |

### Infrastructure
| Technology | Purpose |
|---|---|
| Supabase | PostgreSQL + Auth + Storage + Realtime |
| Railway | Rust services deployment |
| Netlify | Frontend CDN/hosting |
| Docker | Containerization |
| Redis | Caching & job queues (Bull) |
| PWA | Progressive Web App support |

---

## Frontend Analysis

### Structure & Organization (Score: 8/10)

The frontend follows a well-organized feature-based architecture:

```
src/
  components/     # 57+ shared/reusable UI components
  features/       # 17 feature modules (domain-specific)
  hooks/          # 45 custom React hooks
  stores/         # 5 Zustand state stores
  context/        # 5 React context providers
  routes/         # TanStack Router file-based routes
  lib/            # 24+ utility/service modules
  middleware/     # Request/auth middleware
  providers/      # App-level providers
  config/         # App configuration
  workers/        # Web Workers
  assets/         # Static assets
```

**Statistics:**
- **57+** reusable UI components (shadcn/ui pattern)
- **17** feature modules
- **45** custom hooks
- **5** Zustand stores
- **5** context providers
- **24+** library/utility modules
- **67,000+** line generated route tree

### Feature Modules (17 identified)

| Feature | Description |
|---|---|
| `admin` | Administration panels |
| `ai` | AI chat, inference, analytics |
| `analytics` | Data analytics dashboards |
| `auth` | Authentication flows |
| `dashboard` | Main dashboard views |
| `door-access` | Door/badge access control |
| `facility-security` | Security monitoring |
| `inventory` | Inventory management |
| `labor-board` | Labor tracking/scheduling |
| `real-time` | Real-time data views |
| `reports` | Report generation |
| `rf-putaway` | RF scanner putaway workflow |
| `settings` | App settings |
| `visitor-log` | Visitor management |
| `work-orders` | Work order management |
| `yard-management` | Yard/dock management |
| `notifications` | Notification system |

### State Management Architecture (Score: 8/10)

The application employs a sophisticated multi-layered state management strategy:

1. **TanStack Query** - Server state (API data fetching, caching, sync)
2. **Zustand** - Client-side global state (UI state, user preferences, active selections)
3. **React Context** - Cross-cutting concerns (auth, theme, presence, notifications)
4. **React Hook Form + Zod** - Form state with runtime validation
5. **Component State** - Local UI state (useState/useReducer)

This is a well-thought-out approach that cleanly separates concerns.

### UI Component Library (Score: 8/10)

The project uses the **shadcn/ui** pattern with Radix UI primitives and Tailwind CSS:

- Well-organized `components/ui/` directory with ~30+ base components
- Consistent use of `class-variance-authority` for component variants
- `tailwind-merge` and `clsx` for className composition
- Comprehensive set: dialogs, dropdowns, tables, forms, tooltips, tabs, sliders, etc.
- Custom domain-specific components built on top of the base library

### Strengths
- Modern cutting-edge stack (React 19, Vite 7, Tailwind 4, TanStack latest)
- Clean feature-based architecture with good separation of concerns
- Sophisticated state management layering (Query + Zustand + Context)
- Comprehensive custom hooks library (45 hooks)
- shadcn/ui component system with consistent patterns
- Virtualization support (TanStack Virtual) for large datasets
- Animation support (Framer Motion)
- PWA capabilities
- Mobile-ready (Capacitor/iOS)

### Areas for Improvement
- Some components are very large (>500 lines) and could be split
- `routeTree.gen.ts` at 67,000+ lines suggests many routes - consider code splitting
- Limited use of React.lazy() for route-level code splitting
- Error boundary implementation could be more comprehensive
- Some hooks could benefit from better TypeScript generics
- Inconsistent file naming conventions in some areas
- Missing Storybook or component documentation

---

## Python Backend API Analysis

### Structure & Organization (Score: 7/10)

```
api/
  main.py          # FastAPI app entry point (~21K lines - very large)
  routers/         # 16 API router modules
  models/          # 9+ data models (Pydantic)
  services/        # 10+ service modules
  auth/            # Authentication logic
  middleware/      # Custom middleware
  config/          # App configuration
  lib/             # Shared libraries (SAP RFC)
  scripts/         # Operational/migration scripts
  utils/           # Utility functions
  docs/            # API documentation
```

### API Endpoints (16 Router Modules)

| Router | Endpoints | Domain |
|---|---|---|
| `auth` | Login, register, token refresh, session management | Authentication |
| `users` | CRUD, roles, permissions | User management |
| `inventory` | Items, bins, pallets, stock levels | Inventory |
| `work_orders` | Create, assign, track, complete | Work orders |
| `rf_putaway` | RF scanner flows, T.O. numbers, duplicate checks | Warehouse ops |
| `door_access` | Door control, badge management, access logs | Security |
| `visitor` | Check-in/out, visitor logs, filtering | Visitor mgmt |
| `labor` | Labor board, employee tracking | Labor |
| `dashboard` | KPIs, metrics, real-time stats | Analytics |
| `ai` | AI inference, chat, predictions | AI features |
| `reports` | Report generation, exports | Reporting |
| `sap` | SAP RFC integration, data sync | ERP integration |
| `admin` | System administration | Admin |
| `facility` | Facility management, zones | Facility |
| `notifications` | Push/in-app notifications | Notifications |
| `settings` | App/user settings | Configuration |

### Strengths
- FastAPI provides excellent auto-documentation (OpenAPI/Swagger)
- Clean router/service separation pattern
- Supabase integration for auth + database + storage
- SAP RFC integration for enterprise connectivity
- Rate limiting implementation (rate-limiter-flexible)
- Redis-based caching and Bull job queues
- Pydantic models for request/response validation
- Comprehensive endpoint coverage for all business domains

### Areas for Improvement
- **`main.py` is extremely large** (~21,000 lines) - needs significant refactoring
- `.env` file is present in the api/ directory (security risk)
- Some routers handle too many responsibilities
- Inconsistent error handling patterns across routers
- Limited input sanitization in some endpoints
- Missing request rate limiting on some sensitive endpoints
- No API versioning strategy
- Limited automated tests
- Some service methods are too long (>200 lines)
- Missing proper logging strategy (structured logging)
- No health check endpoint standardization
- Some direct database queries in routers (bypassing service layer)

---

## Rust Microservices Analysis

### Service Overview

#### 1. rust-ai-service (Score: 6.5/10)
**Purpose:** AI inference engine and ML model serving

| Aspect | Details |
|---|---|
| Framework | Actix-Web |
| Dependencies | tokio, reqwest, serde, jsonwebtoken |
| Features | AI model inference, prompt processing, response streaming |
| Deployment | Railway (Dockerfile + railway.toml) |

**Key files:** `src/main.rs`, `src/handlers/`, `src/models/`, `src/config.rs`

#### 2. rust-core-service (Score: 6.5/10)
**Purpose:** Core business logic, shared gRPC/REST APIs

| Aspect | Details |
|---|---|
| Framework | Actix-Web |
| Dependencies | tokio, sqlx, serde, actix-cors |
| Features | Core CRUD operations, auth middleware, database access |
| Build | Custom build.rs for proto compilation |
| Deployment | Railway |

**Key files:** `src/main.rs`, `src/handlers/`, `src/models/`, `src/middleware/`, `src/db/`

#### 3. rust-dashboard-service (Score: 5.5/10)
**Purpose:** Dashboard data aggregation and KPI computation

| Aspect | Details |
|---|---|
| Framework | Actix-Web |
| Dependencies | tokio, reqwest, serde |
| Features | Dashboard metrics, data aggregation, cached queries |
| Deployment | Railway |

**Notes:** Appears to be in earlier stage of development compared to other services.

#### 4. rust-streaming-service (Score: 6/10)
**Purpose:** Real-time data streaming via WebSockets and SSE

| Aspect | Details |
|---|---|
| Framework | Actix-Web + actix-web-actors |
| Dependencies | tokio, actix-ws, serde, reqwest |
| Features | WebSocket connections, Server-Sent Events, real-time presence |
| Deployment | Railway |

**Key features:** WebSocket session management, SSE endpoints, real-time event broadcasting.

#### 5. rust-work-service (Score: 6/10)
**Purpose:** Work order processing and task management

| Aspect | Details |
|---|---|
| Framework | Actix-Web |
| Dependencies | tokio, sqlx, serde, chrono |
| Features | Work order CRUD, task scheduling, assignment logic |
| Deployment | Railway |

### Cross-Service Assessment

**Strengths:**
- Microservice architecture provides good separation of concerns
- Consistent use of Actix-Web across all services
- Proper async/await patterns with Tokio
- Each service has its own Dockerfile and deployment config
- JWT-based authentication across services
- Environment-based configuration (.env.example files)
- Serde-based serialization is idiomatic

**Areas for Improvement:**
- No shared crate/library for common types, auth, error handling
- Services appear at different maturity levels (dashboard is minimal)
- No inter-service communication framework (no message bus, no gRPC between services)
- Missing health check standardization across services
- No distributed tracing (OpenTelemetry)
- No centralized logging
- Missing integration tests between services
- Some services have duplicated database access code
- No circuit breaker pattern for service-to-service calls
- Missing API gateway for unified entry point to Rust services

---

## Infrastructure & DevOps

### Deployment Architecture (Score: 5.5/10)

| Component | Platform | Config File |
|---|---|---|
| Frontend | Netlify | `netlify.toml` |
| Python API | Docker/Railway | `api/Dockerfile`, `railway.toml` |
| rust-ai-service | Railway | `rust-ai-service/railway.toml` |
| rust-core-service | Railway | `rust-core-service/railway.toml` |
| rust-dashboard-service | Railway | `rust-dashboard-service/railway.toml` |
| rust-streaming-service | Railway | `rust-streaming-service/railway.toml` |
| rust-work-service | Railway | `rust-work-service/railway.toml` |
| Database | Supabase | `supabase/` directory |

### Build System (Score: 7/10)

- **Vite 7.3** for frontend bundling (cutting-edge, fast)
- **TypeScript 5.8** with separate configs for app/node
- **SWC** via `@vitejs/plugin-react-swc` (faster than Babel)
- **TanStack Router Plugin** for file-based route generation
- **PWA Plugin** for service worker generation

### Code Quality Tools (Score: 7/10)

| Tool | Purpose | Status |
|---|---|---|
| ESLint 9 | Linting | Configured (flat config) |
| Prettier | Formatting | Configured with Tailwind plugin |
| TypeScript | Type checking | Strict mode |
| Knip | Dead code detection | Configured |
| commitizen (cz) | Commit conventions | `cz.yaml` present |

### CI/CD (Score: 3/10)

- **No visible CI/CD pipeline configuration** (no `.github/workflows/`, no `.gitlab-ci.yml`)
- Deployment appears to be manual or platform-managed (Railway auto-deploy, Netlify auto-deploy)
- No automated test runs in pipeline
- No build verification before deploy
- No staging environment visible

### Package Management (Score: 5/10)

- **Dual lock files detected:** Both `pnpm-lock.yaml` AND `package-lock.json` exist
- This indicates inconsistent package manager usage (pnpm vs npm)
- Should standardize on one (pnpm recommended)
- `node_modules_old/` directory exists (should be gitignored/removed)

### Mobile Support (Score: 6/10)

- Capacitor 7.4.4 configured for iOS
- `ios/` directory present with Xcode project
- `capacitor.config.ts` configured
- No Android support visible

### Database (Score: 7/10)

- Supabase with migrations in `supabase/` directory
- Real-time subscriptions support
- Row-level security (RLS) policies
- Storage integration for file uploads
- Edge Functions support

---

## Security Assessment

### Overall Security Score: 5.0/10

### Critical Issues

| Severity | Issue | Location |
|---|---|---|
| **HIGH** | `.env` file committed to repository | `api/.env` |
| **HIGH** | Potential secrets exposure in config files | Various `.env.example` files |
| **MEDIUM** | CORS appears overly permissive in development | `api/main.py` |
| **MEDIUM** | No API rate limiting on all endpoints | Various routers |
| **MEDIUM** | No Content Security Policy headers visible | Frontend |
| **LOW** | No HTTPS enforcement visible in config | Deployment configs |
| **LOW** | Missing security headers (X-Frame-Options, etc.) | API responses |

### Authentication & Authorization
- Supabase Auth for user authentication (good)
- JWT token-based sessions
- Role-based access control implemented
- Session management present
- Missing: MFA support, account lockout policies, token rotation

### Data Protection
- Supabase RLS provides row-level security
- Missing: Data encryption at rest configuration visibility
- Missing: PII handling policies
- Missing: Audit logging for sensitive operations

---

## Testing & Quality Assurance

### Overall Testing Score: 4.0/10

| Test Type | Status | Coverage |
|---|---|---|
| Unit Tests | Minimal | `src/__tests__/` - few files |
| Integration Tests | Not found | N/A |
| E2E Tests | Not found | N/A |
| API Tests | Minimal | `api/test_startup.py` only |
| Rust Tests | Not found | No test modules visible |
| Load Tests | Evidence exists | `load_test_logs/` directory |

### Test Infrastructure
- **Vitest** configured as test runner (devDependency)
- **@vitest/ui** available for interactive test viewing
- **@faker-js/faker** available for test data generation
- Despite having test infrastructure, **actual test coverage appears very low**

### Recommendations for Testing
1. Add unit tests for all custom hooks (45 hooks untested)
2. Add integration tests for API endpoints
3. Add E2E tests with Playwright or Cypress
4. Add Rust unit tests with `#[cfg(test)]` modules
5. Set up code coverage reporting
6. Add pre-commit hooks to run tests

---

## Scorecard

### Detailed Scoring Matrix

| Category | Score | Grade | Notes |
|---|---|---|---|
| **Frontend Architecture** | 7.5/10 | B+ | Modern stack, well-organized, some large components |
| **Frontend UI/UX Patterns** | 8.0/10 | A- | Excellent component library, consistent design system |
| **Frontend State Management** | 8.0/10 | A- | Sophisticated multi-layer approach |
| **Backend API Design** | 6.5/10 | C+ | Good coverage but main.py is monolithic |
| **Backend Code Quality** | 6.0/10 | C | Inconsistent patterns, some anti-patterns |
| **Rust Services Architecture** | 6.0/10 | C | Good separation, immature services |
| **Rust Code Quality** | 6.5/10 | C+ | Decent Rust patterns, missing shared code |
| **Database Design** | 7.0/10 | B | Supabase with RLS, migrations present |
| **Security** | 5.0/10 | D | Critical: .env committed, CORS issues |
| **Testing** | 4.0/10 | D- | Near-zero test coverage |
| **CI/CD** | 3.0/10 | F | No pipeline visible |
| **Documentation** | 5.5/10 | D+ | Some docs exist but incomplete |
| **DevOps/Infrastructure** | 6.0/10 | C | Multi-platform deploy, no unified approach |
| **Performance Optimization** | 7.0/10 | B | Virtualization, streaming, caching present |
| **Scalability** | 6.5/10 | C+ | Microservices help, but no auto-scaling visible |
| **Code Maintainability** | 6.0/10 | C | Feature-based helps, but large files hurt |

### Summary by Tier

```
  EXCELLENT (8-10)  ████████░░  Frontend UI patterns, State management
  GOOD (6-7.9)      ██████░░░░  Frontend arch, DB, Performance, Rust code
  NEEDS WORK (4-5.9) ████░░░░░░  Security, Backend quality, Infra, Docs
  CRITICAL (<4)      ██░░░░░░░░  Testing, CI/CD
```

---

## Recommendations

### Priority 1: Critical (Address Immediately)

1. **Remove `.env` from version control**
   - Add `api/.env` to `.gitignore`
   - Rotate all exposed secrets/API keys
   - Use environment variables or a secrets manager

2. **Add CI/CD Pipeline**
   - GitHub Actions for: lint, type-check, test, build
   - Automated deployment gates
   - Branch protection rules

3. **Increase Test Coverage**
   - Target: 60%+ unit test coverage within 3 months
   - Add API endpoint integration tests
   - Add critical path E2E tests

### Priority 2: High (Next Sprint)

4. **Refactor `api/main.py`**
   - Split the 21K-line file into proper modules
   - Extract middleware, startup events, route registration
   - Target: main.py under 200 lines

5. **Standardize Package Manager**
   - Remove either `pnpm-lock.yaml` or `package-lock.json`
   - Add `.npmrc` or equivalent to enforce one manager
   - Clean up `node_modules_old/`

6. **Security Hardening**
   - Add security headers middleware
   - Implement Content Security Policy
   - Add rate limiting to all API endpoints
   - Review and restrict CORS settings

### Priority 3: Medium (This Quarter)

7. **Create Shared Rust Crate**
   - Extract common types, auth, errors into a shared workspace crate
   - Reduce code duplication across Rust services

8. **Add Distributed Tracing**
   - Implement OpenTelemetry across all services
   - Add structured logging (JSON format)
   - Set up centralized log aggregation

9. **API Versioning**
   - Implement `/api/v1/` prefix pattern
   - Add deprecation headers for old endpoints

10. **Component Optimization**
    - Break large components (>500 lines) into smaller pieces
    - Add React.lazy() for route-level code splitting
    - Add comprehensive error boundaries

### Priority 4: Low (Backlog)

11. **Documentation**
    - Add Storybook for component documentation
    - Generate API documentation from OpenAPI spec
    - Add architecture decision records (ADRs)
    - Add onboarding documentation

12. **Add Android Support**
    - Extend Capacitor configuration for Android
    - Test cross-platform compatibility

13. **Service Mesh / API Gateway**
    - Add unified entry point for Rust microservices
    - Implement circuit breaker patterns
    - Add service discovery

14. **Performance Monitoring**
    - Add Real User Monitoring (RUM)
    - Add Application Performance Monitoring (APM)
    - Set up alerting for performance regressions

---

## Conclusion

OneBox AI is an **ambitious, feature-rich** enterprise application with a modern technology stack. The frontend is the strongest aspect, leveraging cutting-edge React 19 with an excellent state management strategy. The polyglot backend (Python + Rust) provides flexibility but introduces complexity in maintenance and deployment.

The most pressing concerns are **security** (committed .env, missing headers), **testing** (near-zero coverage), and **CI/CD** (no pipeline). The backend Python API needs significant refactoring to break the monolithic `main.py`. The Rust microservices show promise but need maturation and better inter-service patterns.

With focused effort on the critical priorities above, this application could move from a **6.3/10 to an 8+/10** within 2-3 development cycles.

---

*Report generated by Claude Code multi-agent analysis team*
*Agents: frontend-analyst, backend-analyst, rust-analyst, infra-analyst*
