# Flaky Test Quarantine Policy

## Purpose

Ensure flaky tests are visible, owned, and scheduled for remediation rather than
permanently ignored or causing false CI failures.

## Rules

### Quarantine Label

- Label: `quarantine:flaky`
- Applied via Vitest `.skip` annotation with mandatory comment linking to an issue.

### Expiration SLA

- Maximum quarantine duration: **14 calendar days**.
- After 14 days, the quarantine annotation is automatically treated as a failure
  in CI (enforced by a scheduled check or pre-commit hook).

### Requirements

1. Every quarantined test MUST have a linked GitHub issue.
2. The issue MUST have an assignee.
3. The issue MUST include:
   - Failure frequency (e.g., "fails ~30% of runs")
   - Root cause hypothesis
   - Remediation plan

### De-Quarantine Workflow

1. Fix the root cause.
2. Run the test suite 5x consecutively to confirm stability.
3. Remove the `.skip` annotation.
4. Close the linked issue.

### Permanent Quarantine Prevention

- If a test remains quarantined beyond 14 days, it automatically becomes a
  CI failure on the 15th day.
- The assignee receives a notification (via GitHub issue comment) at day 7 and day 13.
- If the test cannot be fixed, it must be rewritten or removed (with justification).

## Example

```typescript
// QUARANTINE: https://github.com/org/repo/issues/123
// Reason: Flaky due to Redis connection timing in CI
// Quarantined: 2026-02-15
// Expires: 2026-03-01
it.skip('should handle enterprise scale load simulation', async () => {
  // ...
})
```
