# Dependency Audit Gate Policy

> Ensures production dependencies are free of known high-severity vulnerabilities.

## Audit Gate

The following command runs as part of the CI pipeline:

```bash
pnpm audit --prod --audit-level high
```

| Parameter          | Value                | Rationale                                        |
| ------------------ | -------------------- | ------------------------------------------------ |
| `--prod`           | Production deps only | Dev dependencies are not shipped to users         |
| `--audit-level`    | `high`               | Block on high and critical; moderate is tracked   |

A **non-zero exit code** from `pnpm audit` fails the pipeline, preventing merges with known high-severity vulnerabilities.

## Exception Mechanism

When a vulnerability has **no available patch** and compensating controls are in place, the team may grant a time-limited exception recorded in:

```
.audit-allowlist.json   (repository root)
```

### Schema

```jsonc
{
  "$comment": "Known audit exceptions with documented risk acceptance.",
  "allowlist": [
    {
      "id": "GHSA-xxxx-xxxx-xxxx",   // Advisory ID (GHSA or CVE)
      "package": "example-pkg",       // npm package name
      "severity": "high",             // Severity at time of acceptance
      "reason": "Brief justification and compensating controls.",
      "owner": "team-or-person",      // Accountable party (optional)
      "expires": "2026-06-15"         // ISO date — exception auto-expires
    }
  ]
}
```

### Required Fields

| Field      | Type   | Description                                                        |
| ---------- | ------ | ------------------------------------------------------------------ |
| `id`       | string | GitHub Security Advisory (GHSA) or CVE identifier                  |
| `package`  | string | The npm package name affected                                      |
| `severity` | string | `critical`, `high`, `moderate`, or `low` at time of acceptance     |
| `reason`   | string | Why the exception is justified; must include compensating controls  |
| `expires`  | string | ISO 8601 date after which the exception is no longer valid         |

### Optional Fields

| Field   | Type   | Description                               |
| ------- | ------ | ----------------------------------------- |
| `owner` | string | Team or individual accountable for review |

## Expiry Policy

- Every exception **must** have an `expires` date.
- When the current date is past `expires`, the exception is considered **void** and the audit gate will fail.
- This forces periodic re-evaluation rather than allowing indefinite risk acceptance.

## Review Cadence

| Frequency | Action                                                                          |
| --------- | ------------------------------------------------------------------------------- |
| Monthly   | Review all entries in `.audit-allowlist.json` for relevance and expiry dates     |
| On merge  | CI automatically enforces the audit gate                                        |
| Quarterly | Assess whether excepted packages should be replaced (see ADR process)           |

## Workflow for New Exceptions

1. **Investigate** — confirm no patch exists and the vulnerability is reachable.
2. **Document compensating controls** — file-size limits, input validation, sandboxing, etc.
3. **Create ADR** — if the exception is non-trivial, write an Architecture Decision Record in `docs/quality/adr/`.
4. **Add entry** to `.audit-allowlist.json` with all required fields and a reasonable expiry (max 6 months).
5. **Open a tracking issue** for permanent remediation (replacement or upstream fix).

## Workflow for Removing Exceptions

When the root cause is resolved (package patched or replaced):

1. Remove the corresponding entry from `.audit-allowlist.json`.
2. Run `pnpm audit --prod --audit-level high` to confirm the finding is gone.
3. Update or close the tracking issue.

## Related Documents

- [ADR: xlsx Remediation](adr/adr-xlsx-risk-remediation.md)
- [Dependency Risk Acceptance](dependency-risk-acceptance.md)
