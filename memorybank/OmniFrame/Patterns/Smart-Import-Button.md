---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-04-29
---
# Smart Import Button

## Purpose / Context
A reusable split button that auto-promotes the best import option for the current environment. Designed so a single visual control can offer CSV/clipboard fallback for desktop browsers AND a snappy "Import via Agent" option that lights up only when the on-prem OmniFrame agent is detected on `localhost:8765`. Lives at `src/components/ui/smart-import-button.tsx` and is consumed by `outbound-data-manager.tsx`.

## Pattern

```tsx
<SmartImportButton
  options={[
    {
      id: 'csv',
      label: 'Import from File',
      icon: <FileUp />,
      description: 'Paste a TSV/CSV from the clipboard.',
      preferred: !agentDetection.available,
      onSelect: handleImportFromClipboard,
    },
    {
      id: 'agent',
      label: 'Import via Agent',
      subLabel: agentDetection.agentName ?? undefined,
      icon: <Zap />,
      description: 'Pull live LT22 data from SAP via the on-prem agent.',
      hidden: !agentDetection.available,   // disappears entirely when no agent
      preferred: agentDetection.available,  // becomes the primary action when present
      onSelect: () => setLt22DialogOpen(true),
    },
  ]}
/>
```

### Default-selection algorithm
1. First non-hidden option marked `preferred: true`.
2. Else option matching `defaultId` (caller override).
3. Else first non-hidden option.

### Visuals
- Renders as `[primary action] [▼ caret menu of every other option]`.
- When the preferred default is `id: 'agent'` (with `enableAgentBoost` left at its default `true`) the button gets an emerald accent + a Zap icon + a small green dot — instantly readable as "agent is online".
- Subtle `motion-safe:fade-in motion-safe:zoom-in-95` transition on the primary label whenever the preferred default changes (e.g. agent comes online while the user's looking at the page) so the change registers without yanking focus.
- Mobile: collapses to icon-only at `<sm` widths with the label moved to `sr-only`.
- Caret dropdown lists every non-hidden option with its icon + description; the current default is tagged with a small `Default` chip.

### Key invariants
- `hidden: true` excludes the option from BOTH the menu AND default selection.
- `disabled: true` greys an option but keeps it visible.
- The primary button has a tooltip on its description so power users learn what each option does without opening the menu.

## Companion hook — `useAgentDetection()`
`src/features/admin/sap-testing/hooks/use-agent-detection.ts` provides `{available, health, agentName, hasCapability}` from a single module-scoped 5s poll of `${AGENT_URL}/health`. Multiple consumers share one in-flight probe and one timer.

Surfaces using it today:
- `src/components/outbound-data-manager.tsx` → SmartImportButton's `agent` option visibility.
- `src/features/outbound/components/import-lt22-dialog.tsx` → read-only agent strip + submit-button gating.
- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` → refactored to consume the hook as the source of truth (replaces its old inline 3s probe).

## When to use this pattern
Any time a feature has:
- A baseline import path that always works (clipboard/CSV upload), AND
- One or more environment-conditional faster paths (on-prem agent, signed-in Smartsheet, signed-in cloud connector, etc.).

Let `<SmartImportButton>` decide which one becomes the primary CTA and let the rest live in the dropdown.

## File paths
- `src/components/ui/smart-import-button.tsx`
- `src/features/admin/sap-testing/hooks/use-agent-detection.ts`

## Related
- [[Patterns/Agent-Capability-Negotiation]]
- [[Patterns/UI-Component-Conventions]]
- [[Implementations/Implement-LT22-Outbound-Import]]
