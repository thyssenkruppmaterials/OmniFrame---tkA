// Created and developed by Jai Singh
// ──────────────────────────────────────────────────────────────────────
// Shared console helpers — used by both Inventory Management and
// Agent Triggers tabs to detect Transfer Order numbers and hand off
// to the LT24 history query via a localStorage handoff key.
//
// 2026-05-09 — TO History migrated FROM the standalone admin tab INTO
// the Inventory Management Query Library (`lt24-history` entry). This
// helper now switches to `tab=inventory-management` and writes a new
// handoff key (`omniframe.inventory_query_handoff.v1`) that the
// Inventory Management tab reads on mount to pre-select the query
// and pre-fill the form. The legacy
// `omniframe.to_history.focus_handoff.v1` key is no longer written.
// ──────────────────────────────────────────────────────────────────────

/** Detect 7+ digit TO numbers in console text — used to link
 *  "Transfer Order N" mentions to the TO History query. */
export const TO_NUMBER_REGEX = /(\d{7,12})/g

/** Returns the first numeric token in `text` only when the surrounding
 *  text mentions Transfer Order context (TO, LT01, LT12, …). This guard
 *  prevents spurious matches against material numbers, batch ids, etc. */
export function detectToNumber(text: string): string | null {
  if (!/transfer order|TO\b|LT01|LT12/i.test(text)) return null
  const m = text.match(TO_NUMBER_REGEX)
  return m && m.length > 0 ? m[0] : null
}

/** Storage key shared with `inventory-management-tab.tsx`. The receiver
 *  consumes-and-clears the key on mount so reloads don't replay stale
 *  handoffs. Schema: `{ queryId: string, inputs: Record<string, string>,
 *  ts: number }` — `ts` is enforced to be < 30s old so a tab the user
 *  left open last week doesn't auto-select on next visit. */
export const INVENTORY_QUERY_HANDOFF_KEY =
  'omniframe.inventory_query_handoff.v1'

/** Open the Inventory Management tab focused on the LT24 history query
 *  pre-filled with `toNumber`. Replaces the legacy `openToNumberInToHistory`
 *  signature; the function name stays so call sites in the SAP console
 *  click handlers don't need a rename. */
export function openToNumberInToHistory(toNumber: string): void {
  try {
    localStorage.setItem(
      INVENTORY_QUERY_HANDOFF_KEY,
      JSON.stringify({
        queryId: 'lt24-history',
        inputs: {
          to_number: toNumber,
          warehouse: 'WH5',
        },
        ts: Date.now(),
      })
    )
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href)
  url.searchParams.set('tab', 'inventory-management')
  window.history.pushState({}, '', url.toString())
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// Created and developed by Jai Singh
