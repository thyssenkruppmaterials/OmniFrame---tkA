// Created and developed by Jai Singh
/**
 * BlackHatShipShortPanel
 *
 * Inline panel mounted inside the Kit Build Audit Trail (Quick View)
 * when (a) the org has the Black-Hat ship-short authorization policy
 * enabled, AND (b) the kit currently carries an active Black Hat flag.
 *
 * Renders the structured list of BOM components that are driving the
 * Black Hat — one row per missing component — with a per-row
 * `Authorize` checkbox + a justification text field. When the operator
 * clicks `Authorize Selected`, the panel merges the new authorizations
 * into the kit's existing `authorized_ship_short_items` and calls
 * `RRKittingDataService.updateAuthorizedShipShortItems`. That service
 * re-runs BOM coverage so the Black Hat self-clears the moment every
 * still-missing line has been authorized (see
 * [[Authorized-Ship-Short-Negates-Black-Hat]]).
 *
 * Policy (per-organization, configured in Settings → Workflow Settings
 * via `kitting_workflow_settings`):
 *   - `enabled` — show or hide the panel entirely.
 *   - `requireJustification` — block save when any selected line has
 *     an empty description.
 *   - `requireLineByLineApproval` — hide the "Authorize All Missing"
 *     bulk-action button.
 *
 * The legacy top-bar `Edit Ship Short` power-user button is unchanged
 * — this panel is an *additional* on-ramp specifically for the
 * Black-Hat / Picking-Blocked unblock flow.
 *
 * See `memorybank/OmniFrame/Implementations/Black-Hat-Ship-Short-Authorization-Panel.md`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  HardHat,
  Loader2,
  Package,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { RRKittingDataService } from '@/lib/supabase/rr-kitting-data.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useBlackHatShipShortPolicy } from '@/hooks/use-kitting-workflow-settings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  AddTOForBlackHatDialog,
  type MissingMaterial,
} from '@/components/kitting/add-to-for-black-hat-dialog'

interface BlackHatShipShortPanelProps {
  /** Kit primary key. Required — the panel cannot operate without it. */
  kitSerialNumber: string | null
  /** Display label for the kit. */
  kitPoNumber: string | null
  /** Has the kit currently got an active black-hat flag? When false, the panel hides itself. */
  hasActiveBlackHat: boolean
  /**
   * The kit's current `authorized_ship_short_items` snapshot. New
   * authorizations are merged into this list when the operator saves.
   */
  existingAuthorizedItems: Array<{
    lineNumber: number
    partNumber: string
    description: string
  }>
  /**
   * Called after a successful save (either Ship-Short authorization or
   * TO import) so the parent dialog can refresh the kit details (flag
   * state, audit-trail chat messages, etc.).
   *
   * `event` discriminates the two on-ramps so the parent can stamp the
   * right audit-trail system note:
   *   - `ship_short_authorized` — operator authorized N parts via the
   *     per-line checkbox flow.
   *   - `to_added` — operator imported one or more Transfer Orders to
   *     satisfy missing BOM components.
   */
  onSaved: (result: {
    event: 'ship_short_authorized' | 'to_added'
    /** Ship-short: # of parts authorized. TO add: # of TOs inserted. */
    count: number
    /** TO add only: number of missing components covered by the new TOs. */
    coversCount?: number
    flagCleared: boolean
    bomCoverageComplete?: boolean
  }) => void | Promise<void>
}

interface MissingComponentRow {
  /** Unique key for React lists — material number or incora reference. */
  key: string
  /** Display part number. For incora-sub-kit rows this is the incora reference (we store it as the partNumber so coverage logic matches incoraValues). */
  partNumber: string
  description: string
  componentType: 'material' | 'incora_sub_kit' | 'incora_component'
  /**
   * True when this row is an INCORA sub-kit — authorising one of these
   * has no effect today (the BOM-coverage matcher ignores ship-short
   * for sub-kits because they have no material number to key on).
   * Surfaced as a disabled state with explanatory copy so the operator
   * understands why they can't tick the box.
   */
  unauthorizable: boolean
}

