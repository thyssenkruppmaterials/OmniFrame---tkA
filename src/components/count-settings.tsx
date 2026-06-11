// Created and developed by Jai Singh
import { useState, useCallback, useMemo, lazy, Suspense } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlertTriangle,
  Barcode,
  Calculator,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Eye,
  FileText,
  GripVertical,
  Hash,
  Layers,
  Loader2,
  MapPin,
  Package,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Warehouse,
  Workflow,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  WorkflowStepConfig,
  WorkflowStepType,
} from '@/lib/supabase/workflow-config.service'
import { cn } from '@/lib/utils'
import {
  BUILT_IN_COUNT_TYPE_OPTIONS,
  type CountTypeOption,
} from '@/hooks/use-count-type-options'
import { useWorkflowConfigs } from '@/hooks/use-workflow-configs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { StatTile, type StatTileAccent } from '@/components/ui/stat-tile'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

// ─── Step Type Metadata ──────────────────────────────────────────────────────

const STEP_TYPE_META: Record<
  WorkflowStepType,
  {
    icon: React.ComponentType<{ className?: string }>
    label: string
    singleton: boolean
    description: string
    color: string
  }
> = {
  confirm: {
    icon: Check,
    label: 'Confirm Item',
    singleton: true,
    description: 'Operator verifies item details before starting',
    color:
      'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400',
  },
  location_scan: {
    icon: MapPin,
    label: 'Scan Location',
    singleton: true,
    description: 'Scan barcode to verify correct location',
    color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400',
  },
  quantity_entry: {
    icon: Calculator,
    label: 'Enter Quantity',
    singleton: true,
    description: 'Count and enter quantity using keypad',
    color:
      'text-violet-600 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-400',
  },
  empty_location_verification: {
    icon: Eye,
    label: 'Empty Location Check',
    singleton: true,
    description: 'Verify whether location is actually empty',
    color:
      'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400',
  },
  photo_capture: {
    icon: Camera,
    label: 'Photo Capture',
    singleton: false,
    description: 'Capture evidence photos of inventory',
    color: 'text-pink-600 bg-pink-50 dark:bg-pink-950/40 dark:text-pink-400',
  },
  serial_number: {
    icon: Hash,
    label: 'Serial Number Capture',
    singleton: false,
    description: 'Scan or enter serial numbers',
    color:
      'text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-400',
  },
  barcode_label_scan: {
    icon: Barcode,
    label: 'Barcode / Label Scan',
    singleton: false,
    description: 'Scan a barcode or label on the item',
    color: 'text-teal-600 bg-teal-50 dark:bg-teal-950/40 dark:text-teal-400',
  },
  condition_assessment: {
    icon: ClipboardCheck,
    label: 'Condition Assessment',
    singleton: true,
    description: 'Assess item condition (Good / Damaged / Expired)',
    color: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40 dark:text-cyan-400',
  },
  notes: {
    icon: FileText,
    label: 'Notes',
    singleton: true,
    description: 'Add free-text notes to the count',
    color:
      'text-slate-600 bg-slate-50 dark:bg-slate-800/60 dark:text-slate-300',
  },
  review: {
    icon: AlertTriangle,
    label: 'Variance Review',
    singleton: true,
    description: 'Review step triggered when variance exceeds thresholds',
    color: 'text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-400',
  },
  supervisor_signoff: {
    icon: ShieldCheck,
    label: 'Supervisor Sign-off',
    singleton: true,
    description: 'Require supervisor approval to complete the count',
    color:
      'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-400',
  },
  part_number_verification: {
    icon: Barcode,
    label: 'Part Number Verification',
    singleton: true,
    description:
      'Scan (or manually enter) the part at the location and auto-detect part variance',
    color:
      'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-950/40 dark:text-fuchsia-400',
  },
  found_part_transfer: {
    icon: MapPin,
    label: 'Found Part Transfer',
    singleton: true,
    description:
      'Record moving a misplaced part from one location into the task’s location and capture the new consolidated quantity',
    color: 'text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-400',
  },
}

const ALL_STEP_TYPES = Object.keys(STEP_TYPE_META) as WorkflowStepType[]

// ─── Count Type Slug Helpers ─────────────────────────────────────────────────
// As of migration 217 `count_type` is free-form TEXT. The UI still surfaces
// the built-in defaults as quick-pick presets, but admins can create
// organization-specific slugs too. Keep the shared list in
// `use-count-type-options.ts` as the single source of truth.

const COUNT_TYPE_SLUG_REGEX = /^[a-z0-9][a-z0-9_]{0,62}[a-z0-9]$|^[a-z0-9]$/

