---
tags: [type/pattern, status/active, domain/frontend, domain/backend]
created: 2026-04-29
---
# Agent Capability Negotiation

## Purpose / Context
Tier-4 Citrix users update the OmniFrame Agent on their own schedule. The web app needs to gracefully detect when the running agent is too old for a feature instead of letting the click hit a 404 or an obscure `KeyError`. Phase B8 introduces a versionless capability map alongside the existing semver string.

## Pattern
1. **Agent declares capabilities** in `omni_agent/agent.py`:
   ```python
   AGENT_CAPABILITIES = ['confirm-to', 'transfer-inventory', 'mm02-bin', 'mm02-storage-types',
                        'create-bin', 'lt10', 'lt24', 'jobs-queue', 'metrics', 'bulk-export-pc',
                        'audit-log', 'agent-token', 'soft-warning-catalog', ...]
   ```
   Returned as `capabilities: string[]` from `GET /health`.

2. **Frontend treats it as optional** — older agents don't include the field, so:
   ```ts
   function hasCapability(health, cap) {
     if (!health || !Array.isArray(health.capabilities)) return false
     return health.capabilities.includes(cap)
   }
   ```

3. **Each query / row-action declares the capability it needs** via `requiredCapability?: string` on `QueryDefinition` and `QueryRowAction`. The Run / Action button is disabled with a tooltip "Requires agent v1.4.0+ (capability X missing)" when the capability isn't reported.

## When to add a new capability
Whenever you add a new HTTP route or a meaningful new behaviour to an existing route in `agent.py`:
1. Add the capability id to `AGENT_CAPABILITIES`.
2. If the frontend depends on the new behaviour, add `requiredCapability: '<your-cap>'` next to the consuming `QueryDefinition` or `QueryRowAction`.
3. Bump `AGENT_VERSION` and `MIN_REQUIRED_AGENT_VERSION` only if the feature is critical and you want the auto-update banner to fire for older agents.

## Why not just rely on semver?
Capabilities decouple "what the agent can do" from "what version it claims to be". A user with a custom-built agent at version `1.4.0-dev` will report whichever capability set their fork compiled with — the UI gates correctly even though the version string isn't authoritative.

## File paths
- `omni_agent/agent.py` → `AGENT_CAPABILITIES`
- `src/features/admin/sap-testing/lib/agent-fetch.ts` → `hasCapability()`, `isAgentOutdated()`, `MIN_REQUIRED_AGENT_VERSION`
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` → `requiredCapability` on `QueryDefinition`, `QueryRowAction`, plus gating on the Run button + RowActionsMenu items.

## Related
- [[Implementations/Job-Queue-Architecture]]
- [[Components/Omni-Agent - Headless SAP Agent]]
