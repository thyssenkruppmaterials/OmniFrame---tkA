---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-03
---
# Implement Agent Triggers Control Center — Round 3

## Purpose / Context
User asked to "completely redesign the Agent Triggers page to be much better laid out, some of the information sections can be consolidated. Make it a robust Agent Triggers control center page, that is professionally laid out properly." After [[Implement-SAP-Testing-Layout-Polish]] (round 1+2) had already moved the Health/Fleet cards onto the tab and built the unified-workbench pattern for Triggers+Console, the user's screenshot still showed five vertical sections of Card chrome stacked above the workbench.

## Details

### Final structure
```
1. Conditional alert banners        (only when applicable)
   ├ Agent-not-detected (red)
   ├ Session-expired (amber, with Connect-Account CTA)
   └ Agent-side-triggers-active (violet)

2. Mission Control Header            (always)
   ├ StatusStrip (env pill / version / SAP GUI / Connect / refresh)
   ├ ─── 1px border-t ───
   └ KpiCell × 5 (Triggers · Fires · Errors · Latency · Online Agents)

3. Fleet & Diagnostics               (always)
   ├ AgentHealthCard      │  AgentsFleetCard
   └ (lg:grid-cols-2 with lg:divide-x)

4. Trigger Runtime Workbench         (always)
   ├ Triggers list (lg:col-span-3)  │  SapConsoleCard (lg:col-span-2)
   └ (round-2 unified workbench)
```

### Code changes
- **`agent-triggers-tab.tsx`**:
  - Removed `<AgentStatusBar />` + `<KpiRow />` invocations and definitions (~210 LOC).
  - Added `<MissionControlHeader />` (~80 LOC) — outer Card with `<StatusStrip />` on top + KPI grid on bottom, `border-t` divider between, status-tinted outer border.
  - Added `<StatusStrip />` (~140 LOC) — extracted from AgentStatusBar but without the Card wrapper. Handles all 4 agent states: `checking`, `missing` (compact disconnect pill since banner above carries the heavy alert), `unauthenticated` (compact pill since banner above has the CTA), `connected` (full env pill + version + SAP GUI badge + Connect Account + refresh).
  - Wrapped `<AgentHealthCard />` + `<AgentsFleetCard />` in a single bordered Card with `lg:grid-cols-2 lg:divide-x`.
- **`agent-health-card.tsx`**: added `className?: string` prop.
- **`agents-fleet-card.tsx`**: added `className?: string` prop.

### State-to-chrome rules
- The outer Mission Control Card border colour reflects `agentStatus`:
  - `connected` → `border-emerald-500/40`
  - `unauthenticated` → `border-amber-500/40`
  - `missing` → `border-red-500/30`
  - `checking` → no tint
- This gives the user a calm peripheral cue without redundant alert chrome inside the card. The conditional alert banners above carry the actual CTAs.

### Why split the conditional banners from Mission Control
Initial impulse was to put the `unauthenticated` Connect-Account button directly inside the Mission Control header. Rejected because:
1. The CTA needs prominence and a yellow alert banner is the proven pattern.
2. The Mission Control header should stay calm so the KPI grid reads cleanly even when the agent is in a degraded state.
3. Banner-on-top is consistent with the existing `AgentNotDetectedBanner` and `agentSideTriggersActive` patterns — keeping all three banners in one row at the top is cohesive.

### Verification
- `pnpm tsc -b` exit 0
- `pnpm eslint` no new errors (1 pre-existing warning unrelated)
- `pnpm build` builds in ~10s
- Bundle delta vs main: +1.7 KB total JS (negligible — no new vendor deps)

## Related
- [[Components/Agent-Triggers - Realtime Automation]]
- [[Patterns/Unified-Workbench-Card-Layout]]
- [[Implementations/Implement-SAP-Testing-Layout-Polish]]
- [[Sessions/2026-05-03]]