export function BlackHatShipShortPanel({
  kitSerialNumber,
  kitPoNumber,
  hasActiveBlackHat,
  existingAuthorizedItems,
  onSaved,
}: BlackHatShipShortPanelProps) {
  const policy = useBlackHatShipShortPolicy()
  const [missing, setMissing] = useState<MissingComponentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // partNumber (uppercased trimmed) → { authorized, justification }
  const [draft, setDraft] = useState<
    Record<string, { authorized: boolean; justification: string }>
  >({})
  // Open-state for the sibling "Add TO to Clear Black Hat" dialog.
  const [showAddTODialog, setShowAddTODialog] = useState(false)
  // Bumped every time a successful Add TO import lands so the missing-
  // components effect refetches. The parent `onSaved` call also runs
  // `loadDetails(true)` which refreshes activeFlags / authorized list,
  // but those don't include the structured BOM-coverage view this
  // panel uses, so we need a local re-run too.
  const [missingRefreshCounter, setMissingRefreshCounter] = useState(0)

  // Resolve the structured list of missing BOM components from the
  // service. We do this on mount and whenever the kit or flag state
  // flips. The `recheckBomCoverageBySerial` path computes the same
  // unmatched set and writes the flag — this is the read-only sibling.
  useEffect(() => {
    let cancelled = false
    if (!kitSerialNumber || !hasActiveBlackHat || !policy.enabled) {
      setMissing([])
      setDraft({})
      return
    }

    setLoading(true)
    RRKittingDataService.getMissingBomComponentsBySerial(kitSerialNumber)
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          logger.error(
            '[BlackHatShipShortPanel] missing components fetch failed:',
            result.error
          )
          setMissing([])
          return
        }

        const rows: MissingComponentRow[] = result.components.map((c) => ({
          key: `${c.componentType}:${c.materialNumber || c.incoraReference || ''}`,
          partNumber:
            c.componentType === 'incora_sub_kit'
              ? c.incoraReference || c.materialNumber
              : c.materialNumber,
          description: c.materialDescription,
          componentType: c.componentType,
          // INCORA sub-kit rows cannot be cleared via ship-short — they
          // require an INCORA Items entry instead. See the matcher in
          // recheckBomCoverageBySerial.
          unauthorizable: c.componentType === 'incora_sub_kit',
        }))
        setMissing(rows)

        // Pre-seed any rows that are already in the
        // authorized_ship_short_items list as authorized — operator
        // came to the dialog to clear stragglers, the rest stays
        // checked.
        const seedDraft: Record<
          string,
          { authorized: boolean; justification: string }
        > = {}
        for (const row of rows) {
          const match = existingAuthorizedItems.find(
            (item) =>
              item.partNumber.trim().toUpperCase() ===
              row.partNumber.trim().toUpperCase()
          )
          seedDraft[row.key] = {
            authorized: !!match,
            justification: match?.description ?? '',
          }
        }
        setDraft(seedDraft)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    kitSerialNumber,
    hasActiveBlackHat,
    policy.enabled,
    existingAuthorizedItems,
    // Re-run when a TO import lands so the panel reflects the new
    // unmatched set (or self-hides because the Black Hat cleared).
    missingRefreshCounter,
  ])

  const authorizableRows = useMemo(
    () => missing.filter((row) => !row.unauthorizable),
    [missing]
  )

  // Materials currently driving the Black Hat that can be cleared by
  // importing a TO. INCORA Sub-Kits are intentionally excluded — they
  // have no material number for TO-coverage matching (the matcher
  // explicitly skips them for ship-short coverage as well). Operators
  // clear sub-kit rows via the INCORA Items list instead.
  const missingMaterialsForTO = useMemo<MissingMaterial[]>(
    () =>
      authorizableRows.map((row) => ({
        partNumber: row.partNumber,
        description: row.description,
        componentType:
          row.componentType === 'incora_component'
            ? 'incora_component'
            : 'material',
      })),
    [authorizableRows]
  )

  const handleAddTOSubmitted = useCallback(
    async (result: { insertedCount: number; coversCount: number }) => {
      // Trigger a local refetch of the missing components so the
      // panel reflects the narrowed Black-Hat state (or self-hides if
      // every gap is now covered).
      setMissingRefreshCounter((n) => n + 1)
      // Forward to the parent so the Quick View dialog reloads its
      // details + active flags + audit-trail chat thread. The
      // `bomCoverageComplete` flag is left undefined — the parent
      // will see the canonical outcome on the next loadDetails refresh
      // (the `appendTOsToKit` service already ran the recheck and the
      // toast inside the dialog called out cleared/narrowed).
      await onSaved({
        event: 'to_added',
        count: result.insertedCount,
        coversCount: result.coversCount,
        flagCleared: false,
        bomCoverageComplete: undefined,
      })
    },
    [onSaved]
  )

  const selectedCount = useMemo(
    () => authorizableRows.filter((row) => draft[row.key]?.authorized).length,
    [authorizableRows, draft]
  )

  const justificationGap = useMemo(
    () =>
      authorizableRows.some(
        (row) =>
          draft[row.key]?.authorized &&
          policy.requireJustification &&
          !draft[row.key]?.justification?.trim()
      ),
    [authorizableRows, draft, policy.requireJustification]
  )

  // Don't render anything if the policy is disabled or the kit isn't
  // black-hat. We keep this check after the hooks so React doesn't
  // complain about hook order between renders.
  if (!policy.enabled || !hasActiveBlackHat) {
    return null
  }

  const handleToggle = (key: string, checked: boolean) => {
    setDraft((prev) => ({
      ...prev,
      [key]: {
        authorized: checked,
        justification: prev[key]?.justification ?? '',
      },
    }))
  }

  const handleJustificationChange = (key: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [key]: {
        authorized: prev[key]?.authorized ?? false,
        justification: value,
      },
    }))
  }

  const handleAuthorizeAll = () => {
    setDraft((prev) => {
      const next = { ...prev }
      for (const row of authorizableRows) {
        next[row.key] = {
          authorized: true,
          justification: prev[row.key]?.justification ?? '',
        }
      }
      return next
    })
  }

  const handleSave = async () => {
    if (!kitSerialNumber || saving) return

    if (justificationGap) {
      toast.error('Justification required', {
        description:
          'Your organization requires a description for each authorized line.',
      })
      return
    }

    const newlyAuthorized = authorizableRows
      .filter((row) => draft[row.key]?.authorized)
      .map((row) => ({
        partNumber: row.partNumber.trim(),
        description: (draft[row.key]?.justification ?? '').trim(),
      }))

    if (newlyAuthorized.length === 0) {
      toast.info('No lines selected', {
        description: 'Tick at least one missing line to authorize.',
      })
      return
    }

    // Merge with whatever is already on the kit. Keep the existing
    // descriptions for any part numbers we are not re-authorizing
    // here, and let the panel's draft win for the ones we are.
    const draftPartNumbersUpper = new Set(
      newlyAuthorized.map((item) => item.partNumber.toUpperCase())
    )
    const existingPreserved = existingAuthorizedItems
      .filter(
        (item) =>
          !draftPartNumbersUpper.has(item.partNumber.trim().toUpperCase())
      )
      .map((item) => ({
        partNumber: item.partNumber,
        description: item.description,
      }))

    const merged = [...existingPreserved, ...newlyAuthorized].slice(0, 7)

    setSaving(true)
    try {
      const result = await RRKittingDataService.updateAuthorizedShipShortItems(
        kitSerialNumber,
        merged
      )

      if (!result.success) {
        toast.error('Failed to authorize ship short', {
          description: result.error || 'An unexpected error occurred.',
        })
        return
      }

      const baseDescription = `${newlyAuthorized.length} part${newlyAuthorized.length === 1 ? '' : 's'} authorized for ${kitPoNumber || 'this kit'}.`
      const coverageNote = result.flagCleared
        ? ' Black Hat cleared — kit can now be picked.'
        : result.bomCoverageComplete === false
          ? ' BOM coverage still incomplete — Black Hat remains.'
          : ''

      toast.success('Ship-short authorized', {
        description: baseDescription + coverageNote,
      })

      await onSaved({
        event: 'ship_short_authorized',
        count: newlyAuthorized.length,
        flagCleared: !!result.flagCleared,
        bomCoverageComplete: result.bomCoverageComplete,
      })
    } catch (err) {
      logger.error('[BlackHatShipShortPanel] save error:', err)
      toast.error('Failed to authorize ship short')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card
        data-testid='black-hat-ship-short-panel'
        className={cn(
          'overflow-hidden border-2 border-gray-900/40 bg-gray-900/4',
          'dark:border-gray-100/30 dark:bg-gray-100/4'
        )}
      >
        <CardHeader className='pb-3'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='flex items-start gap-3'>
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                  'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                )}
              >
                <HardHat className='h-5 w-5' />
              </div>
              <div className='space-y-1'>
                <CardTitle className='flex items-center gap-2 text-lg font-semibold'>
                  Picking Blocked — Authorize Ship Short
                  <Badge
                    variant='outline'
                    className='border-gray-900/40 bg-gray-900/10 text-gray-900 dark:border-gray-100/40 dark:bg-gray-100/10 dark:text-gray-100'
                  >
                    Black Hat
                  </Badge>
                </CardTitle>
                <p className='text-muted-foreground text-xs'>
                  This kit is blocked because the components below have no
                  matching imported TO row, INCORA item, or existing ship-short
                  authorization. Authorize them line by line to unblock picking
                  and partially ship the kit.
                </p>
              </div>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              {!policy.requireLineByLineApproval &&
                authorizableRows.length > 0 && (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleAuthorizeAll}
                    disabled={saving || loading}
                    className='shrink-0'
                  >
                    <CheckCircle2 className='mr-2 h-4 w-4' />
                    Authorize All Missing
                  </Button>
                )}
              {authorizableRows.length > 0 && (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setShowAddTODialog(true)}
                  disabled={saving || loading}
                  className='shrink-0'
                  title='Import Transfer Orders to satisfy missing BOM components — Black Hat clears when every missing line is covered by a TO, INCORA item, or Ship-Short authorization.'
                >
                  <Package className='mr-2 h-4 w-4' />
                  Add TO to Clear Black Hat
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-3'>
          {loading ? (
            <div className='text-muted-foreground flex items-center gap-2 py-2 text-sm'>
              <Loader2 className='h-4 w-4 animate-spin' />
              Loading missing BOM components...
            </div>
          ) : authorizableRows.length === 0 && missing.length === 0 ? (
            <div className='flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300'>
              <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
              <span>
                Could not resolve the BOM components that are driving the Black
                Hat. Use the <strong>Edit Ship Short</strong> button at the top
                of the dialog to add authorizations by hand, or remove the Black
                Hat flag manually if the kit no longer requires the missing
                parts.
              </span>
            </div>
          ) : (
            <>
              <ul className='space-y-2'>
                {missing.map((row) => {
                  const state = draft[row.key] ?? {
                    authorized: false,
                    justification: '',
                  }
                  return (
                    <li
                      key={row.key}
                      className={cn(
                        'rounded-lg border p-3 transition-colors',
                        state.authorized
                          ? 'border-amber-500/40 bg-amber-500/8'
                          : 'border-border bg-background',
                        row.unauthorizable && 'opacity-60'
                      )}
                    >
                      <div className='flex items-start gap-3'>
                        <Checkbox
                          checked={state.authorized}
                          onCheckedChange={(checked) =>
                            handleToggle(row.key, checked === true)
                          }
                          disabled={saving || loading || row.unauthorizable}
                          aria-label={`Authorize ${row.partNumber} to ship short`}
                          className='mt-0.5'
                        />
                        <div className='min-w-0 flex-1 space-y-2'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='font-mono text-sm font-medium'>
                              {row.partNumber}
                            </span>
                            {row.componentType === 'incora_component' && (
                              <Badge variant='outline' className='text-[10px]'>
                                INCORA Component
                              </Badge>
                            )}
                            {row.componentType === 'incora_sub_kit' && (
                              <Badge variant='outline' className='text-[10px]'>
                                INCORA Sub-Kit
                              </Badge>
                            )}
                          </div>
                          {row.description && (
                            <p className='text-muted-foreground text-xs'>
                              {row.description}
                            </p>
                          )}
                          {row.unauthorizable ? (
                            <p className='text-muted-foreground text-xs italic'>
                              INCORA Sub-Kit rows cannot be cleared via
                              ship-short — add the INCORA reference to the kit's
                              INCORA Items list instead.
                            </p>
                          ) : state.authorized ? (
                            <Input
                              value={state.justification}
                              onChange={(e) =>
                                handleJustificationChange(
                                  row.key,
                                  e.target.value
                                )
                              }
                              placeholder={
                                policy.requireJustification
                                  ? 'Justification (required) — e.g., expedite ETA 2026-05-21'
                                  : 'Justification (optional)'
                              }
                              disabled={saving}
                              className={cn(
                                'h-8 text-sm',
                                policy.requireJustification &&
                                  !state.justification.trim() &&
                                  'border-destructive/60 focus-visible:ring-destructive/40'
                              )}
                              aria-label={`Justification for ${row.partNumber}`}
                            />
                          ) : null}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>

              <div className='flex flex-wrap items-center justify-between gap-2 pt-1'>
                <div className='text-muted-foreground text-xs'>
                  {selectedCount} of {authorizableRows.length} selected
                  {policy.requireJustification && ' · justification required'}
                </div>
                <Button
                  onClick={handleSave}
                  disabled={
                    saving || loading || selectedCount === 0 || justificationGap
                  }
                  className='gap-2'
                >
                  {saving ? (
                    <>
                      <Loader2 className='h-4 w-4 animate-spin' />
                      Authorizing...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className='h-4 w-4' />
                      Authorize Selected ({selectedCount})
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Sibling on-ramp: import TOs to satisfy missing BOM components.
          Mounted inside the same motion wrapper so it inherits the
          panel's mount/unmount lifecycle. The dialog is self-driven
          (clipboard paste → preview → submit); on success it calls
          `handleAddTOSubmitted` which bumps the local refresh counter
          and notifies the parent. */}
      <AddTOForBlackHatDialog
        isOpen={showAddTODialog}
        onOpenChange={setShowAddTODialog}
        kitSerialNumber={kitSerialNumber}
        kitPoNumber={kitPoNumber}
        missingMaterials={missingMaterialsForTO}
        onSubmitted={handleAddTOSubmitted}
      />
    </motion.div>
  )
}

// Created and developed by Jai Singh
