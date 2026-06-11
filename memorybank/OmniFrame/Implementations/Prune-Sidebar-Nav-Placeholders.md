---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-04-14
---
# Prune sidebar nav (Tasks, Business Apps, placeholders)
## Purpose / Context
Sidebar showed unfinished or redundant areas: Tasks, the whole Business Applications group (all routes were Coming Soon shells), Facility IT/Vendor links to full Coming Soon pages, and Intelligence Hub (both items Coming Soon).
## Details
- Edited `src/components/layout/data/sidebar-data.ts` (source for `getSidebarData` used by optimized sidebar, command palette, legacy sidebar).
- Removed: General → Tasks; entire **Business Applications** group; **Intelligence Hub** (A.I. Chat, Drone Control); Facility Management → IT Services, Vendor Management.
- Left Facility **Security** and **Maintenance** (Security has live visitor/camera/weather; Maintenance is descriptive stubs, not global Coming Soon page).
- Routes under `/business/*`, `/facility/vendor-management`, `/facility/it-services`, `/intelligence/*` remain in codebase for direct URL/bookmarks; only nav entries were removed.
## Related
- [[Layout - App Shell]]
