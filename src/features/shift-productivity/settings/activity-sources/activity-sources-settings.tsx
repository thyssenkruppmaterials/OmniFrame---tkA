/**
 * Activity Sources Configuration Tab
 * Manage dynamic activity tracking sources for timeline display
 * Created: January 4, 2026
 *
 * This component allows administrators to configure which database tables
 * contribute to the activity timeline without requiring code changes.
 */
import { useEffect, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Database,
  Edit,
  HelpCircle,
  Info,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Zap,
} from 'lucide-react'
import ActivitySourceConfigService, {
  type ActivitySourceConfig,
  type TableColumn,
} from '@/lib/supabase/activity-source-config.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useActivitySourceConfig } from '@/hooks/use-activity-source-config'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
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
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import ContentSection from '../components/content-section'

// ===== ACTIVITY SOURCE SCHEMA =====
const activitySourceSchema = z.object({
  activity_type: z
    .string()
    .min(2, 'Activity type must be at least 2 characters')
    .max(100, 'Activity type must be less than 100 characters')
    .regex(
      /^[a-z_]+$/,
      'Activity type must be lowercase letters and underscores only'
    ),
  activity_label: z
    .string()
    .min(2, 'Activity label must be at least 2 characters')
    .max(200, 'Activity label must be less than 200 characters'),
  activity_description: z.string().optional(),
  source_table: z.string().min(1, 'Source table is required'),
  user_id_column: z.string().min(1, 'User ID column is required'),
  timestamp_column: z.string().min(1, 'Timestamp column is required'),
  organization_id_column: z.string().optional(),
  area_column: z.string().optional(),
  area_fallback: z.string().optional(),
  count_enabled: z.boolean().default(true),
  display_color: z.string().min(1, 'Display color is required'),
  display_order: z.coerce.number().int().min(0).max(1000).default(100),
  activity_category: z.string().default('work'),
  department: z.string().optional(),
  is_active: z.boolean().default(true),
})

type ActivitySourceFormData = z.infer<typeof activitySourceSchema>

