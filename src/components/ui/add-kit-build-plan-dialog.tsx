// Created and developed by Jai Singh
/**
 * Add to Kit Build Plan Dialog
 * Dialog for creating new kit build plan entries
 * Based on: https://ui.shadcn.com/docs/components/field
 * Created: December 11, 2025
 */
import * as React from 'react'
import { format } from 'date-fns'
import {
  AlertTriangle,
  CalendarIcon,
  CheckCircle2,
  ClipboardPaste,
  Loader2,
  Package,
  Palette,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { detectNonWarehouseBins } from '@/lib/kitting/non-warehouse-bins'
import { withCurrentPlantOption } from '@/lib/kitting/plant-locations'
import {
  KitDefinitionsService,
  KIT_CART_COLORS,
  type BomComponent,
  type KitDefinitionRecord,
} from '@/lib/supabase/kit-definitions.service'
import type { KittingDropdownOption } from '@/lib/supabase/kitting-options.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useKittingOptions } from '@/hooks/use-kitting-options'
import {
  useDeliverToPlantLocations,
  useNonWarehouseBinPatterns,
} from '@/hooks/use-kitting-workflow-settings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { ColorPickerInput } from '@/components/ui/color-picker-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NonWarehouseBinNotice } from '@/components/kitting/non-warehouse-bin-notice'

// Transfer Order record structure matching Excel columns
export interface TransferOrderRecord {
  destStorageBin: string
  transferOrderNumber: string
  sourceStorageType: string
  warehouseNumber: string
  destStorageType: string
  movementTypeIM: string
  movementTypeWM: string
  sourceStorageBin: string
  plant: string
  storageLocation: string
  material: string
  materialDescription: string
  batch: string
  sourceTargetQty: string
  creationDate: string
  creationTime: string
  user: string
  printer: string
  specialStockNumber: string
}

// INCORA item structure
export interface IncoraItem {
  lineNumber: number
  value: string
}

// Authorized to Ship Short item structure
export interface AuthorizedShipShortItem {
  lineNumber: number
  partNumber: string
  description: string
}

export interface BomCoverageResult {
  matched: BomComponent[]
  unmatched: BomComponent[]
  /**
   * Subset of `matched` whose coverage was satisfied ONLY by an
   * `Authorized to Ship Short` entry (not by an imported TO row or an
   * INCORA reference). Used by the dialog UI to render a distinct
   * "Ship Short" badge so the operator knows the BOM hole is intentional
   * rather than a true match.
   */
  matchedViaShipShort: BomComponent[]
  isComplete: boolean
}

export interface KitBuildPlanFormData {
  kitBuildNumber: string
  kitPoNumber: string
  engineProgram: string
  kitNumber: string
  deliverToPlant: string
  dueDate: Date | undefined
  importedTOs: TransferOrderRecord[]
  incoraItems: IncoraItem[]
  authorizedShipShortItems: AuthorizedShipShortItem[]
  kitDefinitionId?: string
  bomCoverage?: BomCoverageResult
  kitCartColor?: string
  kitContainerType?: string
  chargeCode?: string
}

interface AddKitBuildPlanDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: KitBuildPlanFormData) => Promise<void>
}

// Expected column headers from Excel (in order)
const EXPECTED_HEADERS = [
  'Dest.Storage Bin',
  'Transfer Order Number',
  'Source Storage Type',
  'Warehouse Number',
  'Dest. Storage Type',
  'Movement Type (IM)',
  'Movement Type (WM)',
  'Source Storage Bin',
  'Plant',
  'Storage Location',
  'Material',
  'Material Description',
  'Batch',
  'Source target qty',
  'Creation Date',
  'Creation time',
  'User',
  'Printer',
  'Special Stock Number',
]

