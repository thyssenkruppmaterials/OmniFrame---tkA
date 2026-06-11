// Created and developed by Jai Singh
import { useState } from 'react'
import {
  workEngineSettingsService,
  type WorkTypeSettingsRow,
  type WarehouseOverrideRow,
} from '@/lib/supabase/work-engine-settings.service'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface Props {
  orgId: string | null
  types: WorkTypeSettingsRow[]
  overrides: WarehouseOverrideRow[]
  onChange: () => void
}

export function PerWarehouseOverridesTab({
  orgId,
  types,
  overrides,
  onChange,
}: Props) {
  const [draftType, setDraftType] = useState<string>(types[0]?.task_type ?? '')
  const [draftWarehouse, setDraftWarehouse] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (!orgId || !draftType || !draftWarehouse.trim()) return
    setError(null)
    try {
      await workEngineSettingsService.upsertWarehouseOverride({
        organization_id: orgId,
        task_type: draftType,
        warehouse: draftWarehouse.trim(),
        enabled: null,
        capacity_per_worker: null,
        default_priority: null,
        notes: null,
      })
      setDraftWarehouse('')
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function remove(row: WarehouseOverrideRow) {
    if (!orgId) return
    setError(null)
    try {
      await workEngineSettingsService.deleteWarehouseOverride(
        orgId,
        row.task_type,
        row.warehouse
      )
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function patch(
    row: WarehouseOverrideRow,
    p: Partial<WarehouseOverrideRow>
  ) {
    if (!orgId) return
    setError(null)
    try {
      await workEngineSettingsService.upsertWarehouseOverride({ ...row, ...p })
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className='space-y-3'>
      {error && (
        <Card className='border-rose-500/50 bg-rose-500/5 p-3 text-sm text-rose-600'>
          {error}
        </Card>
      )}

      <Card className='space-y-3 p-4'>
        <div className='text-sm font-medium'>Add override</div>
        <div className='flex flex-wrap items-end gap-3'>
          <label className='space-y-1'>
            <span className='text-muted-foreground text-xs'>Work type</span>
            <select
              value={draftType}
              onChange={(e) => setDraftType(e.target.value)}
              className='bg-background h-9 rounded-md border px-3 text-sm'
            >
              {types.map((t) => (
                <option key={t.task_type} value={t.task_type}>
                  {t.task_type}
                </option>
              ))}
            </select>
          </label>
          <label className='space-y-1'>
            <span className='text-muted-foreground text-xs'>
              Warehouse code
            </span>
            <Input
              value={draftWarehouse}
              onChange={(e) => setDraftWarehouse(e.target.value)}
              placeholder='e.g. PDC'
            />
          </label>
          <Button onClick={add} disabled={!draftWarehouse.trim() || !draftType}>
            + Add override
          </Button>
        </div>
      </Card>

      <Card className='overflow-x-auto p-0'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/40 text-xs tracking-wide uppercase'>
            <tr>
              <th className='px-3 py-2 text-left'>Type</th>
              <th className='px-3 py-2 text-left'>Warehouse</th>
              <th className='px-3 py-2 text-left'>Enabled</th>
              <th className='px-3 py-2 text-left'>Capacity</th>
              <th className='px-3 py-2 text-left'>Default Priority</th>
              <th className='px-3 py-2 text-left'>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {overrides.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className='text-muted-foreground px-3 py-6 text-center'
                >
                  No warehouse overrides — every warehouse uses the
                  per-work-type defaults.
                </td>
              </tr>
            )}
            {overrides.map((row) => (
              <tr
                key={`${row.task_type}-${row.warehouse}`}
                className='border-t'
              >
                <td className='px-3 py-2'>{row.task_type}</td>
                <td className='px-3 py-2'>{row.warehouse}</td>
                <td className='px-3 py-2'>
                  <select
                    value={row.enabled === null ? '' : String(row.enabled)}
                    onChange={(e) =>
                      patch(row, {
                        enabled:
                          e.target.value === ''
                            ? null
                            : e.target.value === 'true',
                      })
                    }
                    className='bg-background h-8 rounded border px-2 text-xs'
                  >
                    <option value=''>(default)</option>
                    <option value='true'>true</option>
                    <option value='false'>false</option>
                  </select>
                </td>
                <td className='px-3 py-2'>
                  <Input
                    type='number'
                    className='h-8 w-20'
                    value={row.capacity_per_worker ?? ''}
                    onChange={(e) =>
                      patch(row, {
                        capacity_per_worker:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </td>
                <td className='px-3 py-2'>
                  <select
                    value={row.default_priority ?? ''}
                    onChange={(e) =>
                      patch(row, {
                        default_priority:
                          e.target.value === ''
                            ? null
                            : (e.target
                                .value as WarehouseOverrideRow['default_priority']),
                      })
                    }
                    className='bg-background h-8 rounded border px-2 text-xs'
                  >
                    <option value=''>(default)</option>
                    <option value='critical'>critical</option>
                    <option value='hot'>hot</option>
                    <option value='normal'>normal</option>
                    <option value='low'>low</option>
                  </select>
                </td>
                <td className='px-3 py-2'>
                  <Input
                    className='h-8 w-48'
                    value={row.notes ?? ''}
                    onChange={(e) =>
                      patch(row, { notes: e.target.value || null })
                    }
                  />
                </td>
                <td className='px-3 py-2'>
                  <Button variant='ghost' size='sm' onClick={() => remove(row)}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// Created and developed by Jai Singh
