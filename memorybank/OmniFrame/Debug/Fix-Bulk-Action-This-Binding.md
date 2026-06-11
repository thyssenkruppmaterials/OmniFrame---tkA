---
tags: [type/debug, status/active, domain/frontend]
created: 2026-05-19
---
# Fix Bulk Action `this` Binding (TanStack Query + Static Methods)

## Purpose / Context

User report: “Failed to complete bulk action: this.updateUserRole is not a function” when bulk-assigning users to a role from `/admin/user-management`. The same trap actually affected **every** bulk action in `bulkUpdateUsers` (activate, deactivate, suspend, terminate, set_on_leave, delete, change_role, send_invitation), but only `change_role` had been exercised in this session.

## Symptom

```
Failed to complete bulk action: this.updateUserRole is not a function
```

Not “Cannot read properties of undefined” — which is the tell that `this` was bound to *something*, just not the class.

## Root Cause

`useUserManagement` hook wired the mutation by reference:

```ts
const bulkUpdateMutation = useMutation({
  mutationFn: UserManagementService.bulkUpdateUsers, // <-- detached
  ...
})
```

TanStack Query invokes the mutation function as `options.mutationFn(variables)`. JS binds `this` based on the call site, so inside `bulkUpdateUsers` `this` is the mutation `options` object — not `UserManagementService`. Every dispatch in the switch (`this.updateUserRole`, `this.updateUserStatusWithReason`, `this.deleteUser`, `this.resendInvitation`) resolves to `undefined`, throwing `TypeError: this.X is not a function`.

This is the same hazard that bites anyone who passes a class method as a callback in JavaScript. Static methods are not exempt — they’re just regular functions on the constructor.

## Fix (two-layer defence)

### 1. Hook — wrap in an arrow so `this` is preserved

`src/features/user-management/hooks/use-user-management.ts`

```ts
const bulkUpdateMutation = useMutation({
  mutationFn: (data: BulkActionData) =>
    UserManagementService.bulkUpdateUsers(data),
  ...
})
```

The property-access call inside the arrow re-binds `this` to `UserManagementService`. Matches the shape of every other mutation in this file (`updateUserMutation`, `resetPasswordMutation`, etc.).

### 2. Service — reference the class by name instead of `this`

`src/features/user-management/services/user-management.service.ts`

Replaced every `this.updateUserStatusWithReason(...)`, `this.updateUserRole(...)`, `this.deleteUser(...)`, `this.resendInvitation(...)` inside `bulkUpdateUsers` with `UserManagementService.X(...)`. Also fixed a stray `this.getUserById` in `getUserPermissions`.

This makes the dispatch correct regardless of how `bulkUpdateUsers` is invoked — detached callback, `.bind()`, `.call()`, or normal property access. Future contributors can pass it however they want.

## Why other bulk actions “seemed to work” before

They didn’t — nobody had clicked them in production with the current code path. The symptom only surfaced when the new bulk role-change UX (added earlier today) made the role action prominent enough to actually hit.

## Detection heuristic for the next time

If you see `TypeError: this.X is not a function` from a TanStack Query mutation/query, the call shape is almost always:

```ts
useMutation({ mutationFn: SomeClass.staticMethod })
```

Fix is the same: wrap in an arrow or stop relying on `this` inside the static method.

## Files Changed

- `src/features/user-management/hooks/use-user-management.ts` (mutation wrapper)
- `src/features/user-management/services/user-management.service.ts` (replace `this.` with `UserManagementService.`)

## Verification

- `pnpm exec tsc -p tsconfig.app.json --noEmit` — clean
- `pnpm exec eslint <both files>` — clean
- Manual: bulk role-change against ≥2 users now completes (no `TypeError`).

## Related

- [[Enable-Bulk-Role-Change-In-User-Management]] — the change that surfaced this latent bug
- [[User-Management]] — feature MOC
