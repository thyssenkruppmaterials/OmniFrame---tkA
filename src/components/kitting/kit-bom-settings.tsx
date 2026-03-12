'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  CheckCircle2,
  Edit,
  Loader2,
  Package,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  KitDefinitionsService,
  type BomComponent,
  type KitDefinitionRecord,
} from '@/lib/supabase/kit-definitions.service'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

const ENGINE_PROGRAMS = [
  '1107C',
  '2100D2A',
  '2100D3 (40/50)',
  '2100D3 (40/50 WGB)',
  '2100D3 (60/90)',
  '2100D3 (60/90 WGB)',
  '3007H',
  '3007N',
  'A427',
  'B17F',
  'C20W',
  'C30HU',
  'C47E',
  'KS4',
  'Liftfan',
  'Liftworks',
  'MT5S HE+',
  'MT7',
  'RR300',
]

interface BomEditorRow extends BomComponent {
  _key: number
}

let rowKeyCounter = 0

function emptyRow(): BomEditorRow {
  return {
    materialNumber: '',
    materialDescription: '',
    requiredQuantity: 1,
    _key: ++rowKeyCounter,
  }
}

// ---------- BOM inline editor ----------
function BomEditor({
  value,
  onChange,
  disabled,
}: {
  value: BomComponent[]
  onChange: (v: BomComponent[]) => void
  disabled?: boolean
}) {
  const [rows, setRows] = useState<BomEditorRow[]>(() =>
    value.length > 0
      ? value.map((c) => ({ ...c, _key: ++rowKeyCounter }))
      : [emptyRow()]
  )

  useEffect(() => {
    onChange(
      rows.map(({ materialNumber, materialDescription, requiredQuantity }) => ({
        materialNumber,
        materialDescription,
        requiredQuantity,
      }))
    )
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (
    idx: number,
    field: keyof BomComponent,
    val: string | number
  ) =>
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r))
    )

  const addRow = () => setRows((prev) => [...prev, emptyRow()])
  const removeRow = (idx: number) =>
    setRows((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    )

  return (
    <div className='space-y-2'>
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-10'>#</TableHead>
              <TableHead>Material Number</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className='w-24'>Qty</TableHead>
              <TableHead className='w-10' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={row._key}>
                <TableCell className='text-muted-foreground text-xs'>
                  {idx + 1}
                </TableCell>
                <TableCell>
                  <Input
                    placeholder='e.g. 12345678'
                    value={row.materialNumber}
                    onChange={(e) =>
                      update(idx, 'materialNumber', e.target.value)
                    }
                    disabled={disabled}
                    className='h-8 text-sm'
                  />
                </TableCell>
                <TableCell>
                  <Input
                    placeholder='Material description'
                    value={row.materialDescription}
                    onChange={(e) =>
                      update(idx, 'materialDescription', e.target.value)
                    }
                    disabled={disabled}
                    className='h-8 text-sm'
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type='number'
                    min={1}
                    value={row.requiredQuantity}
                    onChange={(e) =>
                      update(
                        idx,
                        'requiredQuantity',
                        Math.max(1, Number(e.target.value) || 1)
                      )
                    }
                    disabled={disabled}
                    className='h-8 text-sm'
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7'
                    onClick={() => removeRow(idx)}
                    disabled={disabled || rows.length <= 1}
                  >
                    <Trash2 className='text-muted-foreground hover:text-destructive h-3.5 w-3.5' />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={addRow}
        disabled={disabled}
      >
        <Plus className='mr-1 h-3 w-3' /> Add Material
      </Button>
    </div>
  )
}

// ---------- Create / Edit dialog ----------
interface KitFormState {
  kitNumber: string
  kitName: string
  kitDescription: string
  engineProgram: string
  kitType: string
  requiredComponents: BomComponent[]
  assemblyInstructions: string
  estimatedAssemblyTimeMinutes: number | ''
}

const defaultForm: KitFormState = {
  kitNumber: '',
  kitName: '',
  kitDescription: '',
  engineProgram: '',
  kitType: 'standard',
  requiredComponents: [],
  assemblyInstructions: '',
  estimatedAssemblyTimeMinutes: '',
}

