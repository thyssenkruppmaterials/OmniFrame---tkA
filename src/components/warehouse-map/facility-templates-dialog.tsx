// Created and developed by Jai Singh
/**
 * FacilityTemplatesDialog — the facility library.
 *
 * Save the CURRENT layout as a named, typed template ("Standard DC", "Cold
 * Storage"…), browse the org's templates, and stamp out NEW facilities from a
 * template (or blank). Creating a facility makes a fresh warehouse_maps row
 * with remapped zones/racks/scene objects/aisle graph — location mappings are
 * facility-specific and never copied. The new facility's code is pushed back
 * to the shell so the picker switches straight to it.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  Loader2,
  Plus,
  Save,
  Trash2,
  Warehouse as WarehouseIcon,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { usePermissionStore } from '@/stores/permissionStore'
import { warehouseLayoutTemplatesService } from '@/lib/supabase/warehouse-layout-templates.service'
import { Button } from '@/components/ui/button'
import type { FacilityKind, WarehouseLayoutTemplate } from './types'

const KIND_LABEL: Record<FacilityKind, string> = {
  warehouse: 'Warehouse',
  distribution_center: 'Distribution Center',
  cold_storage: 'Cold Storage',
  manufacturing: 'Manufacturing',
  cross_dock: 'Cross-dock',
  fulfillment: 'Fulfillment Center',
  yard: 'Yard / Outdoor',
  other: 'Other',
}

interface FacilityTemplatesDialogProps {
  open: boolean
  /** Current map (null when no map is loaded — saving is disabled, creating works). */
  mapId: string | null
  currentLabel?: string
  onClose: () => void
  /** A new facility was created — switch the shell to its warehouse code. */
  onFacilityCreated: (warehouseCode: string) => void
}

interface TemplateStatsView {
  zones?: number
  racks?: number
  locations?: number
  scene_objects?: number
  area_m2?: number
}

function statsLine(t: WarehouseLayoutTemplate): string {
  const s = (t.stats ?? {}) as TemplateStatsView
  const parts: string[] = []
  if (s.area_m2) parts.push(`${s.area_m2.toLocaleString()} m²`)
  parts.push(`${s.racks ?? 0} racks`)
  parts.push(`${(s.locations ?? 0).toLocaleString()} locations`)
  parts.push(`${s.scene_objects ?? 0} objects`)
  return parts.join(' · ')
}