/** Convert an arbitrary display name to a valid count_type slug. */
function slugifyCountType(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

function isValidCountTypeSlug(slug: string): boolean {
  return COUNT_TYPE_SLUG_REGEX.test(slug)
}

// Sensible starter steps for a freshly-created workflow. Keeps the config
// immediately valid under `validateSteps` so the user can save without edits.
function buildDefaultSteps(): WorkflowStepConfig[] {
  const now = Date.now()
  return [
    {
      id: `step-confirm-${now}`,
      type: 'confirm',
      label: STEP_TYPE_META.confirm.label,
      required: true,
      order: 1,
      config: {},
    },
    {
      id: `step-location_scan-${now + 1}`,
      type: 'location_scan',
      label: STEP_TYPE_META.location_scan.label,
      required: true,
      order: 2,
      config: {},
    },
    {
      id: `step-quantity_entry-${now + 2}`,
      type: 'quantity_entry',
      label: STEP_TYPE_META.quantity_entry.label,
      required: true,
      order: 3,
      config: {},
    },
  ]
}

const DATA_CAPTURE_STEPS: WorkflowStepType[] = [
  'quantity_entry',
  'photo_capture',
  'serial_number',
  'barcode_label_scan',
  'condition_assessment',
  'part_number_verification',
  'found_part_transfer',
]

// ─── Sortable Step Card ──────────────────────────────────────────────────────

interface SortableStepCardProps {
  step: WorkflowStepConfig
  index: number
  onToggleRequired: (id: string) => void
  onRemove: (id: string) => void
}

function SortableStepCard({
  step,
  index,
  onToggleRequired,
  onRemove,
}: SortableStepCardProps) {
  const meta = STEP_TYPE_META[step.type]
  const Icon = meta?.icon ?? Package

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group bg-card flex items-center gap-3 rounded-xl border px-4 py-3 transition-all',
        isDragging && 'z-50 scale-[1.02] opacity-80 shadow-xl',
        !isDragging && 'hover:border-primary/40 hover:shadow-sm'
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className='hover:bg-muted -ml-1 cursor-grab touch-none rounded-md p-1.5 active:cursor-grabbing'
      >
        <GripVertical className='text-muted-foreground/60 h-4 w-4' />
      </button>

      <div className='text-muted-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-slate-100 to-slate-200 text-xs font-bold dark:from-slate-800 dark:to-slate-700'>
        {index + 1}
      </div>

      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          meta?.color ?? 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className='h-4 w-4' />
      </div>

      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium'>{step.label}</p>
        <p className='text-muted-foreground truncate text-xs'>
          {meta?.description}
        </p>
      </div>

      <div className='flex items-center gap-2'>
        <button
          onClick={() => onToggleRequired(step.id)}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase transition-all select-none',
            step.required
              ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60'
              : 'border-border text-muted-foreground hover:bg-muted'
          )}
        >
          {step.required ? 'Required' : 'Optional'}
        </button>

        <Button
          variant='ghost'
          size='icon'
          className='text-muted-foreground hover:text-destructive h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100'
          onClick={() => onRemove(step.id)}
        >
          <Trash2 className='h-3.5 w-3.5' />
        </Button>
      </div>
    </div>
  )
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateSteps(steps: WorkflowStepConfig[]): string[] {
  const errors: string[] = []
  const types = steps.map((s) => s.type)

  if (
    !types.includes('quantity_entry') &&
    !types.includes('empty_location_verification') &&
    !types.includes('part_number_verification') &&
    !types.includes('found_part_transfer')
  ) {
    errors.push(
      'At least one count / verify step is required (Enter Quantity, Empty Location Check, Part Number Verification, or Found Part Transfer).'
    )
  }

  const signoffIndex = types.indexOf('supervisor_signoff')
  if (signoffIndex !== -1 && signoffIndex !== types.length - 1) {
    errors.push('"Supervisor Sign-off" must be the last step.')
  }

  const reviewIndex = types.indexOf('review')
  if (reviewIndex !== -1) {
    const precedingTypes = types.slice(0, reviewIndex)
    if (!precedingTypes.some((t) => DATA_CAPTURE_STEPS.includes(t))) {
      errors.push('"Variance Review" requires a data-capture step before it.')
    }
  }

  return errors
}

// ─── Section Rail (top-level navigation) ─────────────────────────────────────

type SectionId =
  | 'workflows'
  | 'path-engine'
  | 'zone-rules'
  | 'priority-rules'
  | 'warehouses'

interface SectionDef {
  id: SectionId
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  accent: string // bg / icon tint
  ring: string // active rail accent color
}

const SECTIONS: SectionDef[] = [
  {
    id: 'workflows',
    label: 'Workflow Rules',
    description: 'Step-by-step counter flow per count type',
    icon: Workflow,
    accent: 'text-primary bg-primary/10',
    ring: 'bg-primary',
  },
  {
    id: 'path-engine',
    label: 'Path Engine',
    description: 'Location parsing and counter routing',
    icon: MapPin,
    accent: 'text-blue-600 bg-blue-500/10 dark:text-blue-400',
    ring: 'bg-blue-500',
  },
  {
    id: 'zone-rules',
    label: 'Zone Rules',
    description: 'Mutual exclusion and assignment policy',
    icon: ShieldCheck,
    accent: 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-400',
    ring: 'bg-emerald-500',
  },
  {
    id: 'priority-rules',
    label: 'Priority Rules',
    description: 'Auto-tier counts by zone, age, variance',
    icon: Zap,
    accent: 'text-amber-600 bg-amber-500/10 dark:text-amber-400',
    ring: 'bg-amber-500',
  },
  {
    id: 'warehouses',
    label: 'Warehouses',
    description: 'Valid warehouse codes enforced on RF scans',
    icon: Warehouse,
    accent: 'text-sky-600 bg-sky-500/10 dark:text-sky-400',
    ring: 'bg-sky-500',
  },
]

interface SectionTileProps {
  section: SectionDef
  active: boolean
  onClick: () => void
}

