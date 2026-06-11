# ADR: Dependency Risk Closeout — Round 3 (2026-02-17)

## Status

**Accepted**

## Context

Round 3 baseline identified one remaining moderate vulnerability:

- **Advisory:** GHSA-xxjr-mmjv-4gpg (Lodash Prototype Pollution in `_.unset` and `_.omit`)
- **Path:** `bull@4.16.5` -> `lodash@4.17.21`
- **Severity:** Moderate
- **Patched versions:** `>=4.17.23`

Additionally, the CI audit gate had several issues:
1. Used `|| true` permissive fallback, masking real failures
2. Used text-based grep parsing (fragile, format-dependent)
3. `.audit-allowlist.json` had a schema key mismatch (`expires` in comments vs `expiry` in CI parsing)
4. Allowlist lacked required `owner` and `reason` fields

## Decision

### Vulnerability Resolution

Used `pnpm.overrides` to pin `lodash` to `>=4.17.23` across all transitive dependency paths:

```json
"pnpm": {
  "overrides": {
    "lodash@>=4.0.0 <4.17.23": "4.17.23"
  }
}
```

This approach was chosen over removing `bull` because:
- `bull` may be needed for future queue functionality
- Override is surgical and doesn't change the dependency graph
- lodash 4.17.23 is available and resolves the advisory

### Audit Gate Hardening

Replaced the entire CI audit step with structured JSON parsing:
- Uses `pnpm audit --json` for reliable structured output
- Validates allowlist entries have all required fields (`id`, `owner`, `reason`, `expires`)
- Checks expiry dates before allowing exceptions
- Removed `|| true` -- failures are real failures
- Compares advisory IDs against allowlist (not text pattern matching)

### Allowlist Schema

Normalized to use `expires` (not `expiry`) as the canonical field name. Added required fields:
- `id`: Advisory ID
- `package`: Affected package
- `severity`: Advisory severity
- `reason`: Why exception is accepted
- `owner`: Responsible person/team
- `expires`: Re-evaluation date (YYYY-MM-DD)

## Consequences

- `pnpm audit --prod --audit-level moderate` now returns 0 findings
- CI audit gate is deterministic and cannot be silently bypassed
- Any future exceptions must include full metadata with expiry

---

*Decision date: 2026-02-17*
