// Created and developed by Jai Singh
import { useState } from 'react'
import {
  workEngineSettingsService,
  type WorkTypeSettingsRow,
} from '@/lib/supabase/work-engine-settings.service'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

interface Props {
  orgId: string | null
  types: WorkTypeSettingsRow[]
  onChange: () => void
}

export function PerWorkTypeTab({ orgId, types, onChange }: Props) {
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function patch(taskType: string, p: Partial<WorkTypeSettingsRow>) {
    if (!orgId) return
    setError(null)
    setPending(taskType)
    try {
      await workEngineSettingsService.updateWorkTypeSettings(orgId, taskType, p)
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className='space-y-3'>
      {error && (
        <Card className='border-rose-500/50 bg-rose-500/5 p-3 text-sm text-rose-600'>
          {error}
        </Card>
      )}
      {types.map((row) => (
        <Card key={row.task_type} className='space-y-3 p-4'>
          <div className='flex items-center justify-between'>
            <div>
              <div className='font-medium capitalize'>
                {row.task_type.replace('_', ' ')}
              </div>
              <div className='text-muted-foreground text-xs'>
                Default priority: {row.default_priority} · payload v
                {row.payload_schema_version}
              </div>
            </div>
            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground text-xs'>Enabled</span>
              <Switch
                checked={row.enabled}
                onCheckedChange={(v) => patch(row.task_type, { enabled: v })}
                disabled={pending === row.task_type}
              />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-3 text-sm md:grid-cols-4'>
            <NumberField
              label='Capacity / worker'
              value={row.capacity_per_worker}
              min={1}
              onCommit={(v) => patch(row.task_type, { capacity_per_worker: v })}
            />
            <NumberField
              label='Abandonment (min)'
              value={row.abandonment_minutes}
              min={1}
              onCommit={(v) => patch(row.task_type, { abandonment_minutes: v })}
            />
            <NumberField
              label='Reservation escalation (min)'
              value={row.reservation_escalation_minutes}
              min={1}
              onCommit={(v) =>
                patch(row.task_type, { reservation_escalation_minutes: v })
              }
            />
            <NumberField
              label='Heartbeat release (min)'
              value={row.heartbeat_release_minutes}
              min={1}
              onCommit={(v) =>
                patch(row.task_type, { heartbeat_release_minutes: v })
              }
            />
          </div>

          <div className='flex items-center gap-4 text-sm'>
            <ToggleRow
              label='Push enabled'
              value={row.push_enabled}
              onChange={(v) => patch(row.task_type, { push_enabled: v })}
            />
            <ToggleRow
              label='Pull enabled'
              value={row.pull_enabled}
              onChange={(v) => patch(row.task_type, { pull_enabled: v })}
            />
            <ToggleRow
              label='Batch push'
              value={row.batch_push_enabled}
              onChange={(v) => patch(row.task_type, { batch_push_enabled: v })}
            />
            <ToggleRow
              label='Require capability'
              value={row.require_capability}
              onChange={(v) => patch(row.task_type, { require_capability: v })}
            />
            <ToggleRow
              label='Require zone assignment'
              value={row.require_zone_assignment}
              onChange={(v) =>
                patch(row.task_type, { require_zone_assignment: v })
              }
            />
          </div>
        </Card>
      ))}
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  onCommit: (v: number) => void
}) {
  const [local, setLocal] = useState(String(value))
  return (
    <label className='space-y-1'>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <Input
        type='number'
        min={min}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = Number(local)
          if (Number.isFinite(n) && n !== value) onCommit(n)
        }}
      />
    </label>
  )
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className='text-muted-foreground flex items-center gap-2 text-xs'>
      <Switch checked={value} onCheckedChange={onChange} />
      {label}
    </label>
  )
}

// Created and developed by Jai Singh
