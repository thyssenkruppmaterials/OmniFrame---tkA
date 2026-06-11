---
tags: [type/component, status/active, domain/frontend, domain/realtime]
created: 2026-05-06
---

# Component: NotificationsPanel

Top-right bell-icon + popover for server-pushed notifications. Implements the user-facing surface of [[Implement-Notifications-Panel-Tier2-2]].

## Location

- Component: `src/components/notifications/notifications-panel.tsx`
- Backing hook: `src/hooks/use-notifications.ts`
- Mount point: `src/components/layout/authenticated-layout.tsx` (top-right action bar above the breadcrumbs).

## Surface

```tsx
import { NotificationsPanel } from '@/components/notifications/notifications-panel'

<NotificationsPanel />
```

Zero props — the component reads `useNotifications()` internally.

## Behaviour

- **Bell icon** — Lucide `Bell` (size-4) in a ghost button.
- **Unread badge** — small red pill in the top-right of the icon when `unreadCount > 0`. Clamped at `99+`.
- **Popover** — opens on click, 360px wide, scrollable list of latest 50 notifications.
- **Each row**:
  - Severity icon (`Info` / `AlertCircle` / `XCircle` / `CheckCircle2`) + severity colour.
  - Title (bold when unread, normal when read) + small blue dot when unread.
  - Body (clamped to 2 lines).
  - Relative time via `formatDistanceToNow` (date-fns).
  - Click → optimistic mark-read + (if `link` set) `navigate({ to: link })` + close popover.
- **"Mark all read" button** — top-right of the popover, only when `unreadCount > 0`. Optimistic; fires `POST /api/v1/notifications/read-all`.
- **Empty state** — Bell icon + "You're all caught up" + "New notifications appear here in real time."
- **Loading state** — spinner + "Loading…" while the bootstrap fetch is in flight AND no notifications are present yet.

## Backing hook (`useNotifications`)

Returns:

```ts
interface UseNotificationsReturn {
  notifications: NotificationRow[]   // newest-first
  unreadCount: number
  isLoading: boolean
  markRead: (id: string) => void     // optimistic
  markAllRead: () => void            // optimistic
  refresh: () => Promise<void>
}
```

- **Bootstrap on mount** via `GET /api/v1/notifications?unread_only=false&limit=50`.
- **5-min safety-net** refetch when the WS singleton is NOT connected (mirrors the `use-pushed-work` shape).
- **WS subscription** filters on `event.type === 'Notification' && event.user_id === currentUserId`.
- **Optimistic mutations** — server is best-effort. Failure logs but doesn't roll back; the next refresh re-syncs.
- **In-memory feed** is the single source of truth — no TanStack Query so there's no risk of a refetch clobbering an optimistic mark-read.

## Severity ↔ icon / colour mapping

| Severity | Icon | Colour (light / dark) |
|---|---|---|
| `info` | `Info` | `text-blue-500 / text-blue-400` |
| `warning` | `AlertCircle` | `text-amber-500 / text-amber-400` |
| `error` | `XCircle` | `text-red-500 / text-red-400` |
| `success` | `CheckCircle2` | `text-emerald-500 / text-emerald-400` |

When severity is `null` / unknown the row falls back to `info`.

## Producers

Backend services call `enqueue_notification(...)` from `api/services/notifications.py`. The helper:

- Dedups same `(user_id, kind)` within 60s in-process (per uvicorn worker).
- INSERTs into `public.notifications`; trigger fires `pg_notify('notification_created', ...)`.
- `rust-work-service::notifications_listener` picks it up and broadcasts `WsEvent::Notification`.
- The bell-icon receives the event within ~1s and the new row appears at the top of the popover.

Documented natural integration points (NOT all wired yet — see [[Implement-Notifications-Panel-Tier2-2]] for the catalogue):

- SAP agent terminal status (`sap_job_complete`, `sap_job_failed`)
- Reservation escalation (`reservation_escalated`)
- Ticket assignment (`ticket_assigned`, `ticket_replied`)
- Drone scan completion (`drone_scan_complete`)
- LT22 import run finish (`import_complete`)
- Cycle count requires recount (`recount_required`)

The `kind` strings above are NOT enforced by the schema — they're a convention for the backend producers. The FE doesn't switch on `kind` today (severity drives the icon); a future ratchet can add a kind→icon override map.

## Accessibility

- Bell button has `aria-label` reflecting unread count: `"Notifications (3 unread)"` / `"Notifications"`.
- Each row has `aria-label` carrying the title + read state.
- Popover is a Radix Popover (handles focus trap + escape).
- Loading and empty states are static (not announced via aria-live) — bell-row updates aren't urgent.

## Storage / persistence

- Backed by `public.notifications` (Postgres). No localStorage.
- 30-day cleanup is TODO (see [[Implement-Notifications-Panel-Tier2-2]] follow-ons).

## Quality gates

Inherited from [[Implement-Notifications-Panel-Tier2-2]] — see that note for the full results table.

## Related

- [[Implement-Notifications-Panel-Tier2-2]] — the implementation note (full architecture).
- [[Roadmap-Rust-WS-Unlocks]] — Tier 2 #2 source roadmap.
- [[Implement-Entity-Soft-Locking-Tier2-1]] — sibling Tier 2 surface.
- [[Components/PresenceUI - Status Indicators]] — sibling top-right component (presence panel).
