// Created and developed by Jai Singh
/**
 * Non-warehouse bin detection — pure helper used by every Kitting Apps
 * surface that imports Transfer Orders into a kit build plan.
 *
 * The Add Kit Build Plan dialog and the Append TOs to Kit flow both
 * compare each imported TO row's `sourceStorageBin` against a list of
 * substrings configured at the org level
 * (`kitting_workflow_settings.non_warehouse_bin_patterns`, see
 * migration 314). A match means the bin lives at the plant, not inside
 * our physical warehouse — the operator must explicitly acknowledge
 * before the kit can be saved so they know to drive that material
 * down on the plant side.
 *
 * Matching rules:
 *   - Substring match, case-insensitive, whitespace-trimmed on both
 *     sides (`'NEEDBIN'` triggers on `'112NEEDBIN'`, `'R0NEEDBIN'`,
 *     `'needbin-spare'`, etc.).
 *   - Blank patterns are ignored — operators sometimes leave an empty
 *     row in the Settings editor.
 *   - Records with no `sourceStorageBin` (empty string / undefined)
 *     never match, regardless of pattern shape.
 *   - Reports the *first* pattern that matched per record so the UI
 *     can render the trigger (`"matched: NEEDBIN"`).
 *
 * Both producers and the UI rely on this returning a stable result
 * for the same input, so the function is pure — no logging side
 * effects, no exceptions thrown for normal inputs.
 *
 * See `memorybank/OmniFrame/Implementations/Non-Warehouse-Bin-Acknowledgment.md`.
 */
import type { TransferOrderRecord } from '@/components/ui/add-kit-build-plan-dialog'

export interface NonWarehouseBinMatch<
  T extends Pick<
    TransferOrderRecord,
    | 'sourceStorageBin'
    | 'transferOrderNumber'
    | 'material'
    | 'materialDescription'
  > = TransferOrderRecord,
> {
  /** The original record (kept so the UI can render TO number / material / description without a second lookup). */
  record: T
  /** The bin code that triggered the match (snapshotted at detection time so renames don't surprise the operator). */
  sourceStorageBin: string
  /** The first pattern (uppercased, trimmed) that matched this bin. */
  matchedPattern: string
}

export interface NonWarehouseBinDetection<
  T extends Pick<
    TransferOrderRecord,
    | 'sourceStorageBin'
    | 'transferOrderNumber'
    | 'material'
    | 'materialDescription'
  > = TransferOrderRecord,
> {
  /** All records whose source bin matched at least one pattern. */
  matches: NonWarehouseBinMatch<T>[]
  /** Distinct list of patterns that fired at least once across the input. */
  patternsTriggered: string[]
  /** Distinct list of bin codes that fired at least once across the input. */
  binsTriggered: string[]
  /** Convenience: true iff `matches.length > 0`. */
  hasMatches: boolean
}

/**
 * Detect every TO row whose `sourceStorageBin` matches one of the
 * configured non-warehouse patterns. Safe to call with any list shape
 * — empty input returns the empty detection.
 */
export function detectNonWarehouseBins<
  T extends Pick<
    TransferOrderRecord,
    | 'sourceStorageBin'
    | 'transferOrderNumber'
    | 'material'
    | 'materialDescription'
  >,
>(records: T[], patterns: string[]): NonWarehouseBinDetection<T> {
  const normalisedPatterns = (patterns ?? [])
    .map((p) => (p ?? '').trim().toUpperCase())
    .filter((p) => p.length > 0)

  if (normalisedPatterns.length === 0 || records.length === 0) {
    return {
      matches: [],
      patternsTriggered: [],
      binsTriggered: [],
      hasMatches: false,
    }
  }

  const matches: NonWarehouseBinMatch<T>[] = []
  const patternsTriggered = new Set<string>()
  const binsTriggered = new Set<string>()

  for (const record of records) {
    const bin = (record.sourceStorageBin ?? '').trim()
    if (!bin) continue

    const binUpper = bin.toUpperCase()
    const matchedPattern = normalisedPatterns.find((p) => binUpper.includes(p))
    if (!matchedPattern) continue

    matches.push({
      record,
      sourceStorageBin: bin,
      matchedPattern,
    })
    patternsTriggered.add(matchedPattern)
    binsTriggered.add(bin)
  }

  return {
    matches,
    patternsTriggered: [...patternsTriggered],
    binsTriggered: [...binsTriggered],
    hasMatches: matches.length > 0,
  }
}

/**
 * Normalise an operator-edited list of patterns: trim, uppercase,
 * drop blanks, dedupe. Used by the Settings UI before persisting to
 * `kitting_workflow_settings.non_warehouse_bin_patterns`. Keeps the
 * stored list canonical so the runtime matcher can compare on
 * upper-cased substrings without re-normalising on every call.
 */
export function normaliseBinPatterns(patterns: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of patterns) {
    const cleaned = (raw ?? '').trim().toUpperCase()
    if (!cleaned) continue
    if (seen.has(cleaned)) continue
    seen.add(cleaned)
    out.push(cleaned)
  }
  return out
}

// Created and developed by Jai Singh
