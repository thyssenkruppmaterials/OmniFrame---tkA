---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-16
---

# Implement — Responsive Resize Sweep (2026-05-16)

## Purpose / Context

Parallel-agent sweep that introduces two new UI primitives (`<StatTile>` + `<KpiGrid>`, `<ResponsiveDialog>`), one new hook (`useContainerWidth`), and a set of hygiene fixes across the layout shell + shadcn primitives. The goal: make the OmniFrame web app resize correctly at every viewport / container width the deployed audience actually uses, and stop the long-tail of "value clipped under the rail" and "dialog forces page scroll" bugs.

## User-visible problem

`/apps/inventory` Inventory Counts — the **Variance 25074** KPI tile painted its 6-digit value under the left rail at typical laptop widths (~1366–1440 px). Reproduced on Chrome / Edge / Safari at the standard zoom. Screenshot attached to the parent plan file.

The value was `25074` (not `25,074`) because the hand-rolled tile didn't run numbers through `toLocaleString()`, and the value clipped because:

- The flex chain wrapping the tile had no `min-w-0`, so the inner `text-3xl` value pushed its column wider than the visible area.
- The tile typography (`text-3xl`) did not step down at narrow widths.
- No `truncate` + `title=` fallback existed when the value did overflow, so the clipped state showed garbled fragments instead of an ellipsis.

## Audit findings

The audit phase walked every callsite that renders numeric KPIs, every `DialogContent` width override, every popover / tooltip / dropdown positioner, and every table wrapper. Summary:

- **KPI tiles**: dozens of hand-rolled tiles across the inventory / outbound / productivity surfaces, each re-implementing thousand separators, accent colours, and (variably) `min-w-0`. None of them used container queries; many forgot `truncate` + `title=`.
- **Dialogs**: twelve callsites used `min-w-[Npx]` on `DialogContent` (max found: `min-w-[1200px]`, which forced horizontal page scroll at 1280-px laptops). Many dialogs put `overflow-y-auto` on the *content* rather than a body slot, so the header + footer scrolled with the content.
- **Layout shell**: `authenticated-layout.tsx` + `main.tsx` had flex children without `min-w-0`, which let an overflowing inner value push the whole app sideways instead of clipping inside its own column.
- **Popper-based primitives** (`popover`, `tooltip`, `dropdown-menu`): no `collisionPadding`, so at narrow widths the floating element painted flush against (or over) the viewport edge.
- **Tables**: `<Table>` wrapper missing `min-w-0` so a wide table inside a narrow card hit the same "push the parent wider than the viewport" failure mode as the KPI tiles.

## Plan execution model

Three phases, with most of phase 1 running in parallel across agents:

1. **Phase 0 — Primitives.** Author the new components in `src/components/ui/` and the new hook in `src/hooks/`. Land the hygiene fixes on the layout shell and the shadcn popper / table primitives. Single-author phase so the API surface stays internally consistent.
2. **Phase 1 — Parallel migrations.** Five feature agents (A–E) convert their respective surfaces over to the new primitives concurrently. Agent F (this note's author) writes the documentation. The agents do not depend on each other's callsites; they each own a disjoint slice of the feature tree.
3. **Phase 2 — Verify.** Run the unit + integration test suites, lint + bundle budget, and manually walk the regression path on the original `/apps/inventory` Inventory Counts page at the three breakpoint widths (1280, 1440, 1920). The verifier also fills in the per-file inventory under "Files changed" below once the parallel work lands.

## Files changed

*Stubbed by Agent F (docs). The verifier will replace each agent's bullet with the actual file list after the parallel work lands.*

- **Phase 0 (primitives + shell hygiene)**
  - `src/components/ui/stat-tile.tsx` — new primitive
  - `src/components/ui/kpi-grid.tsx` — new primitive
  - `src/components/ui/responsive-dialog.tsx` — new primitive (replaces `min-w-[Npx]` on `DialogContent`)
  - `src/hooks/use-container-width.ts` — new hook (CSS-can't-do-this escape hatch)
  - `src/components/layout/authenticated-layout.tsx` — `min-w-0` thread-through
  - `src/components/layout/main.tsx` — `min-w-0` thread-through
  - `src/components/ui/popover.tsx` — `collisionPadding={8}` default
  - `src/components/ui/tooltip.tsx` — `collisionPadding={8}` default
  - `src/components/ui/dropdown-menu.tsx` — `collisionPadding={8}` default
  - `src/components/ui/table.tsx` — `min-w-0` on the wrapper
  - `src/components/ui/__tests__/stat-tile.test.tsx`, `kpi-grid.test.tsx`, `responsive-dialog.test.tsx` — new unit tests for the primitives
- **Agent A** — *(verifier to fill in: inventory / cycle counts surfaces)*
- **Agent B** — *(verifier to fill in: outbound surfaces)*
- **Agent C** — *(verifier to fill in: shift productivity / standard work surfaces)*
- **Agent D** — *(verifier to fill in: SAP testing / agent triggers surfaces)*
- **Agent E** — *(verifier to fill in: admin / HR / customer portal surfaces)*
- **Agent F (this note)** — docs only, no source changes:
  - `memorybank/OmniFrame/Patterns/Responsive-StatTile-And-KpiGrid.md` (new)
  - `memorybank/OmniFrame/Patterns/ResponsiveDialog-Width-Tokens.md` (new)
  - `memorybank/OmniFrame/Decisions/ADR-Container-Query-Stat-Tiles.md` (new)
  - `memorybank/OmniFrame/Implementations/Implement-Responsive-Resize-Sweep-2026-05-16.md` (this file)
  - `memorybank/OmniFrame/Sessions/2026-05-16.md` (new)
  - `memorybank/OmniFrame/_Index/Architecture.md` (append "Frontend Primitives (2026-05-16)" subsection)
  - `memorybank/OmniFrame/_Index/Implementations.md` (append bullet under the relevant section)
- **Verifier** — *(to fill in: test results, bundle budget delta, lint ratchet delta, regression walk-through notes, any deferred callsites)*

## Out of scope (deferred follow-ups)

- **`omni_agent_v2/gui/`** — the new Tauri-wrapped agent GUI ([[Implement-OmniAgent-V2-Tauri-GUI]]) ships its own React 18 + Tailwind v3 + Radix stack inside the Tauri webview. It's a separate Vite project with no shared dependency on `src/components/ui/`, so the primitives created here can't be imported there as-is. A follow-up sweep on `omni_agent_v2/gui` will either copy the primitives across or extract them into a shared `@omniframe/ui` package; tracked as a separate item, not part of this PR.
- **Long-tail callsites the verifier defers** — the parallel-agent slice is intentionally aggressive but not exhaustive. The verifier owns the deferred list and files follow-up tickets for any tile / dialog the per-agent sweep doesn't reach.

## Related

- [[Responsive-StatTile-And-KpiGrid]] — user-facing API documentation for the two new KPI primitives.
- [[ResponsiveDialog-Width-Tokens]] — user-facing API documentation for the dialog primitive + the `min-w-[Npx]` ban.
- [[ADR-Container-Query-Stat-Tiles]] — the architecture decision that introduces `@container/stat-tile` and `@container/kpi-grid` as sanctioned tokens.
- [[2026-05-16|Session log]]
