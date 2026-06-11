---
tags: [type/debug, status/active, domain/frontend, domain/admin]
created: 2026-04-25
---
# Fix - SAP Testing & Performance Monitor Header Layout

## Purpose / Context
The SAP Testing page (`/admin/sap-testing`) and Performance Monitor page (`/admin/performance-monitor`) rendered a **custom inline `<header>`** rather than the canonical `<Header fixed>` + `<Main>` layout primitives the rest of the authenticated app uses (Dashboard, Permissions, Device Manager, Roles, Settings, Tasks, all `_authenticated/*` routes, etc.).

Visible symptoms:
- No `SidebarTrigger` button at the top-left, so users couldn't toggle the sidebar from these pages.
- No vertical `Separator` between the trigger and the search.
- Header was `sticky top-0` instead of `fixed` with the proper peer-class wiring, so the body offset and scroll-shadow behavior didn't match the other pages.
- `Search` was flush-left because there was no leading trigger + separator, breaking visual rhythm.

## Details
### Standard pattern (from `dashboard/index.tsx`, `permissions/index.tsx`, `device-manager/index.tsx`):
```tsx
<Header fixed>
  <Search />
  <div className='ml-auto flex items-center space-x-4'>
    <ThemeSwitch />
    <ProfileDropdown />
  </div>
</Header>

<Main>
  <div className='mb-2 flex flex-wrap items-center justify-between space-y-2'>
    <div>
      <h2 className='text-2xl font-bold tracking-tight'>{Title}</h2>
      <p className='text-muted-foreground'>{Description}</p>
    </div>
  </div>

  <div className='space-y-6'>
    {/* page content */}
  </div>
</Main>
```

`Header` (in `src/components/layout/header.tsx`) injects the `SidebarTrigger`, the vertical `Separator`, and when `fixed` is set, adds the `header-fixed peer/header` class so `Main`'s `peer-[.header-fixed]/header:mt-16` rule reserves the proper top offset and the scroll-shadow appears once the body scrolls > 10px.

### Files changed
- `src/features/admin/sap-testing/index.tsx` — replaced custom `<header>` + `<main>` with `<Header fixed>` + `<Main>`; reorganized the title/tab block to match the standard pattern.
- `src/features/admin/performance-monitor/index.tsx` — same swap; wrapped the page sections in a `<div className='space-y-6'>` so the cards keep their vertical rhythm now that `Main` provides padding instead of `flex-1 space-y-6 p-6` on a raw `<main>`.

### Verification
- `tsc --noEmit -p tsconfig.app.json` → 0 errors.
- `eslint` clean on both files.
- Other authenticated pages (~40 routes) already use `<Header fixed>` + `<Main>` and were not changed.
- `time-clock-kiosk/time-clock-kiosk.tsx` and `customer-portal/PublicHeader.tsx` use raw `<header>` intentionally — they live outside the authenticated app shell.
- `shift-productivity/settings/components/content-section.tsx` uses a `<header>` for an in-page section header (not a top bar) and is unrelated.

## Related
- [[ShiftProductivity - Feature Module]]
- [[Sessions/2026-04-25]]
