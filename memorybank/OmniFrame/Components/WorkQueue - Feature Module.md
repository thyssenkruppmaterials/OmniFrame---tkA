---
tags: [type/component, status/active, domain/frontend, domain/admin]
created: 2026-04-10
---
# Work Queue Management

## Purpose
Intelligent work queue administration interface for monitoring and managing background task processing. Provides real-time metrics, worker lifecycle management, task prioritization, analytics dashboards, and queue configuration. Designed for admin users to oversee the system's asynchronous job processing infrastructure.

## Key Components
- **WorkQueueAdministration** (`index.tsx`) — Main page wrapped in `WorkQueueProvider`, 5-tab layout using shadcn `Tabs`
- **QueueOverview** — Dashboard with queue depth, pending/assigned/in-progress/completed/failed counts, priority and type breakdowns
- **WorkerMonitor** — Worker pool management — view active workers, utilization rates, health status
- **TaskManager** — Task lifecycle management — view, filter, retry, cancel, and reprioritize individual tasks
- **AnalyticsDashboard** — Queue throughput analytics, completion rates, bottleneck identification, SLA compliance metrics
- **ConfigurationPanel** — Queue behavior configuration — concurrency limits, retry policies, priority weights, timeout settings

## State Management
- **WorkQueueProvider** (`context/work-queue-context.tsx`) — React Context providing:
  - `SimpleQueueStats` — Aggregate queue metrics (pending, assigned, in-progress, completed/failed today, avg completion time, worker utilization, depth by priority/type)
  - `SimpleRealTimeMetrics` — Live metrics (queue depth, tasks/min, wait time, utilization, completion rate, error rate, SLA compliance, bottlenecks)
  - `SimpleBottleneckAnalysis` — Identified bottlenecks with severity, affected tasks, recommended actions, health score
  - `SimpleWorkQueueTask` — Individual task data (id, title, description, status, priority, type, assigned worker, timestamps)
  - State updates via `useState` with simulated data generation
  - Toast notifications via `sonner` for queue events
  - Logger utility for operation tracking
- Also has a simplified context variant: `work-queue-context-simple.tsx` for reduced TypeScript complexity

## Architecture Notes
- Uses 5-column `TabsList` grid layout (Overview, Workers, Tasks, Analytics, Config)
- Context provides both stats aggregation and individual task management
- Bottleneck analysis includes severity classification and recommended actions
- Queue depth tracked by both priority level and task type
- Real-time metrics include SLA compliance percentage
- Currently uses simulated data; designed for future backend integration

## Related
- [[Architecture]]
- [[SystemSettings - Feature Module]]
- [[ShiftProductivity - Feature Module]]