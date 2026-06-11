---
tags: [type/debug, status/active, domain/frontend, sap, ll01, supabase]
created: 2026-05-31
---
# Fix: LL01 History button stuck disabled — detached `supabase.from` lost `this`

## Symptom
The "History" date-picker button next to Run Query stayed **disabled** ("No
saved runs yet…") even though `ll01_activity_runs` had completed runs. Recovery
(last turn's `recoverLl01FromHistory`) also silently never fired.

## Diagnosis
Verified the data path is healthy, ruling everything else out:
- DB: 4 runs, 1 org, RLS on + 2 policies, `public` schema.
- The logged-in user's `user_profiles.organization_id` == the runs' org
  (`c9d89a74…`).
- A raw REST query from the browser (user's session token) with the **exact**
  hook shape (`?organization_id=eq.<org>&select=…&order=ran_at.desc`) → **200 +
  4 rows**. So PostgREST, RLS, schema cache, and the org filter are all fine.

So the query is correct, but the FE hook returned 0. The difference was the
hook's helper:
```ts
// BUG — returns the DETACHED method, then calls it standalone:
function untypedFrom() { return supabase.from as unknown as UntypedFrom }
… untypedFrom()('ll01_activity_runs') …   // this === undefined → throws in supabase-js
```
`supabase.from` is a prototype method that uses `this` (client rest URL/headers).
Extracting it (`const f = supabase.from; f(t)`) loses `this`, so the call throws
inside supabase-js. `refreshIndex` / `loadRun` are `async` with `try/finally`
(no `catch`), so the throw became an unhandled rejection → `runs` stayed `[]` →
button disabled, and `loadRun` (recovery) threw too.

Why `fetchSnapshots` (Trend tab) worked: it calls the cast **inline** —
`(supabase.from as unknown as T)('ll01_activity_snapshots')` — a parenthesized
member call, which PRESERVES `this`.

## Fix
Call `supabase.from(table)` inline so `this` stays bound (mirrors `fetchSnapshots`):
```ts
function untypedFrom(table: string) {
  return (
    supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>
  )(table)
}
// callers: untypedFrom('ll01_activity_runs').select(...)
```
`src/features/admin/sap-testing/hooks/use-ll01-history.ts`. This fixes BOTH the
index (History button enables + lists runs) AND `loadRun` (so the date-picker
selection AND the failed-run recovery actually load the persisted payload).

## Verification
- ESLint clean; `tsc -b` clean; sap-testing suite (27) green.
- Root data path proven via the browser REST probe (200 + 4 rows).
- **FE-only — needs a frontend deploy to go live** (the deployed 10:43 build
  still has the detached-`this` version).

## Lesson
Never detach a client method that relies on `this` (`const f = obj.method`).
Either call it inline (`(obj.method)(args)` keeps `this`) or bind it
(`obj.method.bind(obj)`). A `try/finally` without `catch` turns the resulting
throw into a silent unhandled rejection — add a `catch` or a fallback so the
failure is visible, not a mysteriously-empty result.

## Related
- [[Implement-LL01-Run-History-Date-Picker]] (`useLL01History`)
- [[Fix-LL01-Job-Reaped-But-Data-Persisted]] (recovery uses `loadRun`)
