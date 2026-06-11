// Created and developed by Jai Singh
'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Edit,
  Link2,
  Loader2,
  Package,
  Palette,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  KitDefinitionChainsService,
  KIT_CHAIN_LINK_TYPES,
  type KitChainLinkType,
  type KitDefinitionChainRecord,
} from '@/lib/supabase/kit-definition-chains.service'
import {
  KitDefinitionsService,
  KIT_CART_COLORS,
  type BomComponent,
  type BomComponentType,
  type BomCoverageMode,
  type KitDefinitionRecord,
  type PartDeviation,
} from '@/lib/supabase/kit-definitions.service'
import { type KittingDropdownOption } from '@/lib/supabase/kitting-options.service'
import { logger } from '@/lib/utils/logger'
import { useKittingOptions } from '@/hooks/use-kitting-options'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ColorPickerInput } from '@/components/ui/color-picker-input'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { KittingOptionManager } from '@/components/kitting/kitting-option-manager'

function withCurrentOption(
  options: KittingDropdownOption[],
  currentValue?: string | null
) {
  if (!currentValue) return options
  const exists = options.some((option) => option.option_value === currentValue)
  if (exists) return options
  return [
    ...options,
    {
      id: `current-${currentValue}`,
      organization_id: '',
      option_group: options[0]?.option_group ?? 'engine_program',
      option_value: currentValue,
      option_label: currentValue,
      description: null,
      display_order: options.length,
      is_active: false,
      created_at: '',
      updated_at: '',
    },
  ]
}

function buildLabelMap(options: KittingDropdownOption[]) {
  return Object.fromEntries(
    options.map((option) => [option.option_value, option.option_label])
  ) as Record<string, string>
}

// ---------- BOM editor row type ----------

interface BomEditorRow extends BomComponent {
  _key: number
}

let rowKeyCounter = 0

function emptyMaterialRow(): BomEditorRow {
  return {
    componentType: 'material',
    coverageMode: 'required',
    materialNumber: '',
    materialDescription: '',
    requiredQuantity: 1,
    _key: ++rowKeyCounter,
  }
}

function emptyIncoraRow(): BomEditorRow {
  return {
    componentType: 'incora_sub_kit',
    coverageMode: 'required',
    materialNumber: '',
    materialDescription: '',
    requiredQuantity: 1,
    incoraReference: '',
    _key: ++rowKeyCounter,
  }
}

function emptyIncoraComponentRow(): BomEditorRow {
  return {
    componentType: 'incora_component',
    coverageMode: 'required',
    materialNumber: '',
    materialDescription: '',
    requiredQuantity: 1,
    incoraReference: '',
    _key: ++rowKeyCounter,
  }
}

function serializeRow(row: BomEditorRow): BomComponent {
  const base: BomComponent = {
    componentType: row.componentType || 'material',
    coverageMode: row.coverageMode || 'required',
    materialNumber: row.materialNumber,
    materialDescription: row.materialDescription,
    requiredQuantity: row.requiredQuantity,
  }
  if (
    row.componentType === 'incora_sub_kit' ||
    row.componentType === 'incora_component'
  ) {
    base.incoraReference = row.incoraReference
  }
  if (row.partContainerType) {
    base.partContainerType = row.partContainerType
  }
  if (row.deviations && row.deviations.length > 0) {
    base.deviations = row.deviations
  }
  return base
}

// ---------- Deviation sub-editor ----------

function DeviationEditor({
  deviations,
  onChange,
  disabled,
}: {
  deviations: PartDeviation[]
  onChange: (d: PartDeviation[]) => void
  disabled?: boolean
}) {
  const addDeviation = () =>
    onChange([
      ...deviations,
      { substituteMaterialNumber: '', substituteMaterialDescription: '' },
    ])
  const removeDeviation = (idx: number) =>
    onChange(deviations.filter((_, i) => i !== idx))
  const updateDeviation = (
    idx: number,
    field: keyof PartDeviation,
    val: string
  ) =>
    onChange(deviations.map((d, i) => (i === idx ? { ...d, [field]: val } : d)))

  return (
    <div className='space-y-1.5 pl-6'>
      {deviations.map((d, idx) => (
        <div key={idx} className='flex items-center gap-2'>
          <Input
            placeholder='Substitute part #'
            value={d.substituteMaterialNumber}
            onChange={(e) =>
              updateDeviation(idx, 'substituteMaterialNumber', e.target.value)
            }
            disabled={disabled}
            className='h-7 flex-1 text-xs'
          />
          <Input
            placeholder='Description'
            value={d.substituteMaterialDescription}
            onChange={(e) =>
              updateDeviation(
                idx,
                'substituteMaterialDescription',
                e.target.value
              )
            }
            disabled={disabled}
            className='h-7 flex-1 text-xs'
          />
          <Input
            placeholder='Notes'
            value={d.notes ?? ''}
            onChange={(e) => updateDeviation(idx, 'notes', e.target.value)}
            disabled={disabled}
            className='h-7 w-32 text-xs'
          />
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-6 w-6'
            onClick={() => removeDeviation(idx)}
            disabled={disabled}
          >
            <Trash2 className='h-3 w-3' />
          </Button>
        </div>
      ))}
      <Button
        type='button'
        variant='ghost'
        size='sm'
        onClick={addDeviation}
        disabled={disabled}
        className='h-6 text-xs'
      >
        <Plus className='mr-1 h-3 w-3' /> Add Substitute
      </Button>
    </div>
  )
}