export function ActivitySourcesSettings() {
  const {
    activitySources,
    activitySourcesLoading,
    activitySourcesError,
    createActivitySource,
    updateActivitySource,
    deleteActivitySource,
    toggleActivitySourceActive,
    availableTables,
    getTableColumns,
    validateTableConfig,
    activityCategories,
    presetColors,
    refreshActivitySources,
  } = useActivitySourceConfig()

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editingSource, setEditingSource] =
    useState<ActivitySourceConfig | null>(null)
  const [deletingSource, setDeletingSource] =
    useState<ActivitySourceConfig | null>(null)
  const [showSystemSources, setShowSystemSources] = useState(false)

  // Separate system and custom sources
  const systemSources = activitySources.filter((s) => s.is_system)
  const customSources = activitySources.filter((s) => !s.is_system)

  return (
    <ContentSection
      title='Activity Sources'
      desc='Configure which database tables contribute to the activity timeline. Add new activity types as your operations grow without code changes.'
    >
      <TooltipProvider>
        <div className='space-y-6'>
          {/* Header Actions */}
          <div className='flex items-center justify-end gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={refreshActivitySources}
              disabled={activitySourcesLoading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${activitySourcesLoading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
            <Button
              onClick={() => {
                setEditingSource(null)
                setAddDialogOpen(true)
              }}
            >
              <Plus className='mr-2 h-4 w-4' />
              Add Activity Source
            </Button>
          </div>

          {/* Info Banner */}
          <Alert className='border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30'>
            <Zap className='h-4 w-4 text-blue-600 dark:text-blue-400' />
            <AlertDescription className='text-blue-700 dark:text-blue-300'>
              <strong className='text-blue-800 dark:text-blue-200'>
                Dynamic Configuration:
              </strong>{' '}
              Activity sources define how worker activities are tracked on the
              timeline. Point to any database table with a user ID and timestamp
              column to start tracking new activity types immediately.
            </AlertDescription>
          </Alert>

          {activitySourcesError && (
            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertDescription>{activitySourcesError}</AlertDescription>
            </Alert>
          )}

          {/* Custom Activity Sources */}
          <Card>
            <CardHeader>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <div className='bg-primary/10 rounded-lg p-2'>
                    <Settings2 className='text-primary h-5 w-5' />
                  </div>
                  <div>
                    <CardTitle>Custom Activity Sources</CardTitle>
                    <CardDescription>
                      Activity sources you've configured for your organization
                    </CardDescription>
                  </div>
                </div>
                <Badge variant='outline'>
                  {customSources.length} configured
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {activitySourcesLoading ? (
                <div className='flex items-center justify-center py-8'>
                  <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
                </div>
              ) : customSources.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-12 text-center'>
                  <Database className='text-muted-foreground mb-4 h-12 w-12' />
                  <h4 className='mb-2 text-lg font-semibold'>
                    No Custom Activity Sources
                  </h4>
                  <p className='text-muted-foreground mb-4 max-w-md text-sm'>
                    Create custom activity sources to track additional work
                    activities from your database tables on the employee
                    timeline.
                  </p>
                  <Button
                    onClick={() => {
                      setEditingSource(null)
                      setAddDialogOpen(true)
                    }}
                  >
                    <Plus className='mr-2 h-4 w-4' />
                    Add Your First Activity Source
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Activity Type</TableHead>
                      <TableHead>Source Table</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Color</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className='w-[70px]'>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customSources.map((source) => (
                      <TableRow key={source.id}>
                        <TableCell>
                          <div>
                            <div className='font-medium'>
                              {source.activity_label}
                            </div>
                            <div className='text-muted-foreground font-mono text-xs'>
                              {source.activity_type}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className='font-mono text-sm'>
                            {source.source_table}
                          </div>
                          <div className='text-muted-foreground text-xs'>
                            {source.user_id_column} → {source.timestamp_column}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant='secondary' className='capitalize'>
                            {source.activity_category}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className='flex items-center gap-2'>
                            <div
                              className='h-6 w-6 rounded border'
                              style={{
                                backgroundColor: getColorValue(
                                  source.display_color
                                ),
                              }}
                            />
                            <span className='font-mono text-xs'>
                              {source.display_color}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant='outline'>
                            {source.display_order}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={source.is_active}
                            onCheckedChange={(checked) =>
                              toggleActivitySourceActive(source.id, checked)
                            }
                            aria-label={`Toggle ${source.activity_label} active`}
                          />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant='ghost' size='sm'>
                                <MoreHorizontal className='h-4 w-4' />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end'>
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingSource(source)
                                  setAddDialogOpen(true)
                                }}
                              >
                                <Edit className='mr-2 h-4 w-4' />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeletingSource(source)}
                                className='text-destructive'
                              >
                                <Trash2 className='mr-2 h-4 w-4' />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* System Activity Sources (Collapsible) */}
          <Collapsible
            open={showSystemSources}
            onOpenChange={setShowSystemSources}
          >
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className='hover:bg-muted/50 cursor-pointer transition-colors'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-3'>
                      <div className='rounded-lg bg-amber-500/10 p-2'>
                        <Database className='h-5 w-5 text-amber-500' />
                      </div>
                      <div>
                        <CardTitle className='flex items-center gap-2'>
                          System Activity Sources
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${showSystemSources ? 'rotate-180' : ''}`}
                          />
                        </CardTitle>
                        <CardDescription>
                          Built-in activity sources configured by the system
                          (read-only)
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant='secondary'>
                      {systemSources.length} sources
                    </Badge>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className='pt-0'>
                  {systemSources.length === 0 ? (
                    <div className='text-muted-foreground py-8 text-center'>
                      No system activity sources configured.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Activity Type</TableHead>
                          <TableHead>Source Table</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Color</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {systemSources.map((source) => (
                          <TableRow key={source.id} className='bg-muted/30'>
                            <TableCell>
                              <div>
                                <div className='flex items-center gap-2 font-medium'>
                                  {source.activity_label}
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Badge
                                        variant='outline'
                                        className='text-xs'
                                      >
                                        System
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      System sources cannot be modified or
                                      deleted
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                                <div className='text-muted-foreground font-mono text-xs'>
                                  {source.activity_type}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className='font-mono text-sm'>
                                {source.source_table}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant='secondary' className='capitalize'>
                                {source.activity_category}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className='flex items-center gap-2'>
                                <div
                                  className='h-6 w-6 rounded border'
                                  style={{
                                    backgroundColor: getColorValue(
                                      source.display_color
                                    ),
                                  }}
                                />
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  source.is_active ? 'default' : 'secondary'
                                }
                              >
                                {source.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Available Tables Reference */}
          <Card>
            <CardHeader>
              <div className='flex items-center gap-3'>
                <div className='rounded-lg bg-green-500/10 p-2'>
                  <HelpCircle className='h-5 w-5 text-green-500' />
                </div>
                <div>
                  <CardTitle>Available Database Tables</CardTitle>
                  <CardDescription>
                    Tables that can be used as activity sources. Select one when
                    creating a new activity source.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
                {availableTables.map((table) => (
                  <div
                    key={table.table_name}
                    className='bg-muted/30 hover:bg-muted/50 rounded-lg border p-4 transition-colors'
                  >
                    <div className='mb-2 font-mono text-sm font-medium'>
                      {table.table_name}
                    </div>
                    <div className='space-y-1'>
                      {table.columns.slice(0, 4).map((col) => (
                        <div
                          key={col.column_name}
                          className='text-muted-foreground flex items-center gap-2 text-xs'
                        >
                          <span className='font-mono'>{col.column_name}</span>
                          <span className='text-muted-foreground/60'>
                            ({col.data_type})
                          </span>
                        </div>
                      ))}
                      {table.columns.length > 4 && (
                        <div className='text-muted-foreground text-xs'>
                          +{table.columns.length - 4} more columns
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Add/Edit Dialog */}
          <ActivitySourceFormDialog
            open={addDialogOpen}
            onOpenChange={setAddDialogOpen}
            editingSource={editingSource}
            availableTables={availableTables}
            activityCategories={activityCategories}
            presetColors={presetColors}
            getTableColumns={getTableColumns}
            validateTableConfig={validateTableConfig}
            onCreate={createActivitySource as any} // eslint-disable-line @typescript-eslint/no-explicit-any -- CreateActivitySourceInput is a superset of Record<string, unknown>
            onUpdate={updateActivitySource as any} // eslint-disable-line @typescript-eslint/no-explicit-any -- UpdateActivitySourceInput is a superset of Record<string, unknown>
          />

          {/* Delete Dialog */}
          <DeleteActivitySourceDialog
            open={!!deletingSource}
            onOpenChange={(open) => !open && setDeletingSource(null)}
            source={deletingSource}
            onDelete={deleteActivitySource}
          />
        </div>
      </TooltipProvider>
    </ContentSection>
  )
}

// ===== HELPER FUNCTIONS =====

function getColorValue(colorName: string): string {
  // Map Tailwind color names to hex values
  const colorMap: Record<string, string> = {
    'sky-500': '#0ea5e9',
    'violet-500': '#8b5cf6',
    'emerald-500': '#10b981',
    'orange-500': '#f97316',
    'cyan-500': '#06b6d4',
    'amber-500': '#f59e0b',
    'rose-500': '#f43f5e',
    'indigo-500': '#6366f1',
    'teal-500': '#14b8a6',
    'pink-500': '#ec4899',
    'lime-500': '#84cc16',
    'purple-500': '#a855f7',
    'blue-500': '#3b82f6',
    'green-500': '#22c55e',
    'red-500': '#ef4444',
    'yellow-500': '#eab308',
  }
  return colorMap[colorName] || colorName
}

// ===== FORM DIALOG =====

interface ActivitySourceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingSource: ActivitySourceConfig | null
  availableTables: { table_name: string; columns: TableColumn[] }[]
  activityCategories: { value: string; label: string }[]
  presetColors: { value: string; label: string; tailwind: string }[]
  getTableColumns: (tableName: string) => Promise<TableColumn[]>
  validateTableConfig: (
    tableName: string,
    userIdColumn: string,
    timestampColumn: string,
    organizationIdColumn?: string
  ) => Promise<{ valid: boolean; errors: string[]; warnings: string[] }>
  onCreate: (data: Record<string, unknown>) => Promise<Record<string, unknown>>
  onUpdate: (
    id: string,
    updates: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
}

function ActivitySourceFormDialog({
  open,
  onOpenChange,
  editingSource,
  availableTables,
  activityCategories,
  presetColors,
  getTableColumns,
  validateTableConfig,
  onCreate,
  onUpdate,
}: ActivitySourceFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [selectedTableColumns, setSelectedTableColumns] = useState<
    TableColumn[]
  >([])
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [isLoadingTables, setIsLoadingTables] = useState(false)
  const [tableSearchOpen, setTableSearchOpen] = useState(false)
  const [dynamicTables, setDynamicTables] = useState<
    { table_name: string; columns: TableColumn[] }[]
  >([])

  const form = useForm<ActivitySourceFormData>({
    resolver: zodResolver(activitySourceSchema),
    defaultValues: {
      activity_type: '',
      activity_label: '',
      activity_description: '',
      source_table: '',
      user_id_column: '',
      timestamp_column: '',
      organization_id_column: '',
      area_column: '',
      area_fallback: 'Other',
      count_enabled: true,
      display_color: 'sky-500',
      display_order: 100,
      activity_category: 'work',
      department: '',
      is_active: true,
    },
  })

  const selectedTable = form.watch('source_table')

  // Load tables from Supabase when dialog opens
  useEffect(() => {
    if (open) {
      setIsLoadingTables(true)
      ActivitySourceConfigService.getAvailableTables()
        .then((tables) => {
          setDynamicTables(tables)
        })
        .catch((error) => {
          logger.error('Error loading tables:', error)
          setDynamicTables(availableTables)
        })
        .finally(() => {
          setIsLoadingTables(false)
        })
    }
  }, [open, availableTables])

  // Update form when editing source changes
  useEffect(() => {
    if (editingSource) {
      form.reset({
        activity_type: editingSource.activity_type,
        activity_label: editingSource.activity_label,
        activity_description: editingSource.activity_description || '',
        source_table: editingSource.source_table,
        user_id_column: editingSource.user_id_column,
        timestamp_column: editingSource.timestamp_column,
        organization_id_column: editingSource.organization_id_column || '',
        area_column: editingSource.area_column || '',
        area_fallback: editingSource.area_fallback || 'Other',
        count_enabled: editingSource.count_enabled,
        display_color: editingSource.display_color,
        display_order: editingSource.display_order,
        activity_category: editingSource.activity_category,
        department: editingSource.department || '',
        is_active: editingSource.is_active,
      })
      // Load columns for editing source's table
      if (editingSource.source_table) {
        loadColumnsForTable(editingSource.source_table)
      }
    } else {
      form.reset({
        activity_type: '',
        activity_label: '',
        activity_description: '',
        source_table: '',
        user_id_column: '',
        timestamp_column: '',
        organization_id_column: '',
        area_column: '',
        area_fallback: 'Other',
        count_enabled: true,
        display_color: 'sky-500',
        display_order: 100,
        activity_category: 'work',
        department: '',
        is_active: true,
      })
    }
    setValidationErrors([])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadColumnsForTable is an async helper defined below; adding it would cause render loops
  }, [editingSource, form])

  // Load columns when table changes
  const loadColumnsForTable = async (tableName: string) => {
    if (!tableName) {
      setSelectedTableColumns([])
      return
    }

    setIsLoadingColumns(true)
    try {
      const columns = await getTableColumns(tableName)
      if (columns.length > 0) {
        setSelectedTableColumns(columns)
      } else {
        // Try to find from dynamic tables
        const tableInfo = dynamicTables.find((t) => t.table_name === tableName)
        if (tableInfo) {
          setSelectedTableColumns(tableInfo.columns)
        }
      }
    } finally {
      setIsLoadingColumns(false)
    }
  }

  useEffect(() => {
    if (selectedTable && !editingSource) {
      loadColumnsForTable(selectedTable)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadColumnsForTable is an async helper; editingSource used only as guard condition
  }, [selectedTable])

  const [validationWarnings, setValidationWarnings] = useState<string[]>([])

  const onSubmit = async (data: ActivitySourceFormData) => {
    try {
      setIsSubmitting(true)
      setValidationErrors([])
      setValidationWarnings([])

      // Validate table configuration
      const validation = await validateTableConfig(
        data.source_table,
        data.user_id_column,
        data.timestamp_column,
        data.organization_id_column || ''
      )

      if (!validation.valid) {
        setValidationErrors(validation.errors)
        return
      }

      // Show warnings but allow submission
      if (validation.warnings && validation.warnings.length > 0) {
        setValidationWarnings(validation.warnings)
      }

      if (editingSource) {
        await onUpdate(editingSource.id, data)
      } else {
        await onCreate(data)
      }

      form.reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Error saving activity source:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const uuidColumns = selectedTableColumns.filter(
    (c) =>
      c.data_type === 'uuid' ||
      c.column_name.includes('_by') ||
      c.column_name.includes('_id')
  )
  const timestampColumns = selectedTableColumns.filter(
    (c) =>
      c.data_type.includes('timestamp') ||
      c.column_name.includes('_at') ||
      c.column_name.includes('date')
  )

  const selectedTableInfo = form.watch('source_table')
    ? dynamicTables.find((t) => t.table_name === form.watch('source_table'))
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1200px] min-w-[900px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle className='text-xl'>
            {editingSource ? 'Edit Activity Source' : 'Add Activity Source'}
          </DialogTitle>
          <DialogDescription>
            {editingSource
              ? 'Update the activity source configuration for timeline tracking.'
              : 'Configure a new database table as an activity source. This will appear on the employee timeline.'}
          </DialogDescription>
        </DialogHeader>

        {validationErrors.length > 0 && (
          <Alert variant='destructive'>
            <AlertTriangle className='h-4 w-4' />
            <AlertDescription>
              <ul className='list-disc space-y-1 pl-4'>
                {validationErrors.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {validationWarnings.length > 0 && (
          <Alert
            variant='default'
            className='border-amber-500/50 bg-amber-500/10'
          >
            <Info className='h-4 w-4 text-amber-500' />
            <AlertDescription className='text-amber-700 dark:text-amber-400'>
              <ul className='list-disc space-y-1 pl-4'>
                {validationWarnings.map((warning, idx) => (
                  <li key={idx}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
            {/* Activity Identification */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Activity Identification
              </h4>

              <div className='grid grid-cols-3 gap-6'>
                <FormField
                  control={form.control}
                  name='activity_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Activity Type *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder='e.g., quality_check'
                          className='font-mono'
                          {...field}
                          disabled={!!editingSource}
                        />
                      </FormControl>
                      <FormDescription>
                        Unique ID (lowercase, underscores)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='activity_label'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Label *</FormLabel>
                      <FormControl>
                        <Input placeholder='e.g., Quality Check' {...field} />
                      </FormControl>
                      <FormDescription>
                        Human-readable name for UI
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='activity_category'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select category' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {activityCategories.map((cat) => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {cat.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Activity classification</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name='activity_description'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='Describe what this activity tracks and when it occurs...'
                        className='h-20 resize-none'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Data Source Configuration */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Data Source Configuration
              </h4>

              <div className='grid grid-cols-2 gap-6'>
                <FormField
                  control={form.control}
                  name='source_table'
                  render={({ field }) => (
                    <FormItem className='flex flex-col'>
                      <FormLabel>Source Table *</FormLabel>
                      <Popover
                        open={tableSearchOpen}
                        onOpenChange={setTableSearchOpen}
                      >
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant='outline'
                              role='combobox'
                              className={cn(
                                'w-full justify-between font-mono',
                                !field.value && 'text-muted-foreground'
                              )}
                              disabled={!!editingSource || isLoadingTables}
                            >
                              {isLoadingTables ? (
                                <span className='flex items-center gap-2'>
                                  <Loader2 className='h-4 w-4 animate-spin' />
                                  Loading tables...
                                </span>
                              ) : field.value ? (
                                field.value
                              ) : (
                                'Select a database table...'
                              )}
                              <Database className='ml-2 h-4 w-4 shrink-0 opacity-50' />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className='w-[500px] p-0' align='start'>
                          <Command>
                            <CommandInput placeholder='Search tables...' />
                            <CommandEmpty>No tables found.</CommandEmpty>
                            <CommandGroup className='max-h-64 overflow-y-auto'>
                              {dynamicTables.map((table) => (
                                <CommandItem
                                  key={table.table_name}
                                  onSelect={() => {
                                    field.onChange(table.table_name)
                                    setTableSearchOpen(false)
                                  }}
                                  className='flex flex-col items-start py-3'
                                >
                                  <span className='font-mono font-medium'>
                                    {table.table_name}
                                  </span>
                                  <span className='text-muted-foreground text-xs'>
                                    {table.columns.length} columns
                                    {table.columns
                                      .slice(0, 3)
                                      .map((c) => c.column_name)
                                      .join(', ')}
                                    {table.columns.length > 3 && '...'}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <FormDescription>
                        Database table containing activity events
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Table preview */}
                {selectedTableInfo && (
                  <div className='bg-muted/50 space-y-2 rounded-lg p-4'>
                    <div className='flex items-center gap-2 text-sm font-medium'>
                      <Database className='h-4 w-4' />
                      <span>Table Preview</span>
                    </div>
                    <div className='max-h-32 space-y-1 overflow-y-auto text-xs'>
                      {selectedTableInfo.columns.slice(0, 8).map((col) => (
                        <div
                          key={col.column_name}
                          className='flex justify-between'
                        >
                          <span className='font-mono'>{col.column_name}</span>
                          <span className='text-muted-foreground'>
                            {col.data_type}
                          </span>
                        </div>
                      ))}
                      {selectedTableInfo.columns.length > 8 && (
                        <div className='text-muted-foreground'>
                          +{selectedTableInfo.columns.length - 8} more columns
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {isLoadingColumns && (
                <div className='text-muted-foreground flex items-center gap-2 py-2 text-sm'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Loading table columns...
                </div>
              )}

              {selectedTableColumns.length > 0 && (
                <div className='grid grid-cols-2 gap-6'>
                  <FormField
                    control={form.control}
                    name='user_id_column'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>User ID Column *</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder='Select column' />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {uuidColumns.map((col) => (
                              <SelectItem
                                key={col.column_name}
                                value={col.column_name}
                              >
                                <div className='flex items-center gap-2'>
                                  <span className='font-mono'>
                                    {col.column_name}
                                  </span>
                                  <span className='text-muted-foreground text-xs'>
                                    ({col.data_type})
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Column linking to user_profiles.id
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='timestamp_column'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Timestamp Column *</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder='Select column' />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {timestampColumns.map((col) => (
                              <SelectItem
                                key={col.column_name}
                                value={col.column_name}
                              >
                                <div className='flex items-center gap-2'>
                                  <span className='font-mono'>
                                    {col.column_name}
                                  </span>
                                  <span className='text-muted-foreground text-xs'>
                                    ({col.data_type})
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          When the activity occurred
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {selectedTableColumns.length > 0 && (
                <FormField
                  control={form.control}
                  name='organization_id_column'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Organization ID Column (Optional)</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value === '_none_' ? '' : value)
                        }}
                        value={field.value || '_none_'}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select column (optional)' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='_none_'>
                            <span className='text-muted-foreground'>
                              None (no org filtering)
                            </span>
                          </SelectItem>
                          {uuidColumns.map((col) => (
                            <SelectItem
                              key={col.column_name}
                              value={col.column_name}
                            >
                              <div className='flex items-center gap-2'>
                                <span className='font-mono'>
                                  {col.column_name}
                                </span>
                                <span className='text-muted-foreground text-xs'>
                                  ({col.data_type})
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Column for multi-tenant filtering. Leave empty if table
                        has no organization column.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <div className='grid grid-cols-2 gap-6'>
                <FormField
                  control={form.control}
                  name='area_column'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Area Column (Optional)</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value === '_none_' ? '' : value)
                        }}
                        value={field.value || '_none_'}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select column' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='_none_'>
                            — No Area Column —
                          </SelectItem>
                          {selectedTableColumns.map((col) => (
                            <SelectItem
                              key={col.column_name}
                              value={col.column_name}
                            >
                              <span className='font-mono'>
                                {col.column_name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Column for work area/location
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='area_fallback'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Area Fallback</FormLabel>
                      <FormControl>
                        <Input
                          placeholder='e.g., Warehouse, Other'
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Default area when column is null
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Display Configuration */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Display Configuration
              </h4>

              <div className='grid grid-cols-3 gap-6'>
                <FormField
                  control={form.control}
                  name='display_color'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timeline Color *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select color' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {presetColors.map((color) => (
                            <SelectItem key={color.value} value={color.value}>
                              <div className='flex items-center gap-3'>
                                <div
                                  className='h-5 w-5 rounded border'
                                  style={{
                                    backgroundColor: getColorValue(color.value),
                                  }}
                                />
                                <span>{color.label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Block color on timeline</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='display_order'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Order</FormLabel>
                      <FormControl>
                        <Input type='number' min='0' max='1000' {...field} />
                      </FormControl>
                      <FormDescription>
                        Sort order (lower = first)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Color preview */}
                <div className='bg-muted/50 space-y-2 rounded-lg p-4'>
                  <div className='text-sm font-medium'>Color Preview</div>
                  <div
                    className='flex h-8 items-center justify-center rounded text-sm font-medium text-white'
                    style={{
                      backgroundColor: getColorValue(
                        form.watch('display_color')
                      ),
                    }}
                  >
                    {form.watch('activity_label') || 'Activity Label'}
                  </div>
                </div>
              </div>

              <div className='grid grid-cols-2 gap-6'>
                <FormField
                  control={form.control}
                  name='count_enabled'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm'>
                      <div className='space-y-0.5'>
                        <FormLabel>Enable Counting</FormLabel>
                        <FormDescription>
                          Include in productivity counts and summaries
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='is_active'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm'>
                      <div className='space-y-0.5'>
                        <FormLabel>Active</FormLabel>
                        <FormDescription>
                          Track this activity on the timeline
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter className='gap-2 sm:gap-0'>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  form.reset()
                  onOpenChange(false)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                {editingSource
                  ? 'Update Activity Source'
                  : 'Create Activity Source'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ===== DELETE DIALOG =====

interface DeleteActivitySourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: ActivitySourceConfig | null
  onDelete: (id: string) => Promise<boolean>
}

function DeleteActivitySourceDialog({
  open,
  onOpenChange,
  source,
  onDelete,
}: DeleteActivitySourceDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!source) return

    try {
      setIsDeleting(true)
      const success = await onDelete(source.id)
      if (success) {
        onOpenChange(false)
      }
    } finally {
      setIsDeleting(false)
    }
  }

  if (!source) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Activity Source</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this activity source? This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>
            <strong>Warning:</strong> Deleting this activity source will stop
            tracking these activities on the timeline. Historical data will
            still exist in the source table but won't appear in reports.
          </AlertDescription>
        </Alert>

        <div className='space-y-2 rounded-lg border p-4'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Activity Type:</span>
            <span className='font-mono text-sm'>{source.activity_type}</span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Label:</span>
            <span className='text-sm'>{source.activity_label}</span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Source Table:</span>
            <span className='font-mono text-sm'>{source.source_table}</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Delete Activity Source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