export function FacilityTemplatesDialog({
  open,
  mapId,
  currentLabel,
  onClose,
  onFacilityCreated,
}: FacilityTemplatesDialogProps) {
  const qc = useQueryClient()
  const hasPermission = usePermissionStore((s) => s.hasPermission)
  const canManage = hasPermission('manage', 'warehouse_maps')

  // Save-as-template form
  const [name, setName] = useState('')
  const [kind, setKind] = useState<FacilityKind>('warehouse')
  const [description, setDescription] = useState('')

  // New-facility form ('blank' or a template id; null = closed)
  const [createFrom, setCreateFrom] = useState<string | null>(null)
  const [facilityCode, setFacilityCode] = useState('')
  const [facilityName, setFacilityName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['warehouse-layout-templates'],
    queryFn: () => warehouseLayoutTemplatesService.list(),
    enabled: open,
    staleTime: 30_000,
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      warehouseLayoutTemplatesService.captureFromMap(mapId!, {
        name: name.trim(),
        facility_kind: kind,
        description: description.trim() || undefined,
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['warehouse-layout-templates'] })
      setName('')
      setDescription('')
      toast.success(`Template "${t.name}" saved.`)
    },
    onError: (e) =>
      toast.error("Couldn't save the template.", {
        description: e instanceof Error ? e.message : 'Unknown error',
      }),
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const template =
        createFrom && createFrom !== 'blank'
          ? (templates.find((t) => t.id === createFrom) ?? null)
          : null
      return warehouseLayoutTemplatesService.createFacility(template, {
        warehouse_code: facilityCode,
        name: facilityName,
      })
    },
    onSuccess: (map) => {
      qc.invalidateQueries({ queryKey: ['warehouse-maps-list'] })
      qc.invalidateQueries({ queryKey: ['warehouse-map', map.warehouse_code] })
      toast.success(`Facility "${map.name}" created.`)
      setCreateFrom(null)
      setFacilityCode('')
      setFacilityName('')
      onFacilityCreated(map.warehouse_code)
      onClose()
    },
    onError: (e) =>
      toast.error("Couldn't create the facility.", {
        description: e instanceof Error ? e.message : 'Unknown error',
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => warehouseLayoutTemplatesService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouse-layout-templates'] })
      setConfirmDelete(null)
      toast.success('Template deleted.')
    },
    onError: (e) =>
      toast.error("Couldn't delete the template.", {
        description: e instanceof Error ? e.message : 'Unknown error',
      }),
  })

  if (!open) return null

  const creatingValid =
    facilityCode.trim().length > 0 && facilityName.trim().length > 0

  const createForm = (sourceLabel: string) => (
    <div className='bg-muted/40 mt-2 flex flex-col gap-2 rounded-md border p-2'>
      <span className='text-muted-foreground text-[11px]'>
        New facility from {sourceLabel} — the code appears in the warehouse
        picker (bins are not copied).
      </span>
      <div className='flex gap-2'>
        <input
          type='text'
          value={facilityCode}
          placeholder='Code (e.g. DC-EAST)'
          onChange={(e) => setFacilityCode(e.target.value.toUpperCase())}
          className='bg-background w-36 rounded-md border px-2 py-1.5 text-xs'
        />
        <input
          type='text'
          value={facilityName}
          placeholder='Facility name'
          onChange={(e) => setFacilityName(e.target.value)}
          className='bg-background flex-1 rounded-md border px-2 py-1.5 text-xs'
        />
        <Button
          size='sm'
          disabled={!creatingValid || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? (
            <Loader2 className='h-3.5 w-3.5 animate-spin' />
          ) : (
            'Create'
          )}
        </Button>
      </div>
    </div>
  )

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
      <div className='bg-card flex max-h-[85vh] w-[560px] max-w-full flex-col rounded-lg border shadow-xl'>
        <div className='flex items-center justify-between border-b px-4 py-3'>
          <h3 className='flex items-center gap-2 text-sm font-semibold'>
            <Building2 className='h-4 w-4' /> Facilities &amp; layout templates
          </h3>
          <button
            type='button'
            onClick={onClose}
            aria-label='Close'
            className='text-muted-foreground hover:text-foreground rounded p-0.5'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        <div className='flex flex-col gap-4 overflow-y-auto p-4'>
          {/* Save the current layout */}
          {canManage && mapId && (
            <section className='flex flex-col gap-2'>
              <h4 className='text-muted-foreground text-[11px] font-semibold uppercase'>
                Save current layout{currentLabel ? ` (${currentLabel})` : ''} as
                a template
              </h4>
              <div className='flex gap-2'>
                <input
                  type='text'
                  value={name}
                  placeholder='Template name (e.g. Standard DC)'
                  onChange={(e) => setName(e.target.value)}
                  className='bg-background flex-1 rounded-md border px-2 py-1.5 text-xs'
                />
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as FacilityKind)}
                  className='bg-background w-44 rounded-md border px-2 py-1.5 text-xs'
                >
                  {(Object.keys(KIND_LABEL) as FacilityKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className='flex gap-2'>
                <input
                  type='text'
                  value={description}
                  placeholder='Description (optional)'
                  onChange={(e) => setDescription(e.target.value)}
                  className='bg-background flex-1 rounded-md border px-2 py-1.5 text-xs'
                />
                <Button
                  size='sm'
                  disabled={!name.trim() || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
                  ) : (
                    <Save className='mr-1 h-3.5 w-3.5' />
                  )}
                  Save template
                </Button>
              </div>
            </section>
          )}

          {/* Template library */}
          <section className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <h4 className='text-muted-foreground text-[11px] font-semibold uppercase'>
                Template library
              </h4>
              {canManage && (
                <button
                  type='button'
                  onClick={() => {
                    setCreateFrom(createFrom === 'blank' ? null : 'blank')
                    setConfirmDelete(null)
                  }}
                  className='text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] underline'
                >
                  <Plus className='h-3 w-3' /> Blank facility
                </button>
              )}
            </div>

            {createFrom === 'blank' && createForm('a blank layout')}

            {isLoading ? (
              <p className='text-muted-foreground py-4 text-center text-xs'>
                Loading templates…
              </p>
            ) : templates.length === 0 ? (
              <p className='text-muted-foreground py-4 text-center text-xs'>
                No templates yet — lay out a facility, then save it here to
                reuse it for the next building.
              </p>
            ) : (
              <ul className='flex flex-col gap-2'>
                {templates.map((t) => (
                  <li key={t.id} className='rounded-md border p-2.5'>
                    <div className='flex items-start gap-2'>
                      <WarehouseIcon className='text-muted-foreground mt-0.5 h-4 w-4 shrink-0' />
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='truncate text-sm font-medium'>
                            {t.name}
                          </span>
                          <span className='bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]'>
                            {KIND_LABEL[t.facility_kind] ?? t.facility_kind}
                          </span>
                        </div>
                        <div className='text-muted-foreground text-[11px]'>
                          {statsLine(t)}
                        </div>
                        {t.description && (
                          <div className='text-muted-foreground mt-0.5 truncate text-[11px]'>
                            {t.description}
                          </div>
                        )}
                      </div>
                      {canManage && (
                        <div className='flex shrink-0 items-center gap-1'>
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => {
                              setCreateFrom(createFrom === t.id ? null : t.id)
                              setConfirmDelete(null)
                            }}
                          >
                            New facility…
                          </Button>
                          {confirmDelete === t.id ? (
                            <Button
                              size='sm'
                              variant='destructive'
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteMutation.mutate(t.id)}
                            >
                              Confirm
                            </Button>
                          ) : (
                            <Button
                              size='icon'
                              variant='ghost'
                              aria-label={`Delete template ${t.name}`}
                              onClick={() => setConfirmDelete(t.id)}
                            >
                              <Trash2 className='h-3.5 w-3.5 text-red-500' />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    {createFrom === t.id && createForm(`"${t.name}"`)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