function SectionTile({ section, active, onClick }: SectionTileProps) {
  const Icon = section.icon
  return (
    <button
      type='button'
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group relative flex h-full items-center gap-3 px-4 py-4 text-left transition-colors',
        active ? 'bg-accent/40' : 'hover:bg-accent/20'
      )}
    >
      {/* Active rail */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-0 top-0 h-0.5 transition-opacity',
          section.ring,
          active ? 'opacity-100' : 'opacity-0'
        )}
      />

      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 transition-shadow',
          section.accent,
          active ? 'ring-foreground/10 shadow-sm' : 'ring-transparent'
        )}
      >
        <Icon className='h-5 w-5' />
      </div>

      <div className='min-w-0 flex-1'>
        <p
          className={cn(
            'truncate text-sm font-semibold',
            active ? 'text-foreground' : 'text-foreground/85'
          )}
        >
          {section.label}
        </p>
        <p className='text-muted-foreground truncate text-[11px] leading-snug'>
          {section.description}
        </p>
      </div>

      <ChevronRight
        className={cn(
          'h-4 w-4 shrink-0 transition-all',
          active
            ? 'text-foreground/70 translate-x-0'
            : 'text-muted-foreground/40 -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'
        )}
      />
    </button>
  )
}

// ─── Stat / KPI cell ─────────────────────────────────────────────────────────

interface StatCellProps {
  label: string
  value: number | string
  hint?: string
  tone?: 'default' | 'positive' | 'warn' | 'muted'
  icon?: React.ComponentType<{ className?: string }>
}