// ---------- BOM inline editor ----------

function BomEditor({
  value,
  onChange,
  partContainerOptions,
  disabled,
}: {
  value: BomComponent[]
  onChange: (v: BomComponent[]) => void
  partContainerOptions: KittingDropdownOption[]
  disabled?: boolean
}) {
  const [rows, setRows] = useState<BomEditorRow[]>(() =>
    value.length > 0
      ? value.map((c) => ({ ...c, _key: ++rowKeyCounter }))
      : [emptyMaterialRow()]
  )
  const [expandedDeviations, setExpandedDeviations] = useState<Set<number>>(
    new Set()
  )
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    onChange(rows.map(serializeRow))
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = (idx: number, field: string, val: unknown) =>
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r))
    )

  const addMaterialRow = () => setRows((prev) => [...prev, emptyMaterialRow()])
  const addIncoraRow = () => setRows((prev) => [...prev, emptyIncoraRow()])
  const addIncoraComponentRow = () =>
    setRows((prev) => [...prev, emptyIncoraComponentRow()])
  const removeRow = (idx: number) =>
    setRows((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    )

  const toggleDeviations = (key: number) =>
    setExpandedDeviations((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const handleImportFromClipboard = async () => {
    setImporting(true)
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.error('Clipboard is empty', {
          description:
            'Copy rows from Excel (Material Number, Description, Qty) and try again.',
        })
        setImporting(false)
        return
      }

      const normalizedText = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim()
      const lines = normalizedText.split('\n')

      const firstLine = lines[0].split('\t')
      const looksLikeHeader = firstLine.some((cell) =>
        ['material', 'description', 'qty', 'quantity', 'part'].some((kw) =>
          cell.trim().toLowerCase().includes(kw)
        )
      )
      const dataLines = looksLikeHeader ? lines.slice(1) : lines

      const imported: BomEditorRow[] = []
      for (const line of dataLines) {
        if (!line.trim()) continue
        const cells = line.split('\t')
        if (cells.length < 2) continue

        const materialNumber = cells[0]?.trim() || ''
        const materialDescription = cells[1]?.trim() || ''
        const qty = Math.max(1, parseInt(cells[2]?.trim() || '1', 10) || 1)

        if (!materialNumber) continue
        imported.push({
          componentType: 'material',
          coverageMode: 'required',
          materialNumber,
          materialDescription,
          requiredQuantity: qty,
          _key: ++rowKeyCounter,
        })
      }

      if (imported.length === 0) {
        toast.error('No valid rows found', {
          description:
            'Ensure clipboard has tab-separated columns: Material Number, Description, Qty.',
        })
        setImporting(false)
        return
      }

      setRows((prev) => {
        const hasContent = prev.some(
          (r) => r.materialNumber.trim() || r.incoraReference?.trim()
        )
        return hasContent ? [...prev, ...imported] : imported
      })

      toast.success(
        `Imported ${imported.length} material${imported.length === 1 ? '' : 's'} from clipboard`
      )
    } catch (err) {
      logger.error('[BomEditor] clipboard import error:', err)
      toast.error('Failed to read clipboard')
    }
    setImporting(false)
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={handleImportFromClipboard}
          disabled={disabled || importing}
        >
          {importing ? (
            <Loader2 className='mr-1 h-3 w-3 animate-spin' />
          ) : (
            <ClipboardPaste className='mr-1 h-3 w-3' />
          )}
          {importing ? 'Importing...' : 'Import from Clipboard'}
        </Button>
      </div>

      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-10'>#</TableHead>
              <TableHead className='w-28'>Type</TableHead>
              <TableHead>Material # / INCORA Ref</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className='w-36'>Part Container</TableHead>
              <TableHead className='w-20'>Qty</TableHead>
              <TableHead className='w-28'>Coverage</TableHead>
              <TableHead className='w-10' />
              <TableHead className='w-10' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => {
              const componentType = row.componentType || 'material'
              const isMaterial = componentType === 'material'
              const isIncoraSubKit = componentType === 'incora_sub_kit'
              const isIncoraComponent = componentType === 'incora_component'
              const allowDeviations = isMaterial || isIncoraComponent
              const deviationCount = row.deviations?.length ?? 0
              const devsExpanded = expandedDeviations.has(row._key)
              const partContainerChoices = withCurrentOption(
                partContainerOptions,
                row.partContainerType
              )
              return (
                <React.Fragment key={row._key}>
                  <TableRow>
                    <TableCell className='text-muted-foreground text-xs'>
                      {idx + 1}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={componentType}
                        onValueChange={(v: BomComponentType) =>
                          updateField(idx, 'componentType', v)
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger className='h-8 text-xs'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='material'>Material</SelectItem>
                          <SelectItem value='incora_component'>
                            INCORA Component
                          </SelectItem>
                          <SelectItem value='incora_sub_kit'>
                            INCORA Sub-Kit
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {isIncoraSubKit ? (
                        <Input
                          placeholder='INCORA reference'
                          value={row.incoraReference ?? ''}
                          onChange={(e) =>
                            updateField(idx, 'incoraReference', e.target.value)
                          }
                          disabled={disabled}
                          className='h-8 text-sm'
                        />
                      ) : isIncoraComponent ? (
                        <div className='space-y-1'>
                          <Input
                            placeholder='Material # (e.g. 12345678)'
                            value={row.materialNumber}
                            onChange={(e) =>
                              updateField(idx, 'materialNumber', e.target.value)
                            }
                            disabled={disabled}
                            className='h-7 text-xs'
                          />
                          <Input
                            placeholder='INCORA reference'
                            value={row.incoraReference ?? ''}
                            onChange={(e) =>
                              updateField(
                                idx,
                                'incoraReference',
                                e.target.value
                              )
                            }
                            disabled={disabled}
                            className='h-7 text-xs'
                          />
                        </div>
                      ) : (
                        <Input
                          placeholder='e.g. 12345678'
                          value={row.materialNumber}
                          onChange={(e) =>
                            updateField(idx, 'materialNumber', e.target.value)
                          }
                          disabled={disabled}
                          className='h-8 text-sm'
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        placeholder={
                          isIncoraSubKit
                            ? 'Sub-kit description'
                            : isIncoraComponent
                              ? 'Component description'
                              : 'Material description'
                        }
                        value={row.materialDescription}
                        onChange={(e) =>
                          updateField(
                            idx,
                            'materialDescription',
                            e.target.value
                          )
                        }
                        disabled={disabled}
                        className='h-8 text-sm'
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.partContainerType || '_none'}
                        onValueChange={(v) =>
                          updateField(
                            idx,
                            'partContainerType',
                            v === '_none' ? '' : v
                          )
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger className='h-8 text-xs'>
                          <SelectValue placeholder='Optional' />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='_none'>None</SelectItem>
                          {partContainerChoices.map((option) => (
                            <SelectItem
                              key={option.id || option.option_value}
                              value={option.option_value}
                            >
                              {option.option_label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type='number'
                        min={1}
                        value={row.requiredQuantity}
                        onChange={(e) =>
                          updateField(
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
                      <Select
                        value={row.coverageMode || 'required'}
                        onValueChange={(v: BomCoverageMode) =>
                          updateField(idx, 'coverageMode', v)
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger className='h-8 text-xs'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='required'>Required</SelectItem>
                          <SelectItem value='informational'>
                            Info Only
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {allowDeviations && (
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-7 w-7'
                          onClick={() => toggleDeviations(row._key)}
                          disabled={disabled}
                          title='Part deviations'
                        >
                          {devsExpanded ? (
                            <ChevronDown className='h-3.5 w-3.5' />
                          ) : (
                            <ChevronRight className='h-3.5 w-3.5' />
                          )}
                          {deviationCount > 0 && (
                            <span className='absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-500 text-[9px] text-white'>
                              {deviationCount}
                            </span>
                          )}
                        </Button>
                      )}
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
                  {allowDeviations && devsExpanded && (
                    <TableRow>
                      <TableCell colSpan={9} className='bg-muted/30 py-2'>
                        <p className='text-muted-foreground mb-1 text-xs font-medium'>
                          Approved Substitute Parts
                        </p>
                        <DeviationEditor
                          deviations={row.deviations ?? []}
                          onChange={(d) => updateField(idx, 'deviations', d)}
                          disabled={disabled}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={addMaterialRow}
          disabled={disabled}
        >
          <Plus className='mr-1 h-3 w-3' /> Add Material
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={addIncoraComponentRow}
          disabled={disabled}
        >
          <Plus className='mr-1 h-3 w-3' /> Add INCORA Component
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={addIncoraRow}
          disabled={disabled}
        >
          <Plus className='mr-1 h-3 w-3' /> Add INCORA Sub-Kit
        </Button>
      </div>
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
  chargeCode: string
  requiredComponents: BomComponent[]
  assemblyInstructions: string
  estimatedAssemblyTimeMinutes: number | ''
  defaultKitCartColor: string
  kitContainerType: string
  chainId: string
  chainSequenceOrder: number | ''
}

const defaultForm: KitFormState = {
  kitNumber: '',
  kitName: '',
  kitDescription: '',
  engineProgram: '',
  kitType: 'standard',
  chargeCode: '',
  requiredComponents: [],
  assemblyInstructions: '',
  estimatedAssemblyTimeMinutes: '',
  defaultKitCartColor: '',
  kitContainerType: '',
  chainId: '',
  chainSequenceOrder: '',
}

function KitDefinitionDialog({
  isOpen,
  onOpenChange,
  editing,
  onSaved,
  engineProgramOptions,
  kitTypeOptions,
  kitContainerOptions,
  partContainerOptions,
  chargeCodeOptions,
  chains,
  onOpenChainManager,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  editing: KitDefinitionRecord | null
  onSaved: () => void
  engineProgramOptions: KittingDropdownOption[]
  kitTypeOptions: KittingDropdownOption[]
  kitContainerOptions: KittingDropdownOption[]
  partContainerOptions: KittingDropdownOption[]
  chargeCodeOptions: KittingDropdownOption[]
  chains: KitDefinitionChainRecord[]
  onOpenChainManager: () => void
}) {
  const [form, setForm] = useState<KitFormState>(defaultForm)
  const [saving, setSaving] = useState(false)
  const engineProgramChoices = withCurrentOption(
    engineProgramOptions,
    form.engineProgram
  )
  const kitTypeChoices = withCurrentOption(kitTypeOptions, form.kitType)
  const kitContainerChoices = withCurrentOption(
    kitContainerOptions,
    form.kitContainerType
  )
  const chargeCodeChoices = withCurrentOption(
    chargeCodeOptions,
    form.chargeCode
  )
  const activeChains = useMemo(
    () => chains.filter((c) => c.status === 'active'),
    [chains]
  )
  const selectedChain = useMemo(
    () => chains.find((c) => c.id === form.chainId) ?? null,
    [chains, form.chainId]
  )

  useEffect(() => {
    if (editing) {
      setForm({
        kitNumber: editing.kit_number,
        kitName: editing.kit_name,
        kitDescription: editing.kit_description ?? '',
        engineProgram: editing.engine_program ?? '',
        kitType: editing.kit_type ?? 'standard',
        chargeCode: editing.charge_code ?? '',
        requiredComponents: (editing.required_components ??
          []) as BomComponent[],
        assemblyInstructions: editing.assembly_instructions ?? '',
        estimatedAssemblyTimeMinutes:
          editing.estimated_assembly_time_minutes ?? '',
        defaultKitCartColor: editing.default_kit_cart_color ?? '',
        kitContainerType: editing.kit_container_type ?? '',
        chainId: editing.chain_id ?? '',
        chainSequenceOrder: editing.chain_sequence_order ?? '',
      })
    } else {
      setForm(defaultForm)
    }
  }, [editing, isOpen])

  const isValid =
    form.kitNumber.trim() !== '' &&
    form.kitName.trim() !== '' &&
    form.requiredComponents.some(
      (c) => c.materialNumber?.trim() !== '' || c.incoraReference?.trim() !== ''
    )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const components = form.requiredComponents.filter(
        (c) =>
          c.materialNumber?.trim() !== '' || c.incoraReference?.trim() !== ''
      )
      const payload = {
        kitNumber: form.kitNumber,
        kitName: form.kitName,
        kitDescription: form.kitDescription,
        engineProgram: form.engineProgram,
        kitType: form.kitType,
        chargeCode: form.chargeCode || undefined,
        requiredComponents: components,
        assemblyInstructions: form.assemblyInstructions,
        estimatedAssemblyTimeMinutes:
          form.estimatedAssemblyTimeMinutes === ''
            ? undefined
            : Number(form.estimatedAssemblyTimeMinutes),
        defaultKitCartColor: form.defaultKitCartColor || undefined,
        kitContainerType: form.kitContainerType || undefined,
        chainId: form.chainId || null,
        chainSequenceOrder:
          form.chainId && form.chainSequenceOrder !== ''
            ? Number(form.chainSequenceOrder)
            : null,
      }

      const res = editing
        ? await KitDefinitionsService.update({ id: editing.id, ...payload })
        : await KitDefinitionsService.create(payload)

      if (res.success) {
        toast.success(
          editing ? 'Kit definition updated' : 'Kit definition created'
        )
        onSaved()
        onOpenChange(false)
      } else {
        toast.error(editing ? 'Failed to update' : 'Failed to create', {
          description: res.error,
        })
      }
    } catch (err) {
      logger.error('[KitBomSettings] save error', err)
      toast.error('Unexpected error')
    }
    setSaving(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-[1260px]'>
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
          {/* Row 1: Kit Number + Kit Name */}
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

          {/* Row 2: Engine Program + Kit Type */}
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
                  {engineProgramChoices.map((option) => (
                    <SelectItem
                      key={option.id || option.option_value}
                      value={option.option_value}
                    >
                      {option.option_label}
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
                  {kitTypeChoices.map((option) => (
                    <SelectItem
                      key={option.id || option.option_value}
                      value={option.option_value}
                    >
                      {option.option_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 3: Container Type + Charge Code */}
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>Container Type</label>
              <Select
                value={form.kitContainerType || '_none'}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    kitContainerType: v === '_none' ? '' : v,
                  }))
                }
                disabled={saving}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='Select container type' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='_none'>None</SelectItem>
                  {kitContainerChoices.map((option) => (
                    <SelectItem
                      key={option.id || option.option_value}
                      value={option.option_value}
                    >
                      {option.option_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>Charge Code</label>
              <Select
                value={form.chargeCode || '_none'}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    chargeCode: v === '_none' ? '' : v,
                  }))
                }
                disabled={saving}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='Select charge code' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='_none'>None</SelectItem>
                  {chargeCodeChoices.map((option) => (
                    <SelectItem
                      key={option.id || option.option_value}
                      value={option.option_value}
                    >
                      {option.option_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 4: Linked Kit Chain */}
          <div className='bg-muted/30 space-y-3 rounded-md border p-3'>
            <div className='flex items-center justify-between gap-2'>
              <label className='flex items-center gap-1.5 text-sm font-medium'>
                <Link2 className='h-3.5 w-3.5' />
                Linked Kit Chain
              </label>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={onOpenChainManager}
                disabled={saving}
                className='h-7 text-xs'
              >
                Manage Chains
              </Button>
            </div>
            <p className='text-muted-foreground text-xs'>
              Optionally link this kit definition to other kit BOMs that must be
              built in order or shipped together.
            </p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
              <div className='space-y-1.5 sm:col-span-2'>
                <label className='text-xs font-medium'>Chain</label>
                <Select
                  value={form.chainId || '_none'}
                  onValueChange={(v) =>
                    setForm((p) => ({
                      ...p,
                      chainId: v === '_none' ? '' : v,
                      chainSequenceOrder:
                        v === '_none' ? '' : p.chainSequenceOrder,
                    }))
                  }
                  disabled={saving}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder='Not in any chain' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='_none'>Not in any chain</SelectItem>
                    {activeChains.map((chain) => {
                      const linkLabel =
                        KIT_CHAIN_LINK_TYPES.find(
                          (lt) => lt.value === chain.link_type
                        )?.label ?? chain.link_type
                      return (
                        <SelectItem key={chain.id} value={chain.id}>
                          {chain.chain_name} — {linkLabel}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1.5'>
                <label className='text-xs font-medium'>Sequence #</label>
                <Input
                  type='number'
                  min={1}
                  step={1}
                  placeholder='1, 2, 3…'
                  value={form.chainSequenceOrder}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      chainSequenceOrder:
                        e.target.value === ''
                          ? ''
                          : Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  disabled={saving || !form.chainId}
                />
              </div>
            </div>
            {selectedChain?.chain_description && (
              <p className='text-muted-foreground text-xs'>
                {selectedChain.chain_description}
              </p>
            )}
          </div>

          {/* Row 5: Default Color */}
          <div className='space-y-1.5'>
            <label className='text-sm font-medium'>
              <span className='flex items-center gap-1.5'>
                <Palette className='h-3.5 w-3.5' />
                Default Kit Cart Color
              </span>
            </label>
            <ColorPickerInput
              value={form.defaultKitCartColor}
              onChange={(value) =>
                setForm((p) => ({ ...p, defaultKitCartColor: value }))
              }
              disabled={saving}
              placeholder='#22c55e'
              presetColors={KIT_CART_COLORS}
            />
            {form.defaultKitCartColor && (
              <p className='text-muted-foreground text-xs'>
                Default color for new build plans using this definition.
              </p>
            )}
          </div>

          {/* Description */}
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

          {/* Bill of Materials */}
          <div className='space-y-1.5'>
            <label className='text-sm font-medium'>
              Bill of Materials <span className='text-destructive'>*</span>
            </label>
            <BomEditor
              key={editing?.id ?? 'new-kit-definition'}
              value={form.requiredComponents}
              onChange={(v) =>
                setForm((p) => ({ ...p, requiredComponents: v }))
              }
              partContainerOptions={partContainerOptions}
              disabled={saving}
            />
            <p className='text-muted-foreground text-xs'>
              {
                form.requiredComponents.filter(
                  (c) => c.materialNumber?.trim() || c.incoraReference?.trim()
                ).length
              }{' '}
              component(s) defined
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

// ---------- Chain manager dialog ----------

interface ChainFormState {
  chainName: string
  chainDescription: string
  linkType: KitChainLinkType
}

const defaultChainForm: ChainFormState = {
  chainName: '',
  chainDescription: '',
  linkType: 'build_order',
}

function KitChainManagerDialog({
  isOpen,
  onOpenChange,
  chains,
  definitions,
  onChanged,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  chains: KitDefinitionChainRecord[]
  definitions: KitDefinitionRecord[]
  onChanged: () => void
}) {
  const [form, setForm] = useState<ChainFormState>(defaultChainForm)
  const [saving, setSaving] = useState(false)
  const [editingChainId, setEditingChainId] = useState<string | null>(null)
  const editingChain = useMemo(
    () => chains.find((c) => c.id === editingChainId) ?? null,
    [chains, editingChainId]
  )

  useEffect(() => {
    if (editingChain) {
      setForm({
        chainName: editingChain.chain_name,
        chainDescription: editingChain.chain_description ?? '',
        linkType: editingChain.link_type,
      })
    } else {
      setForm(defaultChainForm)
    }
  }, [editingChain, isOpen])

  const membersByChain = useMemo(() => {
    const map: Record<string, KitDefinitionRecord[]> = {}
    for (const def of definitions) {
      if (!def.chain_id) continue
      if (!map[def.chain_id]) map[def.chain_id] = []
      map[def.chain_id].push(def)
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => {
        const aOrd = a.chain_sequence_order ?? Number.MAX_SAFE_INTEGER
        const bOrd = b.chain_sequence_order ?? Number.MAX_SAFE_INTEGER
        if (aOrd !== bOrd) return aOrd - bOrd
        return a.kit_number.localeCompare(b.kit_number)
      })
    }
    return map
  }, [definitions])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.chainName.trim()) {
      toast.error('Chain name is required')
      return
    }
    setSaving(true)
    try {
      const res = editingChain
        ? await KitDefinitionChainsService.update({
            id: editingChain.id,
            chainName: form.chainName,
            chainDescription: form.chainDescription,
            linkType: form.linkType,
          })
        : await KitDefinitionChainsService.create({
            chainName: form.chainName,
            chainDescription: form.chainDescription,
            linkType: form.linkType,
          })

      if (res.success) {
        toast.success(editingChain ? 'Chain updated' : 'Chain created')
        setEditingChainId(null)
        setForm(defaultChainForm)
        onChanged()
      } else {
        toast.error(
          editingChain ? 'Failed to update chain' : 'Failed to create chain',
          {
            description: res.error,
          }
        )
      }
    } catch (err) {
      logger.error('[KitChainManagerDialog] save error', err)
      toast.error('Unexpected error')
    }
    setSaving(false)
  }

  const handleArchive = async (chain: KitDefinitionChainRecord) => {
    const res = await KitDefinitionChainsService.archive(chain.id)
    if (res.success) {
      toast.success(`Chain "${chain.chain_name}" archived`)
      onChanged()
    } else {
      toast.error('Failed to archive chain', { description: res.error })
    }
  }

  const handleActivate = async (chain: KitDefinitionChainRecord) => {
    const res = await KitDefinitionChainsService.activate(chain.id)
    if (res.success) {
      toast.success(`Chain "${chain.chain_name}" reactivated`)
      onChanged()
    } else {
      toast.error('Failed to reactivate chain', { description: res.error })
    }
  }

  const handleDelete = async (chain: KitDefinitionChainRecord) => {
    const memberCount = membersByChain[chain.id]?.length ?? 0
    const confirmMsg =
      memberCount > 0
        ? `Delete chain "${chain.chain_name}"? This will unlink ${memberCount} kit definition(s).`
        : `Delete chain "${chain.chain_name}"?`
    if (!window.confirm(confirmMsg)) return
    const res = await KitDefinitionChainsService.delete(chain.id)
    if (res.success) {
      toast.success(`Chain "${chain.chain_name}" deleted`)
      onChanged()
    } else {
      toast.error('Failed to delete chain', { description: res.error })
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-[860px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Link2 className='h-5 w-5' />
            Manage Kit Chains
          </DialogTitle>
          <DialogDescription>
            Group kit definitions that must be built in order or shipped
            together. Each kit definition can belong to one chain at a time.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-5 py-2'>
          <form
            onSubmit={handleSubmit}
            className='bg-muted/30 space-y-3 rounded-md border p-3'
          >
            <div className='flex items-center justify-between'>
              <p className='text-sm font-medium'>
                {editingChain ? 'Edit Chain' : 'Create New Chain'}
              </p>
              {editingChain && (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => setEditingChainId(null)}
                  disabled={saving}
                  className='h-7 text-xs'
                >
                  Cancel edit
                </Button>
              )}
            </div>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <label className='text-xs font-medium'>
                  Chain Name <span className='text-destructive'>*</span>
                </label>
                <Input
                  placeholder='e.g. 3BSD Bearing Cart Set'
                  value={form.chainName}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, chainName: e.target.value }))
                  }
                  disabled={saving}
                />
              </div>
              <div className='space-y-1.5'>
                <label className='text-xs font-medium'>Link Type</label>
                <Select
                  value={form.linkType}
                  onValueChange={(v: KitChainLinkType) =>
                    setForm((p) => ({ ...p, linkType: v }))
                  }
                  disabled={saving}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KIT_CHAIN_LINK_TYPES.map((lt) => (
                      <SelectItem key={lt.value} value={lt.value}>
                        {lt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className='space-y-1.5'>
              <label className='text-xs font-medium'>Description</label>
              <Textarea
                placeholder='Optional context — when to use this chain, criteria, etc.'
                value={form.chainDescription}
                onChange={(e) =>
                  setForm((p) => ({ ...p, chainDescription: e.target.value }))
                }
                disabled={saving}
                rows={2}
              />
            </div>
            <div className='flex justify-end gap-2'>
              <Button type='submit' disabled={saving || !form.chainName.trim()}>
                {saving ? (
                  <>
                    <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                    Saving…
                  </>
                ) : editingChain ? (
                  'Save Chain'
                ) : (
                  'Create Chain'
                )}
              </Button>
            </div>
          </form>

          <div className='space-y-2'>
            <p className='text-sm font-medium'>Existing Chains</p>
            {chains.length === 0 ? (
              <div className='border-muted-foreground/30 bg-muted/30 rounded-md border border-dashed p-6 text-center'>
                <Link2 className='text-muted-foreground mx-auto mb-2 h-8 w-8' />
                <p className='text-muted-foreground text-sm'>
                  No chains yet. Create one above to start linking kit BOMs.
                </p>
              </div>
            ) : (
              <div className='rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chain</TableHead>
                      <TableHead>Link Type</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className='text-right'>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {chains.map((chain) => {
                      const members = membersByChain[chain.id] ?? []
                      const linkLabel =
                        KIT_CHAIN_LINK_TYPES.find(
                          (lt) => lt.value === chain.link_type
                        )?.label ?? chain.link_type
                      return (
                        <TableRow key={chain.id}>
                          <TableCell>
                            <div className='space-y-0.5'>
                              <div className='font-medium'>
                                {chain.chain_name}
                              </div>
                              {chain.chain_description && (
                                <p className='text-muted-foreground text-xs'>
                                  {chain.chain_description}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant='outline' className='text-xs'>
                              {linkLabel}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {members.length === 0 ? (
                              <span className='text-muted-foreground text-xs'>
                                No kits linked
                              </span>
                            ) : (
                              <div className='flex flex-wrap gap-1'>
                                {members.slice(0, 4).map((m) => (
                                  <Badge
                                    key={m.id}
                                    variant='secondary'
                                    className='text-[10px]'
                                  >
                                    {m.chain_sequence_order != null
                                      ? `#${m.chain_sequence_order} `
                                      : ''}
                                    {m.kit_number}
                                  </Badge>
                                ))}
                                {members.length > 4 && (
                                  <Badge
                                    variant='outline'
                                    className='text-[10px]'
                                  >
                                    +{members.length - 4} more
                                  </Badge>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                chain.status === 'active'
                                  ? 'default'
                                  : 'secondary'
                              }
                              className='text-xs'
                            >
                              {chain.status === 'active' ? (
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
                                className='h-7 w-7'
                                onClick={() => setEditingChainId(chain.id)}
                                title='Edit chain'
                              >
                                <Edit className='h-3.5 w-3.5' />
                              </Button>
                              {chain.status === 'active' ? (
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  className='h-7 w-7'
                                  onClick={() => handleArchive(chain)}
                                  title='Archive chain'
                                >
                                  <Archive className='h-3.5 w-3.5' />
                                </Button>
                              ) : (
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  className='h-7 w-7'
                                  onClick={() => handleActivate(chain)}
                                  title='Reactivate chain'
                                >
                                  <RotateCcw className='h-3.5 w-3.5' />
                                </Button>
                              )}
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-7 w-7'
                                onClick={() => handleDelete(chain)}
                                title='Delete chain'
                              >
                                <Trash2 className='text-muted-foreground hover:text-destructive h-3.5 w-3.5' />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Close
          </Button>
        </DialogFooter>
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
  const [chains, setChains] = useState<KitDefinitionChainRecord[]>([])
  const [chainManagerOpen, setChainManagerOpen] = useState(false)
  const { activeOptionsByGroup } = useKittingOptions()
  const containerLabelMap = buildLabelMap(
    activeOptionsByGroup.kit_container_type ?? []
  )
  const chargeCodeLabelMap = buildLabelMap(
    activeOptionsByGroup.charge_code ?? []
  )
  const chainById = useMemo(() => {
    return Object.fromEntries(chains.map((c) => [c.id, c])) as Record<
      string,
      KitDefinitionChainRecord
    >
  }, [chains])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const data = await KitDefinitionsService.list(
      statusFilter === 'all' ? undefined : { status: statusFilter }
    )
    setDefinitions(data)
    setLoading(false)
  }, [statusFilter])

  const fetchChains = useCallback(async () => {
    const data = await KitDefinitionChainsService.list()
    setChains(data)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    fetchChains()
  }, [fetchChains])

  useEffect(() => {
    const sub = KitDefinitionsService.subscribeToChanges(() => fetchData())
    return () => {
      sub.unsubscribe()
    }
  }, [fetchData])

  useEffect(() => {
    const sub = KitDefinitionChainsService.subscribeToChanges(() =>
      fetchChains()
    )
    return () => {
      sub.unsubscribe()
    }
  }, [fetchChains])

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
      </div>

      <Tabs defaultValue='definitions' className='space-y-4'>
        <TabsList>
          <TabsTrigger value='definitions'>Definitions</TabsTrigger>
          <TabsTrigger value='dropdowns'>Dropdowns</TabsTrigger>
        </TabsList>

        <TabsContent value='definitions' className='space-y-4'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
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
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                onClick={() => setChainManagerOpen(true)}
              >
                <Link2 className='mr-2 h-4 w-4' /> Manage Chains
              </Button>
              <Button
                onClick={() => {
                  setEditing(null)
                  setDialogOpen(true)
                }}
              >
                <Plus className='mr-2 h-4 w-4' /> New Kit Definition
              </Button>
            </div>
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
                    <TableHead className='w-8' />
                    <TableHead>Kit Number</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Engine Program</TableHead>
                    <TableHead>Container</TableHead>
                    <TableHead>Charge Code</TableHead>
                    <TableHead>Chain</TableHead>
                    <TableHead className='text-center'>BOM Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='text-right'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((def) => (
                    <TableRow key={def.id}>
                      <TableCell>
                        {def.default_kit_cart_color && (
                          <div
                            className='h-4 w-4 rounded-full border'
                            style={{
                              backgroundColor: def.default_kit_cart_color,
                            }}
                            title={
                              KIT_CART_COLORS.find(
                                (c) => c.value === def.default_kit_cart_color
                              )?.label ?? 'Custom'
                            }
                          />
                        )}
                      </TableCell>
                      <TableCell className='font-medium'>
                        {def.kit_number}
                      </TableCell>
                      <TableCell>{def.kit_name}</TableCell>
                      <TableCell>{def.engine_program ?? '—'}</TableCell>
                      <TableCell>
                        {def.kit_container_type ? (
                          <Badge variant='outline' className='text-xs'>
                            {containerLabelMap[def.kit_container_type] ??
                              def.kit_container_type}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {def.charge_code
                          ? (chargeCodeLabelMap[def.charge_code] ??
                            def.charge_code)
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {def.chain_id && chainById[def.chain_id] ? (
                          <div className='flex items-center gap-1.5'>
                            <Link2 className='text-muted-foreground h-3 w-3' />
                            <span className='text-xs'>
                              {chainById[def.chain_id].chain_name}
                            </span>
                            {def.chain_sequence_order != null && (
                              <Badge
                                variant='secondary'
                                className='px-1 py-0 text-[10px]'
                              >
                                #{def.chain_sequence_order}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          '—'
                        )}
                      </TableCell>
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
        </TabsContent>

        <TabsContent value='dropdowns'>
          <KittingOptionManager />
        </TabsContent>
      </Tabs>

      <KitDefinitionDialog
        isOpen={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={fetchData}
        engineProgramOptions={activeOptionsByGroup.engine_program ?? []}
        kitTypeOptions={activeOptionsByGroup.kit_type ?? []}
        kitContainerOptions={activeOptionsByGroup.kit_container_type ?? []}
        partContainerOptions={
          activeOptionsByGroup.bom_line_container_type ?? []
        }
        chargeCodeOptions={activeOptionsByGroup.charge_code ?? []}
        chains={chains}
        onOpenChainManager={() => setChainManagerOpen(true)}
      />

      <KitChainManagerDialog
        isOpen={chainManagerOpen}
        onOpenChange={setChainManagerOpen}
        chains={chains}
        definitions={definitions}
        onChanged={() => {
          fetchChains()
          fetchData()
        }}
      />
    </div>
  )
}

// Created and developed by Jai Singh