function KitDefinitionDialog({
  isOpen,
  onOpenChange,
  editing,
  onSaved,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  editing: KitDefinitionRecord | null
  onSaved: () => void
}) {
  const [form, setForm] = useState<KitFormState>(defaultForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editing) {
      setForm({
        kitNumber: editing.kit_number,
        kitName: editing.kit_name,
        kitDescription: editing.kit_description ?? '',
        engineProgram: editing.engine_program ?? '',
        kitType: editing.kit_type ?? 'standard',
        requiredComponents: (editing.required_components ??
          []) as BomComponent[],
        assemblyInstructions: editing.assembly_instructions ?? '',
        estimatedAssemblyTimeMinutes:
          editing.estimated_assembly_time_minutes ?? '',
      })
    } else {
      setForm(defaultForm)
    }
  }, [editing, isOpen])

  const isValid =
    form.kitNumber.trim() !== '' &&
    form.kitName.trim() !== '' &&
    form.requiredComponents.some((c) => c.materialNumber.trim() !== '')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const components = form.requiredComponents.filter(
        (c) => c.materialNumber.trim() !== ''
      )
      if (editing) {
        const res = await KitDefinitionsService.update({
          id: editing.id,
          kitNumber: form.kitNumber,
          kitName: form.kitName,
          kitDescription: form.kitDescription,
          engineProgram: form.engineProgram,
          kitType: form.kitType,
          requiredComponents: components,
          assemblyInstructions: form.assemblyInstructions,
          estimatedAssemblyTimeMinutes:
            form.estimatedAssemblyTimeMinutes === ''
              ? undefined
              : Number(form.estimatedAssemblyTimeMinutes),
        })
        if (res.success) {
          toast.success('Kit definition updated')
          onSaved()
          onOpenChange(false)
        } else {
          toast.error('Failed to update', { description: res.error })
        }
      } else {
        const res = await KitDefinitionsService.create({
          kitNumber: form.kitNumber,
          kitName: form.kitName,
          kitDescription: form.kitDescription,
          engineProgram: form.engineProgram,
          kitType: form.kitType,
          requiredComponents: components,
          assemblyInstructions: form.assemblyInstructions,
          estimatedAssemblyTimeMinutes:
            form.estimatedAssemblyTimeMinutes === ''
              ? undefined
              : Number(form.estimatedAssemblyTimeMinutes),
        })
        if (res.success) {
          toast.success('Kit definition created')
          onSaved()
          onOpenChange(false)
        } else {
          toast.error('Failed to create', { description: res.error })
        }
      }
    } catch (err) {
      logger.error('[KitBomSettings] save error', err)
      toast.error('Unexpected error')
    }
    setSaving(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-[700px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Package className='h-5 w-5' />
            {editing ? 'Edit Kit Definition' : 'New Kit Definition'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update kit details and bill of materials.'
              : 'Define a new kit with its bill of materials.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-5 py-2'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>
                Kit Number <span className='text-destructive'>*</span>
              </label>
              <Input
                placeholder='e.g. KIT-001'
                value={form.kitNumber}
                onChange={(e) =>
                  setForm((p) => ({ ...p, kitNumber: e.target.value }))
                }
                disabled={saving}
              />
            </div>
            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>
                Kit Name <span className='text-destructive'>*</span>
              </label>
              <Input
                placeholder='e.g. RR300 Engine Kit'
                value={form.kitName}
                onChange={(e) =>
                  setForm((p) => ({ ...p, kitName: e.target.value }))
                }
                disabled={saving}
              />
            </div>
          </div>

          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>Engine Program</label>
              <Select
                value={form.engineProgram}
                onValueChange={(v) =>
                  setForm((p) => ({ ...p, engineProgram: v }))
                }
                disabled={saving}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='Select program' />
                </SelectTrigger>
                <SelectContent>
                  {ENGINE_PROGRAMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>Kit Type</label>
              <Select
                value={form.kitType}
                onValueChange={(v) => setForm((p) => ({ ...p, kitType: v }))}
                disabled={saving}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    'standard',
                    'custom',
                    'promotional',
                    'emergency',
                    'sample',
                  ].map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='space-y-1.5'>
            <label className='text-sm font-medium'>Description</label>
            <Textarea
              placeholder='Optional description'
              value={form.kitDescription}
              onChange={(e) =>
                setForm((p) => ({ ...p, kitDescription: e.target.value }))
              }
              disabled={saving}
              rows={2}
            />
          </div>

          <div className='space-y-1.5'>
            <label className='text-sm font-medium'>
              Bill of Materials <span className='text-destructive'>*</span>
            </label>
            <BomEditor
              value={form.requiredComponents}
              onChange={(v) =>
                setForm((p) => ({ ...p, requiredComponents: v }))
              }
              disabled={saving}
            />
            <p className='text-muted-foreground text-xs'>
              {
                form.requiredComponents.filter((c) => c.materialNumber.trim())
                  .length
              }{' '}
              material(s) defined
            </p>
          </div>

          <DialogFooter className='gap-3'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={saving || !isValid}>
              {saving ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' /> Saving...
                </>
              ) : editing ? (
                'Save Changes'
              ) : (
                'Create Kit'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Main component ----------
export function KitBomSettings() {
  const [definitions, setDefinitions] = useState<KitDefinitionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'archived'
  >('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<KitDefinitionRecord | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const data = await KitDefinitionsService.list(
      statusFilter === 'all' ? undefined : { status: statusFilter }
    )
    setDefinitions(data)
    setLoading(false)
  }, [statusFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    const sub = KitDefinitionsService.subscribeToChanges(() => fetchData())
    return () => {
      sub.unsubscribe()
    }
  }, [fetchData])

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return definitions
    const s = searchQuery.toLowerCase()
    return definitions.filter(
      (d) =>
        d.kit_number.toLowerCase().includes(s) ||
        d.kit_name.toLowerCase().includes(s) ||
        (d.engine_program ?? '').toLowerCase().includes(s)
    )
  }, [definitions, searchQuery])

  const handleArchive = async (def: KitDefinitionRecord) => {
    const res = await KitDefinitionsService.archive(def.id)
    if (res.success) {
      toast.success(`"${def.kit_number}" archived`)
      fetchData()
    } else {
      toast.error('Failed to archive', { description: res.error })
    }
  }

  const handleActivate = async (def: KitDefinitionRecord) => {
    const res = await KitDefinitionsService.activate(def.id)
    if (res.success) {
      toast.success(`"${def.kit_number}" reactivated`)
      fetchData()
    } else {
      toast.error('Failed to activate', { description: res.error })
    }
  }

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div>
          <h3 className='text-lg font-semibold'>Kit BOM Definitions</h3>
          <p className='text-muted-foreground text-sm'>
            Manage kit master data and bills of materials. Active definitions
            can be selected when creating new kit build plans.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className='mr-2 h-4 w-4' /> New Kit Definition
        </Button>
      </div>

      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative max-w-xs flex-1'>
          <Search className='text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4' />
          <Input
            placeholder='Search kits...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9'
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v: 'all' | 'active' | 'archived') =>
            setStatusFilter(v)
          }
        >
          <SelectTrigger className='w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Statuses</SelectItem>
            <SelectItem value='active'>Active</SelectItem>
            <SelectItem value='archived'>Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className='flex items-center justify-center py-12'>
          <Loader2 className='text-primary h-6 w-6 animate-spin' />
        </div>
      ) : filtered.length === 0 ? (
        <div className='border-muted-foreground/30 bg-muted/30 rounded-md border border-dashed p-8 text-center'>
          <Package className='text-muted-foreground mx-auto mb-3 h-10 w-10' />
          <p className='text-muted-foreground text-sm'>
            {searchQuery
              ? 'No kit definitions match your search.'
              : 'No kit definitions yet. Create one to get started.'}
          </p>
        </div>
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kit Number</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Engine Program</TableHead>
                <TableHead className='text-center'>BOM Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((def) => (
                <TableRow key={def.id}>
                  <TableCell className='font-medium'>
                    {def.kit_number}
                  </TableCell>
                  <TableCell>{def.kit_name}</TableCell>
                  <TableCell>{def.engine_program ?? '—'}</TableCell>
                  <TableCell className='text-center'>
                    {def.total_components_count}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        def.status === 'active' ? 'default' : 'secondary'
                      }
                      className='text-xs'
                    >
                      {def.status === 'active' ? (
                        <>
                          <CheckCircle2 className='mr-1 h-3 w-3' />
                          Active
                        </>
                      ) : (
                        <>
                          <Archive className='mr-1 h-3 w-3' />
                          Archived
                        </>
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-1'>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-8 w-8'
                        onClick={() => {
                          setEditing(def)
                          setDialogOpen(true)
                        }}
                      >
                        <Edit className='h-4 w-4' />
                      </Button>
                      {def.status === 'active' ? (
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8'
                          onClick={() => handleArchive(def)}
                        >
                          <Archive className='h-4 w-4' />
                        </Button>
                      ) : (
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-8 w-8'
                          onClick={() => handleActivate(def)}
                        >
                          <RotateCcw className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <KitDefinitionDialog
        isOpen={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={fetchData}
      />
    </div>
  )
}
