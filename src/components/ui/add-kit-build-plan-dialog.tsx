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
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  KitDefinitionsService,
  type BomComponent,
  type KitDefinitionRecord,
} from '@/lib/supabase/kit-definitions.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
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

const PLANT_LOCATIONS = [
  'Plant A - Main Assembly',
  'Plant B - Component Shop',
  'Plant C - Engine Test',
  'Plant D - Logistics Hub',
  'Plant E - Quality Center',
  'Warehouse 1',
  'Warehouse 2',
  'Shipping Dock',
]

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
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isImporting, setIsImporting] = React.useState(false)
  const [calendarOpen, setCalendarOpen] = React.useState(false)
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
    const matched: BomComponent[] = []
    const unmatched: BomComponent[] = []
    for (const c of bomComponents) {
      if (toMaterials.has(c.materialNumber.trim().toUpperCase())) {
        matched.push(c)
      } else {
        unmatched.push(c)
      }
    }
    return { matched, unmatched, isComplete: unmatched.length === 0 }
  }, [bomComponents, formData.importedTOs])

  const handleKitDefinitionChange = (definitionId: string) => {
    const def = kitDefinitions.find((d) => d.id === definitionId) ?? null
    setSelectedDefinition(def)
    if (def) {
      const components = (def.required_components ?? []) as BomComponent[]
      setBomComponents(components)
      setFormData((prev) => ({
        ...prev,
        kitNumber: def.kit_number,
        engineProgram: def.engine_program ?? '',
        kitDefinitionId: def.id,
      }))
    } else {
      setBomComponents([])
      setFormData((prev) => ({
        ...prev,
        kitDefinitionId: undefined,
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
    setIsSubmitting(true)

    await onSubmit({ ...formData, bomCoverage })

    setIsSubmitting(false)
    setSelectedDefinition(null)
    setBomComponents([])
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
    })
  }

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange(false)
      setSelectedDefinition(null)
      setBomComponents([])
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
      })
    }
  }

  const isFormValid =
    formData.kitBuildNumber.trim() !== '' &&
    formData.kitPoNumber.trim() !== '' &&
    formData.engineProgram !== '' &&
    formData.kitNumber.trim() !== '' &&
    formData.deliverToPlant !== '' &&
    formData.dueDate !== undefined

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-[600px]'>
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
                      {ENGINE_PROGRAMS.map((program) => (
                        <SelectItem key={program} value={program}>
                          {program}
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
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id='deliver-to-plant' className='w-full'>
                      <SelectValue placeholder='Select destination' />
                    </SelectTrigger>
                    <SelectContent>
                      {PLANT_LOCATIONS.map((plant) => (
                        <SelectItem key={plant} value={plant}>
                          {plant}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

              {/* Row 4: Import TO's from clipboard */}
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

              {/* BOM Pick List Preview */}
              {bomComponents.length > 0 && (
                <Field>
                  <FieldLabel>
                    BOM Pick List ({bomComponents.length} materials)
                  </FieldLabel>
                  <div className='max-h-48 space-y-1 overflow-y-auto rounded-md border p-3'>
                    {bomComponents.map((c, idx) => {
                      const isCovered =
                        formData.importedTOs.length > 0 &&
                        formData.importedTOs.some(
                          (to) =>
                            to.material.trim().toUpperCase() ===
                            c.materialNumber.trim().toUpperCase()
                        )
                      const hasTOs = formData.importedTOs.length > 0
                      return (
                        <div
                          key={idx}
                          className={cn(
                            'flex items-center gap-2 rounded px-2 py-1 text-xs',
                            hasTOs && isCovered && 'bg-green-500/10',
                            hasTOs && !isCovered && 'bg-red-500/10'
                          )}
                        >
                          {hasTOs ? (
                            isCovered ? (
                              <CheckCircle2 className='h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400' />
                            ) : (
                              <AlertTriangle className='h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400' />
                            )
                          ) : (
                            <Package className='text-muted-foreground h-3.5 w-3.5 shrink-0' />
                          )}
                          <span className='font-mono'>{c.materialNumber}</span>
                          <span className='text-muted-foreground truncate'>
                            {c.materialDescription}
                          </span>
                          <span className='text-muted-foreground ml-auto shrink-0'>
                            Qty: {c.requiredQuantity}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {bomCoverage && formData.importedTOs.length > 0 && (
                    <div className='mt-2'>
                      {bomCoverage.isComplete ? (
                        <div className='flex items-center gap-2 text-sm text-green-700 dark:text-green-400'>
                          <CheckCircle2 className='h-4 w-4' />
                          All {bomComponents.length} BOM materials covered by
                          imported TOs
                        </div>
                      ) : (
                        <div className='rounded-md border border-red-500/30 bg-red-500/10 p-3'>
                          <div className='flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400'>
                            <AlertTriangle className='h-4 w-4' />
                            {bomCoverage.unmatched.length} of{' '}
                            {bomComponents.length} BOM material(s) missing — Kit
                            will be flagged as Black Hat
                          </div>
                          <div className='mt-1.5 space-y-0.5'>
                            {bomCoverage.unmatched.map((c, i) => (
                              <p
                                key={i}
                                className='text-xs text-red-600 dark:text-red-300'
                              >
                                {c.materialNumber} — {c.materialDescription}
                              </p>
                            ))}
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
                  (max 7 items).
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
