---
tags: [type/implementation, status/active, domain/frontend, domain/auth]
created: 2026-05-19
---
# Enable Bulk Role Change in User Management

## Purpose / Context

The admin User Management page (`/admin/user-management`) had a `change_role` bulk action wired end-to-end (UI button → `bulkUpdateUsers` → `updateUserRole` per user with cache invalidation), but the role picker only listed **hardcoded `SYSTEM_ROLES`** with naive title-cased labels. Custom roles created in the role manager were invisible to the bulk picker, and the labels (e.g. "Tka Associate") didn't match the rest of the app's `role_display_name` ("TKA Associate"). Result: "bulk change role" appeared broken whenever an org used custom roles.

This change makes the bulk picker the same as the single-user picker — dynamic roles from the DB — and adds context so admins see what they're about to overwrite.

## Details

### Scope

Single-file change: `src/features/user-management/components/bulk-actions-dialog.tsx`. The service layer (`UserManagementService.bulkUpdateUsers` → `updateUserRole`) already resolves role names to `role_id` via `getRoleIdFromName` and supports custom roles, so no backend change was needed.

### Improvements

1. **Dynamic role list** — `useEffect` calls `getRoles()` from `@/features/admin/roles/services/role.service` when the dialog opens, filters to `isActive`, and stores the result in component state. Cancellation flag prevents setState after unmount. Mirrors the pattern in `UserChangeRoleDialog`.
2. **Loading state** — `Select` is disabled while loading; placeholder shows "Loading roles..."; spinner inside the dropdown.
3. **System badge + descriptions** — each `SelectItem` shows `role.displayName` (canonical), optional `role.description`, and a "System" badge for system roles. Sorted system-first, then alphabetical.
4. **Current-role distribution** — above the picker, a `Current Roles` row shows badges like `5 × Viewer`, `2 × TKA Associate`, then `→` and the new role badge. Computed from `selectedUsers` (or filtered `users` if only IDs were passed). Uses `role_display_name` from the user record first, falls back to `availableRoles`, then to title-cased role key.
5. **Permissions-change warning** — when the picked role differs from at least one user's current role, an `Alert` callout reminds admins that permissions will change and caches will be invalidated.
6. **Removed dead code** — deleted the `ROLE_OPTIONS = SYSTEM_ROLES.map(...)` constant and the `SYSTEM_ROLES` import (still imported elsewhere; only this file changed).

### Why not extend the toolbar role-filter dropdown too?

The toolbar (`data-table-toolbar.tsx`) also uses hardcoded `SYSTEM_ROLES` for its role filter checkboxes. That's a separate concern — filtering by role on the table — and out of scope for the bulk-action fix. Worth a follow-up to make filters DB-driven too.

### Permission gating

Unchanged: the bulk action button is wrapped in `<PermissionGuard resource='roles' action='update'>` in the action grid. Users without `roles:update` never see the option.

### Cache invalidation

Also unchanged but worth restating: `UserManagementService.updateUserRole` clears `permissionStore`, `navigationStore`, and `unifiedAuthStore` caches plus localStorage entries. For a bulk change of N users, this fires N times in `Promise.all`. For very large bulk operations this could be optimised to one cache flush at the end, but for typical admin batches (10–50 users) it's fine.

## Related

- [[user-change-role-dialog]] — single-user picker this bulk picker now mirrors
- [[Roles-Permissions]] — DB-driven roles + `getRoles()` source of truth
- [[User-Management]] — feature MOC
