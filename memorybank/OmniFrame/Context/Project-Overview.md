---
tags:
  - type/context
  - status/active
created: 2026-04-09
updated: 2026-04-09
aliases: [project overview, project info]
---
# Project Overview — OneBoxFullStack

## Identity
- **Name:** OneBoxFullStack (package name: j-ai-mui)
- **Version:** 2.0.1
- **License:** See LICENSE file
- **Package Manager:** pnpm

## What It Does
Enterprise full-stack platform with SAP integration, featuring a modern React frontend backed by Rust microservices, a Python API layer, and Supabase for data persistence and authentication.

## Frontend Stack
| Technology | Purpose |
|-----------|---------|
| React 19 | UI framework |
| Vite 7 (SWC) | Build tool |
| TanStack Router | File-based routing |
| TanStack Query | Server state management |
| Zustand | Client state management |
| Radix UI + shadcn/ui | Component library |
| Tailwind CSS 4 | Styling |
| Zod v4 | Schema validation |
| React Hook Form | Form handling |
| Framer Motion | Animation |
| Recharts | Charts/visualization |
| React Three Fiber | 3D rendering |
| Konva / React Konva | Canvas drawing |
| Capacitor | iOS mobile app |

## Backend Services
| Service | Language | Purpose |
|---------|----------|---------|
| `api/` | Python | API gateway, auth, routing |
| `rust-ai-service` | Rust | Vision and inference processing |
| `rust-core-service` | Rust | Core business logic |
| `rust-dashboard-service` | Rust | Dashboard aggregation |
| `rust-mdm-service` | Rust | Master Data Management |
| `rust-streaming-service` | Rust | Real-time streaming |
| `rust-work-service` | Rust | Work order management |

## Infrastructure
| Technology | Purpose |
|-----------|---------|
| Supabase | Database (Postgres), Auth, Storage, Realtime |
| Redis | Caching (ioredis) |
| Bull | Job queue processing |
| Railway | Deployment platform |
| Docker | Containerization |
| GitHub Actions | CI/CD |

## Quality Toolchain
| Tool | Purpose |
|------|---------|
| ESLint | Linting |
| Prettier | Code formatting |
| Knip | Unused code detection |
| Husky + lint-staged | Pre-commit hooks |
| Vitest | Unit + integration testing |
| Playwright | E2E testing |

## Key Scripts
```bash
pnpm dev              # Start dev server
pnpm build            # TypeScript check + Vite build
pnpm test:unit        # Run unit tests
pnpm test:integration # Run integration tests
pnpm quality:check    # Full quality pipeline
pnpm lint             # ESLint with auto-fix
pnpm format           # Prettier formatting
```

## SAP Integration
The project includes a SAP RFC bridge (`OneBox_SAP_Bridge.*`) for connecting to SAP systems, available in C#, PowerShell, and HTA formats.

## Related
- [[Architecture]] — System architecture diagram
- [[Components]] — Component documentation index