function withCurrentOption(
  options: KittingDropdownOption[],
  currentValue?: string
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

export function parseClipboardData(text: string): TransferOrderRecord[] {
  // Normalize line endings (Windows \r\n to \n) and trim
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const lines = normalizedText.split('\n')
  if (lines.length < 1) return []

  // Check if first line is headers
  const firstLine = lines[0].split('\t')
  const hasHeaders = firstLine.some((cell) =>
    EXPECTED_HEADERS.some((header) =>
      cell.trim().toLowerCase().includes(header.toLowerCase().substring(0, 10))
    )
  )

  const dataLines = hasHeaders ? lines.slice(1) : lines
  const records: TransferOrderRecord[] = []

  for (const line of dataLines) {
    // Skip empty lines
    if (!line.trim()) continue

    const cells = line.split('\t')

    // Require at least the essential columns (Transfer Order Number at index 1, Material at index 10)
    // Excel may trim trailing empty columns, so we're lenient here
    // Minimum: need at least 11 columns to have Transfer Order Number and Material
    if (cells.length < 11) continue

    // Skip if Transfer Order Number is empty (essential field)
    const transferOrderNumber = cells[1]?.trim() || ''
    if (!transferOrderNumber) continue

    records.push({
      destStorageBin: cells[0]?.trim() || '',
      transferOrderNumber,
      sourceStorageType: cells[2]?.trim() || '',
      warehouseNumber: cells[3]?.trim() || '',
      destStorageType: cells[4]?.trim() || '',
      movementTypeIM: cells[5]?.trim() || '',
      movementTypeWM: cells[6]?.trim() || '',
      sourceStorageBin: cells[7]?.trim() || '',
      plant: cells[8]?.trim() || '',
      storageLocation: cells[9]?.trim() || '',
      material: cells[10]?.trim() || '',
      materialDescription: cells[11]?.trim() || '',
      batch: cells[12]?.trim() || '',
      sourceTargetQty: cells[13]?.trim() || '',
      creationDate: cells[14]?.trim() || '',
      creationTime: cells[15]?.trim() || '',
      user: cells[16]?.trim() || '',
      printer: cells[17]?.trim() || '',
      specialStockNumber: cells[18]?.trim() || '',
    })
  }

  return records
}

export function AddKitBuildPlanDialog({
  isOpen,
  onOpenChange,
  onSubmit,
}: AddKitBuildPlanDialogProps) {
  const { activeOptionsByGroup } = useKittingOptions()
  const nonWarehouseBinPatterns = useNonWarehouseBinPatterns()
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isImporting, setIsImporting] = React.useState(false)
  const [calendarOpen, setCalendarOpen] = React.useState(false)
  // Operator must explicitly tick this box when imported TO rows
  // reference a non-warehouse bin (see migration 314 +
  // [[Non-Warehouse-Bin-Acknowledgment]]). Reseeded to false every
  // time the dialog opens — the ack is per-submission, not persistent.
  const [nonWarehouseBinAck, setNonWarehouseBinAck] = React.useState(false)
  const [kitDefinitions, setKitDefinitions] = React.useState<
    KitDefinitionRecord[]
  >([])
  const [selectedDefinition, setSelectedDefinition] =
    React.useState<KitDefinitionRecord | null>(null)
  const [bomComponents, setBomComponents] = React.useState<BomComponent[]>([])

  const [formData, setFormData] = React.useState<KitBuildPlanFormData>({
    kitBuildNumber: '',
    kitPoNumber: '',
    engineProgram: '',
    kitNumber: '',
    deliverToPlant: '',
    dueDate: undefined,
    importedTOs: [],
    incoraItems: [],
    authorizedShipShortItems: [],
  })
  const engineProgramOptions = withCurrentOption(
    activeOptionsByGroup.engine_program ?? [],
    formData.engineProgram
  )
  // "Deliver To Plant" dropdown is now sourced from
  // `kitting_workflow_settings.deliver_to_plant_locations`
  // (migration 324) so floor leads can edit the list from Settings →
  // Workflow Settings. `withCurrentPlantOption` keeps a saved-but-
  // since-removed value visible in the dropdown so re-opening an old
  // kit doesn't render an empty Select.
  const configuredPlantLocations = useDeliverToPlantLocations()
  const plantLocationOptions = withCurrentPlantOption(
    configuredPlantLocations,
    formData.deliverToPlant
  )
  const kitContainerLabelMap = buildLabelMap(
    activeOptionsByGroup.kit_container_type ?? []
  )
  const chargeCodeLabelMap = buildLabelMap(
    activeOptionsByGroup.charge_code ?? []
  )
  const partContainerLabelMap = buildLabelMap(
    activeOptionsByGroup.bom_line_container_type ?? []
  )

  React.useEffect(() => {
    KitDefinitionsService.listActive()
      .then(setKitDefinitions)
      .catch(() => {})
  }, [])

  const bomCoverage = React.useMemo<BomCoverageResult | undefined>(() => {
    if (bomComponents.length === 0) return undefined
    const toMaterials = new Set(
      formData.importedTOs.map((to) => to.material.trim().toUpperCase())
    )
    const incoraValues = new Set(
      formData.incoraItems
        .map((item) => item.value.trim().toUpperCase())
        .filter(Boolean)
    )
    // Operator-entered "Authorized to Ship Short" part numbers explicitly
    // negate the Black Hat for that BOM line — the kit is allowed to
    // leave the floor without those parts. Match them by part number
    // against the BOM primary materialNumber or any deviation substitute.
    // Does not apply to incora_sub_kit rows because those have no
    // material number — only an INCORA reference.
    const shipShortPartNumbers = new Set(
      formData.authorizedShipShortItems
        .map((item) => item.partNumber.trim().toUpperCase())
        .filter(Boolean)
    )

    const matched: BomComponent[] = []
    const unmatched: BomComponent[] = []
    const matchedViaShipShort: BomComponent[] = []
    for (const c of bomComponents) {
      if (c.coverageMode === 'informational') {
        matched.push(c)
        continue
      }

      if (c.componentType === 'incora_sub_kit') {
        const ref = (c.incoraReference ?? '').trim().toUpperCase()
        if (ref && incoraValues.has(ref)) {
          matched.push(c)
        } else {
          unmatched.push(c)
        }
        continue
      }

      if (c.componentType === 'incora_component') {
        const primary = c.materialNumber.trim().toUpperCase()
        const ref = (c.incoraReference ?? '').trim().toUpperCase()
        const deviationNums = (c.deviations ?? []).map((d) =>
          d.substituteMaterialNumber.trim().toUpperCase()
        )
        const matAccept = [primary, ...deviationNums].filter(Boolean)
        const matMatch = matAccept.some((num) => toMaterials.has(num))
        const refMatch = !!ref && incoraValues.has(ref)
        if (matMatch || refMatch) {
          matched.push(c)
        } else if (matAccept.some((num) => shipShortPartNumbers.has(num))) {
          matched.push(c)
          matchedViaShipShort.push(c)
        } else {
          unmatched.push(c)
        }
        continue
      }

      const primary = c.materialNumber.trim().toUpperCase()
      const deviationNums = (c.deviations ?? []).map((d) =>
        d.substituteMaterialNumber.trim().toUpperCase()
      )
      const allAcceptable = [primary, ...deviationNums].filter(Boolean)
      if (allAcceptable.some((num) => toMaterials.has(num))) {
        matched.push(c)
      } else if (allAcceptable.some((num) => shipShortPartNumbers.has(num))) {
        matched.push(c)
        matchedViaShipShort.push(c)
      } else {
        unmatched.push(c)
      }
    }
    return {
      matched,
      unmatched,
      matchedViaShipShort,
      isComplete: unmatched.length === 0,
    }
  }, [
    bomComponents,
    formData.importedTOs,
    formData.incoraItems,
    formData.authorizedShipShortItems,
  ])

  /**
   * Detection of TOs that reference a non-warehouse bin. Driven by the
   * org-level `non_warehouse_bin_patterns` setting (migration 314). The
   * notice card mounts when `hasMatches === true` and the submit
   * button is gated on `nonWarehouseBinAck`.
   *
   * Reset the acknowledgement whenever the set of triggered bins or
   * patterns changes — re-importing a different batch of TOs counts as
   * a new acknowledgement, even if the operator had previously ticked
   * the box for the earlier batch.
   */
  const nonWarehouseBinDetection = React.useMemo(
    () => detectNonWarehouseBins(formData.importedTOs, nonWarehouseBinPatterns),
    [formData.importedTOs, nonWarehouseBinPatterns]
  )

  const detectionFingerprint = React.useMemo(
    () =>
      nonWarehouseBinDetection.matches
        .map(
          (m) =>
            `${m.record.transferOrderNumber}|${m.sourceStorageBin}|${m.record.material}`
        )
        .sort()
        .join('::'),
    [nonWarehouseBinDetection.matches]
  )

  React.useEffect(() => {
    setNonWarehouseBinAck(false)
  }, [detectionFingerprint])

  const handleKitDefinitionChange = (definitionId: string) => {
    const def = kitDefinitions.find((d) => d.id === definitionId) ?? null
    setSelectedDefinition(def)
    if (def) {
      const components = (def.required_components ?? []) as BomComponent[]
      setBomComponents(components)

      const incoraFromBom: IncoraItem[] = components
        .filter(
          (c) =>
            (c.componentType === 'incora_sub_kit' ||
              c.componentType === 'incora_component') &&
            c.incoraReference?.trim()
        )
        .map((c, i) => ({
          lineNumber: i + 1,
          value: c.incoraReference!.trim(),
        }))

      setFormData((prev) => ({
        ...prev,
        kitNumber: def.kit_number,
        engineProgram: def.engine_program ?? '',
        kitDefinitionId: def.id,
        kitCartColor: def.default_kit_cart_color ?? undefined,
        kitContainerType: def.kit_container_type ?? undefined,
        chargeCode: def.charge_code ?? undefined,
        incoraItems: incoraFromBom,
      }))
    } else {
      setBomComponents([])
      setFormData((prev) => ({
        ...prev,
        kitDefinitionId: undefined,
        kitCartColor: undefined,
        kitContainerType: undefined,
        chargeCode: undefined,
        incoraItems: [],
      }))
    }
  }

  const handleFieldChange = <K extends keyof KitBuildPlanFormData>(
    field: K,
    value: KitBuildPlanFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  // INCORA Items handlers
  const handleAddIncoraItem = () => {
    if (formData.incoraItems.length >= 7) {
      toast.error('Maximum 7 INCORA items allowed')
      return
    }
    const nextLineNumber = formData.incoraItems.length + 1
    setFormData((prev) => ({
      ...prev,
      incoraItems: [
        ...prev.incoraItems,
        { lineNumber: nextLineNumber, value: '' },
      ],
    }))
  }

  const handleRemoveIncoraItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      incoraItems: prev.incoraItems
        .filter((_, i) => i !== index)
        .map((item, i) => ({ ...item, lineNumber: i + 1 })),
    }))
  }

  const handleIncoraItemChange = (index: number, value: string) => {
    setFormData((prev) => ({
      ...prev,
      incoraItems: prev.incoraItems.map((item, i) =>
        i === index ? { ...item, value } : item
      ),
    }))
  }

  // Authorized to Ship Short Items handlers
  const handleAddShipShortItem = () => {
    if (formData.authorizedShipShortItems.length >= 7) {
      toast.error('Maximum 7 Authorized to Ship Short items allowed')
      return
    }
    const nextLineNumber = formData.authorizedShipShortItems.length + 1
    setFormData((prev) => ({
      ...prev,
      authorizedShipShortItems: [
        ...prev.authorizedShipShortItems,
        { lineNumber: nextLineNumber, partNumber: '', description: '' },
      ],
    }))
  }

  const handleRemoveShipShortItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      authorizedShipShortItems: prev.authorizedShipShortItems
        .filter((_, i) => i !== index)
        .map((item, i) => ({ ...item, lineNumber: i + 1 })),
    }))
  }

  const handleShipShortItemChange = (
    index: number,
    field: 'partNumber' | 'description',
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      authorizedShipShortItems: prev.authorizedShipShortItems.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      ),
    }))
  }

  const handleImportFromClipboard = async () => {
    setIsImporting(true)

    try {
      const text = await navigator.clipboard.readText()

      if (!text.trim()) {
        toast.error('Clipboard is empty', {
          description: 'Copy data from Excel and try again.',
        })
        setIsImporting(false)
        return
      }

      // Count total data lines for feedback
      const normalizedText = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim()
      const allLines = normalizedText.split('\n')
      const firstLine = allLines[0].split('\t')
      const hasHeaders = firstLine.some((cell) =>
        EXPECTED_HEADERS.some((header) =>
          cell
            .trim()
            .toLowerCase()
            .includes(header.toLowerCase().substring(0, 10))
        )
      )
      const totalDataLines = (hasHeaders ? allLines.slice(1) : allLines).filter(
        (line) => line.trim()
      ).length

      const records = parseClipboardData(text)

      if (records.length === 0) {
        toast.error('No valid data found', {
          description:
            'Ensure rows have at least 11 columns including a Transfer Order Number.',
        })
        setIsImporting(false)
        return
      }

      setFormData((prev) => ({ ...prev, importedTOs: records }))

      const skippedCount = totalDataLines - records.length
      if (skippedCount > 0) {
        toast.success(
          `Imported ${records.length} Transfer Order${records.length === 1 ? '' : 's'}`,
          {
            description: `${skippedCount} row${skippedCount === 1 ? ' was' : 's were'} skipped (missing Transfer Order Number or insufficient columns).`,
          }
        )
      } else {
        toast.success(
          `Imported ${records.length} Transfer Order${records.length === 1 ? '' : 's'}`,
          {
            description: 'All rows imported successfully.',
          }
        )
      }
    } catch (error) {
      logger.error('Clipboard read error:', error)
      toast.error('Failed to read clipboard', {
        description: 'Please allow clipboard access and try again.',
      })
    }

    setIsImporting(false)
  }

  const handleClearImportedData = () => {
    setFormData((prev) => ({ ...prev, importedTOs: [] }))
    toast.info('Imported data cleared')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Defence-in-depth: the submit button is already disabled when the
    // ack is missing, but if a user finds a way to bypass that (e.g.
    // Enter key on a non-button focus) we surface a toast and abort
    // here too rather than silently saving a kit with unhandled
    // external-plant bins.
    if (nonWarehouseBinDetection.hasMatches && !nonWarehouseBinAck) {
      toast.error('Acknowledge External Plant Bins', {
        description:
          'Tick the acknowledgement checkbox on the External Plant Bins notice before saving.',
      })
      return
    }

    setIsSubmitting(true)

    await onSubmit({ ...formData, bomCoverage })

    setIsSubmitting(false)
    setSelectedDefinition(null)
    setBomComponents([])
    setNonWarehouseBinAck(false)
    setFormData({
      kitBuildNumber: '',
      kitPoNumber: '',
      engineProgram: '',
      kitNumber: '',
      deliverToPlant: '',
      dueDate: undefined,
      importedTOs: [],
      incoraItems: [],
      authorizedShipShortItems: [],
      kitCartColor: undefined,
      kitDefinitionId: undefined,
      kitContainerType: undefined,
      chargeCode: undefined,
    })
  }

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange(false)
      setSelectedDefinition(null)
      setBomComponents([])
      setNonWarehouseBinAck(false)
      setFormData({
        kitBuildNumber: '',
        kitPoNumber: '',
        engineProgram: '',
        kitNumber: '',
        deliverToPlant: '',
        dueDate: undefined,
        importedTOs: [],
        incoraItems: [],
        authorizedShipShortItems: [],
        kitCartColor: undefined,
        kitDefinitionId: undefined,
        kitContainerType: undefined,
        chargeCode: undefined,
      })
    }
  }

  const isFormValid =
    formData.kitBuildNumber.trim() !== '' &&
    formData.kitPoNumber.trim() !== '' &&
    formData.engineProgram !== '' &&
    formData.kitNumber.trim() !== '' &&
    formData.deliverToPlant !== '' &&
    formData.dueDate !== undefined &&
    (!nonWarehouseBinDetection.hasMatches || nonWarehouseBinAck)

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className='max-h-[72vh] overflow-y-auto sm:max-w-[960px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Package className='h-5 w-5' />
            Add to Kit Build Plan
          </DialogTitle>
          <DialogDescription>
            Create a new kit build plan entry. Fill in the required details
            below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldSet className='py-4'>
            <FieldLegend className='sr-only'>
              Kit Build Plan Details
            </FieldLegend>

            <FieldGroup className='gap-5'>
              {/* Row 0: Select Kit Definition (BOM) */}
              {kitDefinitions.length > 0 && (
                <Field>
                  <FieldLabel htmlFor='kit-definition'>
                    Select Kit Definition
                  </FieldLabel>
                  <Select
                    value={selectedDefinition?.id ?? ''}
                    onValueChange={handleKitDefinitionChange}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id='kit-definition' className='w-full'>
                      <SelectValue placeholder='Choose a kit to load BOM...' />
                    </SelectTrigger>
                    <SelectContent>
                      {kitDefinitions.map((def) => (
                        <SelectItem key={def.id} value={def.id}>
                          {def.kit_number} — {def.kit_name}
                          {def.engine_program ? ` (${def.engine_program})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Optional. Select a kit definition to auto-fill kit details
                    and load the BOM as a pick list.
                  </FieldDescription>
                </Field>
              )}

              {/* Row 1: Kit Build # and Kit PO Number */}
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                <Field>
                  <FieldLabel htmlFor='kit-build-number'>
                    Kit Build #<span className='text-destructive ml-1'>*</span>
                  </FieldLabel>
                  <Input
                    id='kit-build-number'
                    placeholder='e.g., KB-2025-001'
                    value={formData.kitBuildNumber}
                    onChange={(e) =>
                      handleFieldChange('kitBuildNumber', e.target.value)
                    }
                    disabled={isSubmitting}
                    autoComplete='off'
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor='kit-po-number'>
                    Kit PO Number
                    <span className='text-destructive ml-1'>*</span>
                  </FieldLabel>
                  <Input
                    id='kit-po-number'
                    placeholder='e.g., PO-45678'
                    value={formData.kitPoNumber}
                    onChange={(e) =>
                      handleFieldChange('kitPoNumber', e.target.value)
                    }
                    disabled={isSubmitting}
                    autoComplete='off'
                  />
                </Field>
              </div>

              {/* Row 2: Engine Program and Kit Number */}
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                <Field>
                  <FieldLabel htmlFor='engine-program'>
                    Engine Program
                    <span className='text-destructive ml-1'>*</span>
                  </FieldLabel>
                  <Select
                    value={formData.engineProgram}
                    onValueChange={(value) =>
                      handleFieldChange('engineProgram', value)
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id='engine-program' className='w-full'>
                      <SelectValue placeholder='Select engine program' />
                    </SelectTrigger>
                    <SelectContent>
                      {engineProgramOptions.map((option) => (
                        <SelectItem
                          key={option.id || option.option_value}
                          value={option.option_value}
                        >
                          {option.option_label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor='kit-number'>
                    Kit Number
                    <span className='text-destructive ml-1'>*</span>
                  </FieldLabel>
                  <Input
                    id='kit-number'
                    placeholder='e.g., KIT-001234'
                    value={formData.kitNumber}
                    onChange={(e) =>
                      handleFieldChange('kitNumber', e.target.value)
                    }
                    disabled={isSubmitting}
                    autoComplete='off'
                  />
                </Field>
              </div>

              {/* Row 3: Deliver To Plant and Due Date */}
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                <Field>
                  <FieldLabel htmlFor='deliver-to-plant'>
                    Deliver To Plant
                    <span className='text-destructive ml-1'>*</span>
                  </FieldLabel>
                  <Select
                    value={formData.deliverToPlant}
                    onValueChange={(value) =>
                      handleFieldChange('deliverToPlant', value)
                    }
                    disabled={isSubmitting || plantLocationOptions.length === 0}
                  >
                    <SelectTrigger id='deliver-to-plant' className='w-full'>
                      <SelectValue
                        placeholder={
                          plantLocationOptions.length === 0
                            ? 'No plants configured — add some in Settings'
                            : 'Select destination'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {plantLocationOptions.map((plant) => (
                        <SelectItem key={plant} value={plant}>
                          {plant}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {plantLocationOptions.length === 0 && (
                    <FieldDescription>
                      Add plant destinations from{' '}
                      <span className='font-medium'>
                        Settings → Workflow Settings → Deliver To Plant
                        Locations
                      </span>
                      .
                    </FieldDescription>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor='due-date'>
                    Due Date
                    <span className='text-destructive ml-1'>*</span>
                  </FieldLabel>
                  <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id='due-date'
                        variant='outline'
                        disabled={isSubmitting}
                        className={cn(
                          'w-full justify-start text-left font-normal',
                          !formData.dueDate && 'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className='mr-2 h-4 w-4' />
                        {formData.dueDate
                          ? format(formData.dueDate, 'PPP')
                          : 'Select due date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='w-auto p-0' align='start'>
                      <Calendar
                        mode='single'
                        selected={formData.dueDate}
                        onSelect={(date) => {
                          handleFieldChange('dueDate', date)
                          setCalendarOpen(false)
                        }}
                        disabled={(date) =>
                          date < new Date(new Date().setHours(0, 0, 0, 0))
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </Field>
              </div>

              {/* Row 4: Kit Cart Color */}
              <Field>
                <FieldLabel>
                  <span className='flex items-center gap-1.5'>
                    <Palette className='h-3.5 w-3.5' />
                    Kit Cart Color
                  </span>
                </FieldLabel>
                <ColorPickerInput
                  value={formData.kitCartColor ?? ''}
                  onChange={(value) =>
                    handleFieldChange('kitCartColor', value || undefined)
                  }
                  disabled={isSubmitting}
                  placeholder='#22c55e'
                  presetColors={KIT_CART_COLORS}
                />
                {formData.kitCartColor && (
                  <div className='mt-2 flex items-center gap-2 text-xs'>
                    <div
                      className='h-3 w-3 rounded-full'
                      style={{ backgroundColor: formData.kitCartColor }}
                    />
                    <span className='text-muted-foreground'>
                      {KIT_CART_COLORS.find(
                        (c) => c.value === formData.kitCartColor
                      )?.label ?? formData.kitCartColor}{' '}
                      — shown on printed build sheet sidebar
                    </span>
                  </div>
                )}
                <FieldDescription>
                  Optional. Select a color for the kit build sheet sidebar to
                  identify the cart configuration.
                </FieldDescription>
              </Field>

              {/* Row 5: Import TO's from clipboard */}
              <Field>
                <FieldLabel>Import Transfer Orders</FieldLabel>
                <div className='space-y-3'>
                  <div className='flex items-center gap-3'>
                    <Button
                      type='button'
                      variant='outline'
                      onClick={handleImportFromClipboard}
                      disabled={isSubmitting || isImporting}
                      className='flex-1'
                    >
                      {isImporting ? (
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      ) : (
                        <ClipboardPaste className='mr-2 h-4 w-4' />
                      )}
                      {isImporting
                        ? 'Importing...'
                        : 'Import TOs from Clipboard'}
                    </Button>

                    {formData.importedTOs.length > 0 && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        onClick={handleClearImportedData}
                        disabled={isSubmitting}
                        className='shrink-0'
                      >
                        <X className='h-4 w-4' />
                        <span className='sr-only'>Clear imported data</span>
                      </Button>
                    )}
                  </div>

                  {formData.importedTOs.length > 0 ? (
                    <div className='space-y-3'>
                      <div className='rounded-md border border-green-500/30 bg-green-500/10 p-3'>
                        <div className='flex items-center gap-2 text-sm text-green-700 dark:text-green-400'>
                          <CheckCircle2 className='h-4 w-4' />
                          <span className='font-medium'>
                            {formData.importedTOs.length} Transfer Order
                            {formData.importedTOs.length === 1 ? '' : 's'}{' '}
                            imported
                          </span>
                        </div>
                        <div className='mt-2 flex flex-wrap gap-1.5'>
                          {formData.importedTOs.slice(0, 5).map((to, idx) => (
                            <Badge
                              key={idx}
                              variant='secondary'
                              className='text-xs'
                            >
                              TO: {to.transferOrderNumber}
                            </Badge>
                          ))}
                          {formData.importedTOs.length > 5 && (
                            <Badge variant='outline' className='text-xs'>
                              +{formData.importedTOs.length - 5} more
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* External-plant-bin acknowledgement card —
                          self-hides when no TO row matches a
                          non-warehouse pattern. */}
                      <NonWarehouseBinNotice
                        detection={nonWarehouseBinDetection}
                        acknowledged={nonWarehouseBinAck}
                        onAcknowledgedChange={setNonWarehouseBinAck}
                        disabled={isSubmitting}
                      />
                    </div>
                  ) : (
                    <div className='border-muted-foreground/30 bg-muted/30 rounded-md border border-dashed p-3'>
                      <p className='text-muted-foreground text-xs'>
                        Copy rows from Excel and click the button above to
                        import. Required columns:
                      </p>
                      <p className='text-muted-foreground/80 mt-1.5 text-xs leading-relaxed'>
                        Dest.Storage Bin, Transfer Order Number, Source Storage
                        Type, Warehouse Number, Dest. Storage Type, Movement
                        Type (IM), Movement Type (WM), Source Storage Bin,
                        Plant, Storage Location, Material, Material Description,
                        Batch, Source target qty, Creation Date, Creation time,
                        User, Printer, Special Stock Number
                      </p>
                    </div>
                  )}
                </div>
                <FieldDescription>
                  Optional. Copy data from Excel (all 19 columns) and import via
                  clipboard.
                </FieldDescription>
              </Field>

              {/* Container Type Preview */}
              {formData.kitContainerType && (
                <Field>
                  <FieldLabel>Container Type</FieldLabel>
                  <Badge variant='outline' className='w-fit text-xs'>
                    {kitContainerLabelMap[formData.kitContainerType] ??
                      formData.kitContainerType}
                  </Badge>
                  <FieldDescription>
                    From the selected kit definition.
                  </FieldDescription>
                </Field>
              )}

              {formData.chargeCode && (
                <Field>
                  <FieldLabel>Charge Code</FieldLabel>
                  <Badge variant='outline' className='w-fit text-xs'>
                    {chargeCodeLabelMap[formData.chargeCode] ??
                      formData.chargeCode}
                  </Badge>
                  <FieldDescription>
                    Will print on the kit build sheet.
                  </FieldDescription>
                </Field>
              )}

              {/* BOM Pick List Preview */}
              {bomComponents.length > 0 && (
                <Field>
                  <FieldLabel>
                    BOM Pick List ({bomComponents.length} components)
                  </FieldLabel>
                  <div className='max-h-48 space-y-1 overflow-y-auto rounded-md border p-3'>
                    {bomComponents.map((c, idx) => {
                      const isIncoraSubKit =
                        c.componentType === 'incora_sub_kit'
                      const isIncoraComponent =
                        c.componentType === 'incora_component'
                      const isInfo = c.coverageMode === 'informational'
                      const coveredEntry = bomCoverage
                        ? bomCoverage.matched.includes(c)
                        : false
                      const coveredViaShipShort = bomCoverage
                        ? bomCoverage.matchedViaShipShort.includes(c)
                        : false
                      const hasData =
                        formData.importedTOs.length > 0 ||
                        formData.incoraItems.length > 0 ||
                        formData.authorizedShipShortItems.length > 0
                      const displayId = isIncoraSubKit
                        ? (c.incoraReference ?? '')
                        : isIncoraComponent
                          ? c.materialNumber || c.incoraReference || ''
                          : c.materialNumber
                      return (
                        <div
                          key={idx}
                          className={cn(
                            'flex items-center gap-2 rounded px-2 py-1 text-xs',
                            isInfo && 'opacity-60',
                            hasData &&
                              coveredEntry &&
                              !coveredViaShipShort &&
                              'bg-green-500/10',
                            hasData && coveredViaShipShort && 'bg-amber-500/10',
                            hasData &&
                              !coveredEntry &&
                              !isInfo &&
                              'bg-red-500/10'
                          )}
                        >
                          {hasData && !isInfo ? (
                            coveredEntry ? (
                              <CheckCircle2
                                className={cn(
                                  'h-3.5 w-3.5 shrink-0',
                                  coveredViaShipShort
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-green-600 dark:text-green-400'
                                )}
                              />
                            ) : (
                              <AlertTriangle className='h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400' />
                            )
                          ) : (
                            <Package className='text-muted-foreground h-3.5 w-3.5 shrink-0' />
                          )}
                          {isIncoraSubKit && (
                            <Badge
                              variant='outline'
                              className='px-1 py-0 text-[9px]'
                            >
                              INCORA Sub-Kit
                            </Badge>
                          )}
                          {isIncoraComponent && (
                            <Badge
                              variant='outline'
                              className='px-1 py-0 text-[9px]'
                            >
                              INCORA Component
                            </Badge>
                          )}
                          <span className='font-mono'>{displayId}</span>
                          {isIncoraComponent &&
                            c.materialNumber &&
                            c.incoraReference && (
                              <span className='text-muted-foreground/80 font-mono text-[10px]'>
                                ({c.incoraReference})
                              </span>
                            )}
                          <span className='text-muted-foreground truncate'>
                            {c.materialDescription}
                          </span>
                          {coveredViaShipShort && (
                            <Badge
                              variant='outline'
                              className='border-amber-500/40 px-1 py-0 text-[9px] text-amber-700 dark:text-amber-300'
                            >
                              Ship Short
                            </Badge>
                          )}
                          {c.partContainerType && (
                            <Badge
                              variant='secondary'
                              className='px-1 py-0 text-[9px]'
                            >
                              {partContainerLabelMap[c.partContainerType] ??
                                c.partContainerType}
                            </Badge>
                          )}
                          {isInfo && (
                            <Badge
                              variant='secondary'
                              className='px-1 py-0 text-[9px]'
                            >
                              Info
                            </Badge>
                          )}
                          <span className='text-muted-foreground ml-auto shrink-0'>
                            Qty: {c.requiredQuantity}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {bomCoverage &&
                    (formData.importedTOs.length > 0 ||
                      formData.incoraItems.length > 0 ||
                      formData.authorizedShipShortItems.length > 0) && (
                      <div className='mt-2'>
                        {bomCoverage.isComplete ? (
                          <div className='flex items-center gap-2 text-sm text-green-700 dark:text-green-400'>
                            <CheckCircle2 className='h-4 w-4' />
                            All required BOM components covered
                            {bomCoverage.matchedViaShipShort.length > 0 && (
                              <span className='text-amber-700 dark:text-amber-300'>
                                ({bomCoverage.matchedViaShipShort.length}{' '}
                                authorized to ship short)
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className='rounded-md border border-red-500/30 bg-red-500/10 p-3'>
                            <div className='flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400'>
                              <AlertTriangle className='h-4 w-4' />
                              {bomCoverage.unmatched.length} required BOM
                              component(s) missing — Kit will be flagged as
                              Black Hat
                            </div>
                            <div className='mt-1.5 space-y-0.5'>
                              {bomCoverage.unmatched.map((c, i) => {
                                let label: string
                                if (c.componentType === 'incora_sub_kit') {
                                  label = `INCORA: ${c.incoraReference}`
                                } else if (
                                  c.componentType === 'incora_component'
                                ) {
                                  const matPart = c.materialNumber || ''
                                  const refPart = c.incoraReference
                                    ? `INCORA: ${c.incoraReference}`
                                    : ''
                                  label =
                                    matPart && refPart
                                      ? `${matPart} / ${refPart}`
                                      : matPart || refPart || ''
                                } else {
                                  label = c.materialNumber
                                }
                                return (
                                  <p
                                    key={i}
                                    className='text-xs text-red-600 dark:text-red-300'
                                  >
                                    {label} — {c.materialDescription}
                                  </p>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                </Field>
              )}

              {/* INCORA Items Section */}
              <Field>
                <div className='flex items-center justify-between'>
                  <FieldLabel>INCORA Items</FieldLabel>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={handleAddIncoraItem}
                    disabled={isSubmitting || formData.incoraItems.length >= 7}
                    className='h-7 text-xs'
                  >
                    <Plus className='mr-1 h-3 w-3' />
                    Add Item
                  </Button>
                </div>
                <div className='mt-2 space-y-2'>
                  {formData.incoraItems.length > 0 ? (
                    formData.incoraItems.map((item, index) => (
                      <div key={index} className='flex items-center gap-2'>
                        <span className='text-muted-foreground w-6 text-center text-xs'>
                          {item.lineNumber}.
                        </span>
                        <Input
                          placeholder='Enter INCORA reference...'
                          value={item.value}
                          onChange={(e) =>
                            handleIncoraItemChange(index, e.target.value)
                          }
                          disabled={isSubmitting}
                          className='h-8 flex-1 text-sm'
                        />
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          onClick={() => handleRemoveIncoraItem(index)}
                          disabled={isSubmitting}
                          className='h-8 w-8 shrink-0'
                        >
                          <Trash2 className='text-muted-foreground hover:text-destructive h-3.5 w-3.5' />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className='border-muted-foreground/30 bg-muted/30 rounded-md border border-dashed p-3'>
                      <p className='text-muted-foreground text-center text-xs'>
                        No INCORA items added. Click "Add Item" to add
                        references.
                      </p>
                    </div>
                  )}
                </div>
                <FieldDescription>
                  Optional. Add INCORA references that apply to this kit (max 7
                  items).
                </FieldDescription>
              </Field>

              {/* Authorized to Ship Short Items Section */}
              <Field>
                <div className='flex items-center justify-between'>
                  <FieldLabel>Authorized to Ship Short</FieldLabel>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={handleAddShipShortItem}
                    disabled={
                      isSubmitting ||
                      formData.authorizedShipShortItems.length >= 7
                    }
                    className='h-7 text-xs'
                  >
                    <Plus className='mr-1 h-3 w-3' />
                    Add Item
                  </Button>
                </div>
                <div className='mt-2 space-y-2'>
                  {formData.authorizedShipShortItems.length > 0 ? (
                    formData.authorizedShipShortItems.map((item, index) => (
                      <div key={index} className='flex items-center gap-2'>
                        <span className='text-muted-foreground w-6 text-center text-xs'>
                          {item.lineNumber}.
                        </span>
                        <Input
                          placeholder='Part #'
                          value={item.partNumber}
                          onChange={(e) =>
                            handleShipShortItemChange(
                              index,
                              'partNumber',
                              e.target.value
                            )
                          }
                          disabled={isSubmitting}
                          className='h-8 w-28 text-sm'
                        />
                        <Input
                          placeholder='Description / Reason'
                          value={item.description}
                          onChange={(e) =>
                            handleShipShortItemChange(
                              index,
                              'description',
                              e.target.value
                            )
                          }
                          disabled={isSubmitting}
                          className='h-8 flex-1 text-sm'
                        />
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          onClick={() => handleRemoveShipShortItem(index)}
                          disabled={isSubmitting}
                          className='h-8 w-8 shrink-0'
                        >
                          <Trash2 className='text-muted-foreground hover:text-destructive h-3.5 w-3.5' />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className='border-muted-foreground/30 bg-muted/30 rounded-md border border-dashed p-3'>
                      <p className='text-muted-foreground text-center text-xs'>
                        No ship short items added. Click "Add Item" to authorize
                        shipping short.
                      </p>
                    </div>
                  )}
                </div>
                <FieldDescription>
                  Optional. Document parts authorized to ship short for this kit
                  (max 7 items). A part number listed here negates the Black Hat
                  flag for the matching BOM line so the kit can be picked
                  without that material on hand.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>

          <DialogFooter className='gap-3'>
            <Button
              type='button'
              variant='outline'
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={isSubmitting || !isFormValid}>
              {isSubmitting ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Adding...
                </>
              ) : (
                'Add to Plan'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
