// Created and developed by Jai Singh
/**
 * NonWarehouseBinNotice — inline acknowledgement panel rendered inside
 * the Add Kit Build Plan dialog when one or more imported TO rows
 * carry a `sourceStorageBin` matching a configured non-warehouse
 * pattern (default `NEEDBIN`).
 *
 * Behaviour:
 *   - Surfaces every offending TO line so the operator can scan the
 *     list before committing.
 *   - Hosts the "I acknowledge…" checkbox the parent uses to gate the
 *     dialog's submit button.
 *   - Self-hides when there are no matches — safe to mount
 *     unconditionally inside the dialog.
 *
 * The acknowledgement is checkbox-state in the parent component (not
 * persisted) because the kit creation itself is the durable record:
 * the TOs land in `RR_Kitting_DATA` with their non-warehouse bins
 * intact, and the operator's audit-trail entry is the Kit Notes
 * system message stamped by the dialog after submit (see
 * [[Persist-Kit-Notes-Chat-Thread]] + the wiring in
 * `KittingDataManager.handleAddPlan`).
 */
import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { NonWarehouseBinDetection } from '@/lib/kitting/non-warehouse-bins'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

interface NonWarehouseBinNoticeProps {
  detection: NonWarehouseBinDetection
  acknowledged: boolean
  onAcknowledgedChange: (value: boolean) => void
  disabled?: boolean
  /** Optional tweak to the acknowledgement label for surfaces that need different copy. */
  acknowledgementLabel?: string
}

export function NonWarehouseBinNotice({
  detection,
  acknowledged,
  onAcknowledgedChange,
  disabled = false,
  acknowledgementLabel,
}: NonWarehouseBinNoticeProps) {
  const { matches } = detection

  // Group matches by source bin so the operator sees "112NEEDBIN — 3 TOs"
  // rather than a long flat list when the same plant bin shows up many
  // times in a single import.
  const grouped = useMemo(() => {
    const byBin = new Map<string, typeof matches>()
    for (const match of matches) {
      const key = match.sourceStorageBin
      if (!byBin.has(key)) byBin.set(key, [])
      byBin.get(key)!.push(match)
    }
    return [...byBin.entries()].map(([bin, m]) => ({ bin, matches: m }))
  }, [matches])

  if (!detection.hasMatches) return null

  return (
    <div
      role='alert'
      aria-live='polite'
      data-testid='non-warehouse-bin-notice'
      className={cn(
        'space-y-3 rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-4',
        'dark:border-amber-400/40 dark:bg-amber-400/10'
      )}
    >
      <div className='flex items-start gap-3'>
        <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20'>
          <AlertTriangle className='h-4 w-4 text-amber-700 dark:text-amber-300' />
        </div>
        <div className='space-y-1'>
          <p className='text-sm font-semibold text-amber-800 dark:text-amber-200'>
            External Plant Bins Detected
          </p>
          <p className='text-xs leading-relaxed text-amber-800/90 dark:text-amber-200/90'>
            {detection.matches.length} Transfer Order
            {detection.matches.length === 1 ? '' : 's'} reference a source bin
            that lives at the plant rather than inside our warehouse. These
            materials cannot be picked from our floor — you'll need to handle
            them on the plant side. Review the list below and acknowledge before
            saving the kit.
          </p>
          <div className='mt-2 flex flex-wrap gap-1.5'>
            {detection.patternsTriggered.map((pattern) => (
              <Badge
                key={pattern}
                variant='outline'
                className='border-amber-500/50 bg-amber-500/10 text-[10px] text-amber-800 dark:text-amber-200'
              >
                Matched pattern:{' '}
                <span className='ml-1 font-mono'>{pattern}</span>
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className='space-y-2'>
        {grouped.map(({ bin, matches }) => (
          <div
            key={bin}
            className='bg-background/60 rounded-md border border-amber-500/30 p-3'
          >
            <div className='mb-2 flex items-center justify-between gap-2'>
              <span className='font-mono text-xs font-semibold text-amber-700 dark:text-amber-300'>
                {bin}
              </span>
              <Badge variant='outline' className='text-[10px]'>
                {matches.length} TO{matches.length === 1 ? '' : 's'}
              </Badge>
            </div>
            <ul className='space-y-1 text-xs'>
              {matches.map((match, idx) => (
                <li
                  key={`${bin}-${match.record.transferOrderNumber}-${idx}`}
                  className='flex flex-wrap items-center gap-2'
                >
                  <span className='text-foreground/80 font-mono'>
                    TO {match.record.transferOrderNumber || '—'}
                  </span>
                  <span className='text-muted-foreground'>·</span>
                  <span className='text-foreground/70 font-mono'>
                    {match.record.material || '—'}
                  </span>
                  {match.record.materialDescription && (
                    <span className='text-muted-foreground truncate'>
                      — {match.record.materialDescription}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <label
        className={cn(
          'bg-background/70 flex items-start gap-2 rounded-md border border-amber-500/40 p-3 text-sm',
          disabled && 'opacity-60'
        )}
      >
        <Checkbox
          checked={acknowledged}
          onCheckedChange={(checked) => onAcknowledgedChange(checked === true)}
          disabled={disabled}
          aria-label='Acknowledge external plant bins'
          className='mt-0.5'
        />
        <span className='text-amber-900 dark:text-amber-100'>
          {acknowledgementLabel ||
            "I acknowledge that the materials above live at the plant. I'll coordinate with the plant team to deliver them and won't expect them to be picked from our warehouse."}
        </span>
      </label>
    </div>
  )
}

// Created and developed by Jai Singh
