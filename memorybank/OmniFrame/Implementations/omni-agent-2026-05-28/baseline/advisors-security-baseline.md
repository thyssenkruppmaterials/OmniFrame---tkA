---
tags: [type/context, domain/database, domain/auth, status/active]
created: 2026-05-28
---

# Security Advisor Baseline — 2026-05-28 (pre-remediation)

Captured via `mcp__supabase__get_advisors(type:"security")` on project `wncpqxwmbxjgxvrpcake`
at the `pre-omni-agent-remediation-2026-05-28` tag. Used as the before-state diff baseline
for Phase 10 rescore.

## Totals

- **ERROR:** 21
- **WARN:** 540

## Distribution by lint (top categories)

| Lint | Count | Level | Relevance |
|------|-------|-------|-----------|
| `authenticated_security_definer_function_executable` | 221 | WARN | OA-04c (claim/lease/reap among them) |
| `anon_security_definer_function_executable` | 215 | WARN | OA-04c (revoke anon EXECUTE) |
| `function_search_path_mutable` | 73 | WARN | hygiene (out of scope) |
| `rls_policy_always_true` | 19 | WARN | OA-22 (sap_agents RLS tighten) |
| `rls_references_user_metadata` | 17 | WARN | OA-22 |
| `public_bucket_allows_listing` | 5 | WARN | out of scope |
| `security_definer_view` | 4 | ERROR | out of scope (role_hierarchy etc.) |
| `materialized_view_in_api` | 4 | WARN | out of scope |
| `vulnerable_postgres_version` | 1 | WARN | out of scope (R2) |
| `auth_otp_long_expiry` / `auth_leaked_password_protection` | 1 each | WARN | out of scope |

The three remediation-targeted RPCs (`claim_sap_agent_job`, `bump_sap_agent_job_lease`,
`reap_stale_sap_agents`) each appear twice (anon + authenticated executable) — the post-OA-04c
target is to drop those 6 advisory rows.

Raw advisor JSON: captured to the agent-tools cache during Phase 00
(`get_advisors` 587 KB output, 561 lints total).
