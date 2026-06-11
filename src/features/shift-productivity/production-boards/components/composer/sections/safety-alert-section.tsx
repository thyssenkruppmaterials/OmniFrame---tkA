// Created and developed by Jai Singh
/**
 * Safety-alert-specific extras section.
 *
 * Four extras:
 *   - Hazard type (Spill / Electrical / Fire / Chemical / Fall / …) via
 *     a `<Select>` (10+ options — ToggleGroup would wrap awkwardly).
 *   - Affected working areas (multi-select).
 *   - Corrective action (Textarea).
 *
 * Severity, acknowledgment-required, and the reprompt-interval timer
 * live on the shell (the latter two are conceptually "alert behaviour"
 * which is shared with future ack-required announcement posts).
 */
import { Label } from '@/components/ui/label'
import { MultiSelect } from '@/components/ui/multi-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  SAFETY_HAZARD_TYPES,
  type SafetyAlertKindData,
} from '../composer-types'
import { Section } from '../section'

interface SafetyAlertSectionProps {
  kindData: SafetyAlertKindData
  onChange: (next: SafetyAlertKindData) => void
  workingAreaOptions: { id: string; label: string }[]
  disabled?: boolean
}

export function SafetyAlertSection({
  kindData,
  onChange,
  workingAreaOptions,
  disabled,
}: SafetyAlertSectionProps) {
  const patch = (delta: Partial<SafetyAlertKindData>): void => {
    onChange({ ...kindData, ...delta })
  }

  const multiSelectOptions = workingAreaOptions.map((a) => ({
    value: a.id,
    label: a.label,
  }))

  return (
    <Section
      title='Safety details'
      description='Hazard classification + affected areas + corrective action.'
    >
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='safety-hazard-type'>Hazard type</Label>
          <Select
            value={kindData.hazard_type ?? ''}
            onValueChange={(v) =>
              patch({
                hazard_type:
                  (v as SafetyAlertKindData['hazard_type']) || undefined,
              })
            }
            disabled={disabled}
          >
            <SelectTrigger id='safety-hazard-type'>
              <SelectValue placeholder='Select…' />
            </SelectTrigger>
            <SelectContent>
              {SAFETY_HAZARD_TYPES.map((h) => (
                <SelectItem key={h} value={h} className='capitalize'>
                  {h.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label>Affected working areas</Label>
          <MultiSelect
            options={multiSelectOptions}
            selected={kindData.affected_area_ids ?? []}
            onSelectionChange={(next) =>
              patch({
                affected_area_ids: next.length ? next : undefined,
              })
            }
            placeholder='All areas (none selected)'
            disabled={disabled}
          />
        </div>
      </div>

      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='safety-corrective-action'>Corrective action</Label>
        <Textarea
          id='safety-corrective-action'
          rows={3}
          placeholder='Spill kit deployed; cones placed; supervisor notified at 09:14.'
          value={kindData.corrective_action ?? ''}
          onChange={(e) =>
            patch({ corrective_action: e.target.value || undefined })
          }
          disabled={disabled}
        />
      </div>
    </Section>
  )
}

// Created and developed by Jai Singh