// Thin wrapper around the canonical `<StatTile>` that keeps the divided-strip
// styling used by the count-settings workbench header. The wrapper is what
// callsites still import; the visual + truncate/min-w-0/container-query
// guarantees come from StatTile.
function StatCell({
  label,
  value,
  hint,
  tone = 'default',
  icon: Icon,
}: StatCellProps) {
  const accent: StatTileAccent =
    tone === 'positive' ? 'emerald' : tone === 'warn' ? 'amber' : 'default'
  return (
    <StatTile
      label={label}
      value={value}
      hint={hint}
      icon={Icon ? <Icon className='h-3 w-3' /> : undefined}
      accent={accent}
      format='raw'
      valueClassName={cn(
        'font-mono',
        tone === 'muted' && 'text-muted-foreground'
      )}
      className='hover:bg-accent/20 rounded-none border-0 bg-transparent px-5 py-4 dark:bg-transparent'
    />
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

const PathEnginePanel = lazy(() => import('@/components/path-engine-panel'))
const ZoneRulesPanel = lazy(() => import('@/components/zone-rules-panel'))
const PriorityRulesPanel = lazy(
  () => import('@/components/priority-rules-panel')
)
const WarehousesPanel = lazy(
  () => import('@/components/warehouse-settings-panel')
)

export default function CountSettings() {
  const [activeSection, setActiveSection] = useState<SectionId>('workflows')

  const activeSectionDef = useMemo(
    () => SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0],
    [activeSection]
  )

  return (
    <div className='space-y-5'>
      {/* ── Section Rail (Unified Workbench top strip) ── */}
      <Card className='gap-0 overflow-hidden p-0 shadow-sm'>
        <div className='divide-border grid grid-cols-1 divide-y sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-y-0'>
          {SECTIONS.map((section) => (
            <SectionTile
              key={section.id}
              section={section}
              active={activeSection === section.id}
              onClick={() => setActiveSection(section.id)}
            />
          ))}
        </div>
      </Card>

      {/* ── Active Section Body ── */}
      <div role='region' aria-label={activeSectionDef.label}>
        {activeSection === 'path-engine' ? (
          <Suspense
            fallback={
              <div className='flex h-64 items-center justify-center'>
                <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            }
          >
            <PathEnginePanel />
          </Suspense>
        ) : activeSection === 'zone-rules' ? (
          <Suspense
            fallback={
              <div className='flex h-64 items-center justify-center'>
                <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            }
          >
            <ZoneRulesPanel />
          </Suspense>
        ) : activeSection === 'priority-rules' ? (
          <Suspense
            fallback={
              <div className='flex h-64 items-center justify-center'>
                <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            }
          >
            <PriorityRulesPanel />
          </Suspense>
        ) : activeSection === 'warehouses' ? (
          <Suspense
            fallback={
              <div className='flex h-64 items-center justify-center'>
                <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            }
          >
            <WarehousesPanel />
          </Suspense>
        ) : (
          <WorkflowRulesPanel />
        )}
      </div>
    </div>
  )
}

function WorkflowRulesPanel() {
  const { configs, isLoading, upsertConfig, resetConfig } = useWorkflowConfigs()

  const [selectedCountType, setSelectedCountType] = useState<string | null>(
    null
  )
  const [editedSteps, setEditedSteps] = useState<WorkflowStepConfig[]>([])
  const [editedDisplayName, setEditedDisplayName] = useState('')
  const [editedDescription, setEditedDescription] = useState('')
  const [editedIsActive, setEditedIsActive] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [addStepOpen, setAddStepOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'inactive'
  >('all')

  // ── New Workflow Dialog State ──
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newCountType, setNewCountType] = useState<string>('')
  const [newCountTypeTouched, setNewCountTypeTouched] = useState(false)
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const selectedConfig = useMemo(
    () => configs.find((c) => c.count_type === selectedCountType) ?? null,
    [configs, selectedCountType]
  )

  const filteredConfigs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return configs.filter((c) => {
      if (statusFilter === 'active' && !c.is_active) return false
      if (statusFilter === 'inactive' && c.is_active) return false
      if (!q) return true
      return (
        c.display_name.toLowerCase().includes(q) ||
        c.count_type.toLowerCase().includes(q)
      )
    })
  }, [configs, searchQuery, statusFilter])

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedConfig) return false
    if (editedDisplayName !== selectedConfig.display_name) return true
    if (editedDescription !== (selectedConfig.description ?? '')) return true
    if (editedIsActive !== selectedConfig.is_active) return true
    if (editedSteps.length !== selectedConfig.steps.length) return true
    return editedSteps.some((step, i) => {
      const orig = selectedConfig.steps[i]
      return (
        step.id !== orig.id ||
        step.type !== orig.type ||
        step.required !== orig.required ||
        step.order !== orig.order
      )
    })
  }, [
    selectedConfig,
    editedDisplayName,
    editedDescription,
    editedIsActive,
    editedSteps,
  ])

  const validationErrors = useMemo(
    () => (selectedConfig ? validateSteps(editedSteps) : []),
    [selectedConfig, editedSteps]
  )

  const existingCountTypes = useMemo(
    () => new Set(configs.map((c) => c.count_type)),
    [configs]
  )

  const availablePresetOptions = useMemo<CountTypeOption[]>(
    () =>
      BUILT_IN_COUNT_TYPE_OPTIONS.filter(
        (o) => !existingCountTypes.has(o.value)
      ),
    [existingCountTypes]
  )

  const countTypeValidationError = useMemo<string | null>(() => {
    if (!newCountType) return null
    if (!isValidCountTypeSlug(newCountType)) {
      return 'Use lowercase letters, numbers, and underscores only (2–64 chars, cannot start/end with underscore).'
    }
    if (existingCountTypes.has(newCountType)) {
      return 'A workflow with this slug already exists for your organization.'
    }
    return null
  }, [newCountType, existingCountTypes])

  const availableStepTypes = useMemo(() => {
    const existingTypes = new Set(editedSteps.map((s) => s.type))
    return ALL_STEP_TYPES.filter((t) => {
      const meta = STEP_TYPE_META[t]
      return meta.singleton ? !existingTypes.has(t) : true
    })
  }, [editedSteps])

  // ── Aggregate stats for the KPI strip ──
  const stats = useMemo(() => {
    const total = configs.length
    const active = configs.filter((c) => c.is_active).length
    const inactive = total - active
    const stepsTotal = configs.reduce((sum, c) => sum + c.steps.length, 0)
    const avgSteps = total > 0 ? Math.round((stepsTotal / total) * 10) / 10 : 0
    return { total, active, inactive, avgSteps }
  }, [configs])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // ── Handlers ──

  const loadConfigIntoEditor = useCallback(
    (countType: string) => {
      const cfg = configs.find((c) => c.count_type === countType)
      if (!cfg) return
      setSelectedCountType(countType)
      setEditedSteps([...cfg.steps].sort((a, b) => a.order - b.order))
      setEditedDisplayName(cfg.display_name)
      setEditedDescription(cfg.description ?? '')
      setEditedIsActive(cfg.is_active)
      setAddStepOpen(false)
    },
    [configs]
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setEditedSteps((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id)
      const newIndex = prev.findIndex((s) => s.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(prev, oldIndex, newIndex).map((s, i) => ({
        ...s,
        order: i + 1,
      }))
    })
  }, [])

  const handleToggleRequired = useCallback((stepId: string) => {
    setEditedSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, required: !s.required } : s))
    )
  }, [])

  const handleRemoveStep = useCallback((stepId: string) => {
    setEditedSteps((prev) => {
      const filtered = prev.filter((s) => s.id !== stepId)
      return filtered.map((s, i) => ({ ...s, order: i + 1 }))
    })
  }, [])

  const handleAddStep = useCallback(
    (type: WorkflowStepType) => {
      const meta = STEP_TYPE_META[type]
      const newStep: WorkflowStepConfig = {
        id: `step-${type}-${Date.now()}`,
        type,
        label: meta.label,
        required: false,
        order: editedSteps.length + 1,
        config: {},
      }
      setEditedSteps((prev) => [...prev, newStep])
      setAddStepOpen(false)
    },
    [editedSteps.length]
  )

  const handleSave = useCallback(async () => {
    if (!selectedCountType) return
    if (validationErrors.length > 0) {
      validationErrors.forEach((e) => toast.error(e))
      return
    }
    setIsSaving(true)
    try {
      await upsertConfig({
        count_type: selectedCountType,
        display_name: editedDisplayName,
        description: editedDescription || undefined,
        is_active: editedIsActive,
        steps: editedSteps,
      })
    } finally {
      setIsSaving(false)
    }
  }, [
    selectedCountType,
    validationErrors,
    editedSteps,
    editedDisplayName,
    editedDescription,
    editedIsActive,
    upsertConfig,
  ])

  const resetCreateDialogState = useCallback(() => {
    setNewCountType('')
    setNewCountTypeTouched(false)
    setNewDisplayName('')
    setNewDescription('')
  }, [])

  const openCreateDialog = useCallback(() => {
    resetCreateDialogState()
    setIsCreateOpen(true)
  }, [resetCreateDialogState])

  const handleApplyPreset = useCallback((preset: CountTypeOption) => {
    setNewCountType(preset.value)
    setNewCountTypeTouched(true)
    setNewDisplayName(preset.label)
    setNewDescription(preset.description ?? '')
  }, [])

  const handleNewDisplayNameChange = useCallback(
    (value: string) => {
      setNewDisplayName(value)
      if (!newCountTypeTouched) {
        setNewCountType(slugifyCountType(value))
      }
    },
    [newCountTypeTouched]
  )

  const handleNewCountTypeSlugChange = useCallback((value: string) => {
    setNewCountType(value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
    setNewCountTypeTouched(true)
  }, [])

  const handleCreateWorkflow = useCallback(async () => {
    const slug = newCountType.trim()
    const displayName = newDisplayName.trim()
    if (!slug || !displayName) {
      toast.error('Please provide a count type slug and display name.')
      return
    }
    if (countTypeValidationError) {
      toast.error(countTypeValidationError)
      return
    }
    setIsCreating(true)
    try {
      await upsertConfig({
        count_type: slug,
        display_name: displayName,
        description: newDescription.trim() || undefined,
        is_active: true,
        steps: buildDefaultSteps(),
      })
      setIsCreateOpen(false)
      setSelectedCountType(slug)
      // Seed the editor immediately so the user sees their new workflow
      // without waiting for the configs refetch to round-trip.
      setEditedSteps(buildDefaultSteps())
      setEditedDisplayName(displayName)
      setEditedDescription(newDescription.trim())
      setEditedIsActive(true)
      resetCreateDialogState()
    } finally {
      setIsCreating(false)
    }
  }, [
    newCountType,
    newDisplayName,
    newDescription,
    countTypeValidationError,
    upsertConfig,
    resetCreateDialogState,
  ])

  const handleReset = useCallback(async () => {
    if (!selectedCountType) return
    setIsResetting(true)
    try {
      await resetConfig(selectedCountType)
      setSelectedCountType(null)
      setEditedSteps([])
      setEditedDisplayName('')
      setEditedDescription('')
      setEditedIsActive(true)
    } finally {
      setIsResetting(false)
    }
  }, [selectedCountType, resetConfig])

  // ── Loading State ──

  if (isLoading) {
    return (
      <div className='flex flex-col items-center justify-center py-24'>
        <Loader2 className='text-primary h-10 w-10 animate-spin' />
        <p className='text-muted-foreground mt-4 text-sm'>
          Loading workflow configurations...
        </p>
      </div>
    )
  }

  // ── Main Render ──

  return (
    <div className='space-y-5'>
      {/* ── Domain Header + KPI Strip ── */}
      <Card className='gap-0 overflow-hidden p-0 shadow-sm'>
        <div className='flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex items-center gap-3'>
            <div className='from-primary/20 to-primary/5 rounded-xl bg-linear-to-br p-2.5'>
              <Workflow className='text-primary h-5 w-5' />
            </div>
            <div>
              <h2 className='text-foreground text-base font-semibold tracking-tight'>
                Count Workflow Settings
              </h2>
              <p className='text-muted-foreground text-xs'>
                Configure the step-by-step capture flow each operator follows
                per count type.
              </p>
            </div>
          </div>

          {selectedConfig && (
            <div className='flex flex-wrap items-center gap-2'>
              <Badge
                variant='outline'
                className='font-mono text-[10px] tracking-wider'
              >
                v{selectedConfig.version}
              </Badge>
              {hasUnsavedChanges ? (
                <Badge className='border-amber-300 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300'>
                  Unsaved changes
                </Badge>
              ) : (
                <Badge
                  variant='outline'
                  className='border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                >
                  In sync
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className='divide-border grid grid-cols-2 divide-y border-t lg:grid-cols-4 lg:divide-x lg:divide-y-0'>
          <StatCell
            label='Configured'
            value={stats.total}
            hint='workflow types'
            icon={Layers}
          />
          <StatCell
            label='Active'
            value={stats.active}
            hint={
              stats.total > 0
                ? `${Math.round((stats.active / stats.total) * 100)}% of fleet`
                : 'no workflows'
            }
            tone='positive'
            icon={CheckCircle2}
          />
          <StatCell
            label='Inactive'
            value={stats.inactive}
            hint={stats.inactive > 0 ? 'paused, not served to RF' : 'all live'}
            tone={stats.inactive > 0 ? 'warn' : 'muted'}
            icon={Eye}
          />
          <StatCell
            label='Avg Steps'
            value={stats.avgSteps}
            hint='per workflow'
            tone='muted'
            icon={Settings2}
          />
        </div>
      </Card>

      {/* ── Workbench ── */}
      <Card className='gap-0 overflow-hidden p-0 shadow-sm'>
        <div className='divide-border grid divide-y lg:grid-cols-[320px_1fr] lg:divide-x lg:divide-y-0'>
          {/* ── Sidebar ── */}
          <aside className='flex min-h-0 flex-col'>
            <div className='border-b px-4 py-3'>
              <div className='flex items-center gap-2'>
                <div className='relative flex-1'>
                  <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
                  <Input
                    placeholder='Search count types…'
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className='h-9 pl-8 text-sm'
                  />
                  {searchQuery && (
                    <button
                      type='button'
                      className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px]'
                      onClick={() => setSearchQuery('')}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <Button
                  size='sm'
                  onClick={openCreateDialog}
                  title='Create a new count workflow'
                  className='h-9 shrink-0 gap-1.5'
                >
                  <Plus className='h-3.5 w-3.5' />
                  New
                </Button>
              </div>

              {/* Status filter chips */}
              <div className='mt-2.5 flex items-center gap-1'>
                {(
                  [
                    { id: 'all', label: 'All', count: stats.total },
                    { id: 'active', label: 'Active', count: stats.active },
                    {
                      id: 'inactive',
                      label: 'Inactive',
                      count: stats.inactive,
                    },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type='button'
                    onClick={() => setStatusFilter(chip.id)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase transition-colors',
                      statusFilter === chip.id
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {chip.label}
                    <span className='text-muted-foreground/80 ml-1.5 font-mono'>
                      {chip.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className='min-h-0 flex-1 overflow-y-auto p-3'>
              {filteredConfigs.length === 0 ? (
                <div className='flex flex-col items-center justify-center rounded-xl border border-dashed py-10'>
                  <Package className='text-muted-foreground/30 h-9 w-9' />
                  <p className='text-muted-foreground mt-3 text-sm'>
                    {searchQuery || statusFilter !== 'all'
                      ? 'No matching count types'
                      : 'No workflow configurations yet'}
                  </p>
                  {(searchQuery || statusFilter !== 'all') && (
                    <button
                      type='button'
                      className='text-muted-foreground hover:text-foreground mt-2 text-[11px] underline-offset-2 hover:underline'
                      onClick={() => {
                        setSearchQuery('')
                        setStatusFilter('all')
                      }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                <ul className='space-y-1.5'>
                  {filteredConfigs.map((cfg) => {
                    const isSelected = selectedCountType === cfg.count_type
                    return (
                      <li key={cfg.count_type}>
                        <button
                          onClick={() => loadConfigIntoEditor(cfg.count_type)}
                          className={cn(
                            'group relative w-full rounded-lg border px-3 py-2.5 text-left transition-all',
                            isSelected
                              ? 'border-primary/50 bg-primary/5 shadow-sm'
                              : 'hover:border-border hover:bg-accent/40 border-transparent'
                          )}
                        >
                          {isSelected && (
                            <span
                              aria-hidden
                              className='bg-primary absolute inset-y-2 left-0 w-0.5 rounded-r'
                            />
                          )}
                          <div className='flex items-center justify-between gap-2'>
                            <div className='min-w-0 flex-1'>
                              <p
                                className={cn(
                                  'truncate text-sm font-medium',
                                  isSelected
                                    ? 'text-foreground'
                                    : 'text-foreground/90'
                                )}
                              >
                                {cfg.display_name}
                              </p>
                              <div className='mt-1 flex items-center gap-1.5'>
                                <code className='text-muted-foreground bg-muted/60 rounded px-1 py-px font-mono text-[10px]'>
                                  {cfg.count_type}
                                </code>
                                <span className='text-muted-foreground text-[10px]'>
                                  ·
                                </span>
                                <span className='text-muted-foreground text-[10px]'>
                                  {cfg.steps.length} step
                                  {cfg.steps.length !== 1 && 's'}
                                </span>
                              </div>
                            </div>
                            <div className='flex shrink-0 items-center gap-1'>
                              <span
                                title={cfg.is_active ? 'Active' : 'Inactive'}
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full',
                                  cfg.is_active
                                    ? 'bg-emerald-500'
                                    : 'bg-muted-foreground/30'
                                )}
                              />
                              <ChevronRight
                                className={cn(
                                  'h-3.5 w-3.5 transition-transform',
                                  isSelected
                                    ? 'text-primary translate-x-0'
                                    : 'text-muted-foreground/40 group-hover:translate-x-0.5'
                                )}
                              />
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* ── Editor ── */}
          <section className='flex min-h-0 min-w-0 flex-col'>
            {!selectedConfig ? (
              <EmptyEditorState />
            ) : (
              <>
                {/* Editor toolbar */}
                <div className='bg-background/60 supports-backdrop-filter:bg-background/40 sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b px-5 py-3 backdrop-blur'>
                  <div className='flex min-w-0 items-center gap-2.5'>
                    <div
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1',
                        editedIsActive
                          ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground ring-border'
                      )}
                    >
                      <Workflow className='h-4 w-4' />
                    </div>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-semibold'>
                        {editedDisplayName || selectedConfig.display_name}
                      </p>
                      <p className='text-muted-foreground truncate text-[11px]'>
                        <code className='font-mono'>
                          {selectedConfig.count_type}
                        </code>
                        {' · '}v{selectedConfig.version}
                      </p>
                    </div>
                  </div>

                  <div className='ml-auto flex flex-wrap items-center gap-2'>
                    {/* Validation pill */}
                    <div
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                        validationErrors.length === 0
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                      )}
                      title={
                        validationErrors.length > 0
                          ? validationErrors.join('\n')
                          : 'All validations passing'
                      }
                    >
                      {validationErrors.length === 0 ? (
                        <CheckCircle2 className='h-3.5 w-3.5' />
                      ) : (
                        <AlertTriangle className='h-3.5 w-3.5' />
                      )}
                      {validationErrors.length === 0
                        ? 'Valid'
                        : `${validationErrors.length} issue${validationErrors.length === 1 ? '' : 's'}`}
                    </div>

                    {/* Active toggle */}
                    <div className='border-border bg-card flex items-center gap-2 rounded-full border px-2.5 py-1'>
                      <Label
                        htmlFor='active-toggle'
                        className='text-muted-foreground text-[11px] font-medium'
                      >
                        {editedIsActive ? 'Active' : 'Inactive'}
                      </Label>
                      <Switch
                        id='active-toggle'
                        checked={editedIsActive}
                        onCheckedChange={setEditedIsActive}
                      />
                    </div>

                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleReset}
                      disabled={isResetting || isSaving}
                      className='gap-1.5'
                    >
                      {isResetting ? (
                        <Loader2 className='h-3.5 w-3.5 animate-spin' />
                      ) : (
                        <RotateCcw className='h-3.5 w-3.5' />
                      )}
                      Reset
                    </Button>
                    <Button
                      size='sm'
                      onClick={handleSave}
                      disabled={
                        isSaving ||
                        isResetting ||
                        !hasUnsavedChanges ||
                        validationErrors.length > 0
                      }
                      className='gap-1.5'
                    >
                      {isSaving ? (
                        <Loader2 className='h-3.5 w-3.5 animate-spin' />
                      ) : (
                        <Save className='h-3.5 w-3.5' />
                      )}
                      Save
                    </Button>
                  </div>
                </div>

                {/* Validation issues banner */}
                {validationErrors.length > 0 && (
                  <div className='border-b border-amber-200/70 bg-amber-50/70 px-5 py-2.5 dark:border-amber-800/40 dark:bg-amber-950/30'>
                    <ul className='space-y-0.5'>
                      {validationErrors.map((err) => (
                        <li
                          key={err}
                          className='flex items-start gap-2 text-[12px] text-amber-800 dark:text-amber-200'
                        >
                          <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
                          <span>{err}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Body */}
                <div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5'>
                  {/* ── Identity & Metadata ── */}
                  <section className='space-y-3'>
                    <div className='flex items-center gap-2'>
                      <h3 className='text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase'>
                        Identity
                      </h3>
                      <span className='bg-border h-px flex-1' />
                    </div>
                    <div className='grid gap-3 sm:grid-cols-2'>
                      <div className='space-y-1.5'>
                        <Label
                          htmlFor='display-name'
                          className='text-xs font-medium'
                        >
                          Display Name
                        </Label>
                        <Input
                          id='display-name'
                          value={editedDisplayName}
                          onChange={(e) => setEditedDisplayName(e.target.value)}
                        />
                      </div>
                      <div className='space-y-1.5'>
                        <Label className='text-xs font-medium'>
                          Count Type Slug
                        </Label>
                        <Input
                          value={selectedConfig.count_type}
                          readOnly
                          className='bg-muted/60 cursor-not-allowed font-mono text-sm'
                        />
                      </div>
                    </div>
                    <div className='space-y-1.5'>
                      <Label
                        htmlFor='description'
                        className='text-xs font-medium'
                      >
                        Description
                      </Label>
                      <Textarea
                        id='description'
                        value={editedDescription}
                        onChange={(e) => setEditedDescription(e.target.value)}
                        rows={2}
                        placeholder='Brief description of this count type workflow…'
                      />
                    </div>
                  </section>

                  {/* ── Steps ── */}
                  <section className='space-y-3'>
                    <div className='flex items-center justify-between gap-3'>
                      <div className='flex items-center gap-2'>
                        <h3 className='text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase'>
                          Workflow Steps
                        </h3>
                        <Badge
                          variant='secondary'
                          className='rounded-full px-2 font-mono text-[10px]'
                        >
                          {editedSteps.length}
                        </Badge>
                      </div>

                      <div className='relative'>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => setAddStepOpen(!addStepOpen)}
                          disabled={availableStepTypes.length === 0}
                          className='gap-1.5'
                        >
                          <Plus className='h-3.5 w-3.5' />
                          Add Step
                        </Button>

                        {addStepOpen && (
                          <>
                            <div
                              className='fixed inset-0 z-40'
                              onClick={() => setAddStepOpen(false)}
                            />
                            <div className='bg-popover absolute top-full right-0 z-50 mt-2 w-80 rounded-xl border p-2 shadow-xl'>
                              <p className='text-muted-foreground px-2 pb-2 text-xs font-medium'>
                                Step Library
                              </p>
                              <Separator className='mb-2' />
                              <div className='max-h-72 space-y-0.5 overflow-y-auto'>
                                {availableStepTypes.map((type) => {
                                  const meta = STEP_TYPE_META[type]
                                  const Icon = meta.icon
                                  return (
                                    <button
                                      key={type}
                                      className='hover:bg-accent flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors'
                                      onClick={() => handleAddStep(type)}
                                    >
                                      <div
                                        className={cn(
                                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                                          meta.color
                                        )}
                                      >
                                        <Icon className='h-4 w-4' />
                                      </div>
                                      <div className='min-w-0 flex-1'>
                                        <p className='text-sm font-medium'>
                                          {meta.label}
                                        </p>
                                        <p className='text-muted-foreground truncate text-[11px]'>
                                          {meta.description}
                                        </p>
                                      </div>
                                      {!meta.singleton && (
                                        <Badge
                                          variant='outline'
                                          className='shrink-0 text-[10px]'
                                        >
                                          multi
                                        </Badge>
                                      )}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {editedSteps.length === 0 ? (
                      <div className='flex flex-col items-center justify-center rounded-xl border border-dashed py-12'>
                        <Plus className='text-muted-foreground/30 h-8 w-8' />
                        <p className='text-muted-foreground mt-3 text-sm'>
                          No steps configured. Click{' '}
                          <span className='font-medium'>“Add Step”</span> to
                          start building this workflow.
                        </p>
                      </div>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                      >
                        <SortableContext
                          items={editedSteps.map((s) => s.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className='space-y-2'>
                            {editedSteps.map((step, i) => (
                              <SortableStepCard
                                key={step.id}
                                step={step}
                                index={i}
                                onToggleRequired={handleToggleRequired}
                                onRemove={handleRemoveStep}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    )}
                  </section>
                </div>
              </>
            )}
          </section>
        </div>
      </Card>

      {/* ── Create Workflow Dialog ── */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open)
          if (!open) resetCreateDialogState()
        }}
      >
        <DialogContent className='sm:max-w-[520px]'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <Workflow className='text-primary h-5 w-5' />
              New Count Workflow
            </DialogTitle>
            <DialogDescription>
              Pick a preset or define a custom count type. You can refine the
              steps after it's created.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-5 py-2'>
            {availablePresetOptions.length > 0 && (
              <div className='space-y-2'>
                <Label className='text-xs font-medium'>
                  Start from a preset{' '}
                  <span className='text-muted-foreground font-normal'>
                    (optional)
                  </span>
                </Label>
                <div className='flex flex-wrap gap-1.5'>
                  {availablePresetOptions.map((preset) => {
                    const isActive = newCountType === preset.value
                    return (
                      <button
                        key={preset.value}
                        type='button'
                        onClick={() => handleApplyPreset(preset)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                          isActive
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-background hover:bg-muted'
                        )}
                        title={preset.description}
                      >
                        {preset.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className='space-y-1.5'>
              <Label htmlFor='new-display-name' className='text-xs font-medium'>
                Display Name
              </Label>
              <Input
                id='new-display-name'
                value={newDisplayName}
                onChange={(e) => handleNewDisplayNameChange(e.target.value)}
                placeholder='e.g. Daily Bin Sweep'
                autoFocus
              />
              <p className='text-muted-foreground text-[11px]'>
                The friendly name shown to operators in the count list.
              </p>
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='new-count-type' className='text-xs font-medium'>
                Count Type Slug
              </Label>
              <Input
                id='new-count-type'
                value={newCountType}
                onChange={(e) => handleNewCountTypeSlugChange(e.target.value)}
                placeholder='daily_bin_sweep'
                className={cn(
                  'font-mono text-sm',
                  countTypeValidationError && 'border-destructive'
                )}
              />
              <p
                className={cn(
                  'text-[11px]',
                  countTypeValidationError
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                )}
              >
                {countTypeValidationError ??
                  'Lowercase letters, numbers, and underscores. This is the stable identifier stored with every count.'}
              </p>
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='new-description' className='text-xs font-medium'>
                Description{' '}
                <span className='text-muted-foreground font-normal'>
                  (optional)
                </span>
              </Label>
              <Textarea
                id='new-description'
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                placeholder='Brief description of this count workflow...'
              />
            </div>

            <div className='bg-muted/50 rounded-lg p-3 text-xs'>
              <p className='text-foreground font-medium'>Starter steps</p>
              <p className='text-muted-foreground mt-0.5'>
                Confirm &rarr; Location Scan &rarr; Quantity Entry. Customize
                the full workflow after creation.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setIsCreateOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateWorkflow}
              disabled={
                isCreating ||
                !newCountType.trim() ||
                !newDisplayName.trim() ||
                !!countTypeValidationError
              }
              className='gap-2'
            >
              {isCreating ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Plus className='h-4 w-4' />
              )}
              Create Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Empty editor state ──────────────────────────────────────────────────────

function EmptyEditorState() {
  return (
    <div className='flex flex-1 flex-col items-center justify-center px-6 py-20 text-center'>
      <div className='from-primary/15 to-primary/0 ring-border rounded-2xl bg-linear-to-br p-5 ring-1'>
        <Settings2 className='text-primary/70 h-10 w-10' />
      </div>
      <p className='text-foreground mt-5 text-sm font-medium'>
        Select a count type to configure
      </p>
      <p className='text-muted-foreground mt-1.5 max-w-sm text-xs'>
        Choose a workflow from the list on the left to view, reorder its steps,
        toggle required fields, and publish a new version.
      </p>
      <div className='text-muted-foreground/70 mt-6 flex items-center gap-1.5 text-[11px]'>
        <Card
          className='inline-flex h-6 items-center gap-1 rounded-md border px-1.5 py-0 shadow-none'
          aria-hidden
        >
          <kbd className='font-mono text-[10px]'>↑ ↓</kbd>
        </Card>
        <span>navigate</span>
        <span className='text-border'>·</span>
        <Card
          className='inline-flex h-6 items-center gap-1 rounded-md border px-1.5 py-0 shadow-none'
          aria-hidden
        >
          <kbd className='font-mono text-[10px]'>Enter</kbd>
        </Card>
        <span>open</span>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
