// Created and developed by Jai Singh
/**
 * Edit Labor Standard Dialog Component
 * Form modal for editing existing labor standards
 * Created: October 25, 2025
 * Updated: January 4, 2026 - Added dynamic activity linking display
 */
import { useEffect, useMemo, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, ChevronsUpDown, Info, Link2, Loader2 } from 'lucide-react'
import type { LaborStandard } from '@/lib/supabase/labor-management.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useActivityConfig } from '@/hooks/use-activity-config'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
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

// Helper function to convert Tailwind bg class to hex color
function getActivityColor(bgClass?: string): string {
  if (!bgClass) return '#6b7280' // gray-500 default

  const colorMap: Record<string, string> = {
    'bg-sky-500': '#0ea5e9',
    'bg-violet-500': '#8b5cf6',
    'bg-emerald-500': '#10b981',
    'bg-orange-500': '#f97316',
    'bg-cyan-500': '#06b6d4',
    'bg-amber-500': '#f59e0b',
    'bg-rose-500': '#f43f5e',
    'bg-indigo-500': '#6366f1',
    'bg-teal-500': '#14b8a6',
    'bg-pink-500': '#ec4899',
    'bg-lime-500': '#84cc16',
    'bg-purple-500': '#a855f7',
    'bg-blue-500': '#3b82f6',
    'bg-green-500': '#22c55e',
    'bg-red-500': '#ef4444',
    'bg-yellow-500': '#eab308',
    'bg-gray-200': '#e5e7eb',
    'bg-gray-700': '#374151',
    'bg-yellow-200': '#fef08a',
    'bg-yellow-800': '#854d0e',
    'bg-purple-300': '#d8b4fe',
    'bg-purple-700': '#7c3aed',
  }

  return colorMap[bgClass] || '#6b7280'
}

const standardSchema = z.object({
  linked_activity: z.string().optional(),
  standard_name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(200),
  standard_type: z.enum(['productivity', 'quality', 'safety', 'accuracy']),
  task_type: z.string().min(2, 'Task type is required').max(100),
  position_id: z.string().optional(),
  working_area_id: z.string().optional(),
  target_value: z.coerce
    .number()
    .min(0.01, 'Target value must be greater than 0'),
  unit_of_measure: z.string().min(2, 'Unit of measure is required').max(50),
  minimum_acceptable: z.coerce.number().min(0).optional(),
  maximum_acceptable: z.coerce.number().min(0).optional(),
  excellent_threshold: z.coerce.number().min(0).optional(),
  effective_from: z.string().min(1, 'Effective date is required'),
  effective_to: z.string().optional(),
  is_active: z.boolean().default(true),
})

type StandardFormData = z.infer<typeof standardSchema>

interface EditStandardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  standard: LaborStandard | null
}

export function EditStandardDialog({
  open,
  onOpenChange,
  standard,
}: EditStandardDialogProps) {
  const { shiftPositions, workingAreas, updateLaborStandard } =
    useLaborManagement()
  const { activityConfigs, isLoading: activitiesLoading } = useActivityConfig()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activityComboOpen, setActivityComboOpen] = useState(false)

  const form = useForm<StandardFormData>({
    resolver: zodResolver(standardSchema) as never,
    defaultValues: {
      linked_activity: '',
      standard_name: '',
      standard_type: 'productivity',
      task_type: '',
      position_id: '__none__',
      working_area_id: '__none__',
      target_value: 0,
      unit_of_measure: 'units_per_hour',
      minimum_acceptable: undefined,
      maximum_acceptable: undefined,
      excellent_threshold: undefined,
      effective_from: new Date().toISOString().split('T')[0],
      effective_to: '',
      is_active: true,
    },
  })

  // Find the matching activity config for the current task_type
  const matchedActivity = useMemo(() => {
    if (!standard?.task_type) return null
    return activityConfigs.find((c) => c.activity_type === standard.task_type)
  }, [standard?.task_type, activityConfigs])

  // Watch linked_activity for changes
  const linkedActivity = form.watch('linked_activity')

  // Update task_type when linked_activity changes (only if user explicitly changes it)
  useEffect(() => {
    if (
      linkedActivity &&
      linkedActivity !== '__none__' &&
      linkedActivity !== standard?.task_type
    ) {
      form.setValue('task_type', linkedActivity)
    }
  }, [linkedActivity, form, standard?.task_type])

  // Reset form when standard changes
  useEffect(() => {
    if (standard && open) {
      // Check if the standard's task_type matches any activity
      const detectedActivity = activityConfigs.find(
        (c) => c.activity_type === standard.task_type
      )

      form.reset({
        linked_activity: detectedActivity?.activity_type || '__none__',
        standard_name: standard.standard_name,
        standard_type: standard.standard_type as
          | 'productivity'
          | 'quality'
          | 'safety'
          | 'accuracy',
        task_type: standard.task_type || '',
        position_id: standard.position_id || '__none__',
        working_area_id: standard.working_area_id || '__none__',
        target_value: standard.target_value,
        unit_of_measure: standard.unit_of_measure,
        minimum_acceptable: standard.minimum_acceptable || undefined,
        maximum_acceptable: standard.maximum_acceptable || undefined,
        excellent_threshold: standard.excellent_threshold || undefined,
        effective_from: standard.effective_from,
        effective_to: standard.effective_to || '',
        is_active: standard.is_active,
      })
    }
  }, [standard, open, form, activityConfigs])

  const onSubmit = async (data: StandardFormData) => {
    if (!standard) return

    try {
      setIsSubmitting(true)

      await updateLaborStandard({
        id: standard.id,
        updates: {
          standard_name: data.standard_name,
          standard_type: data.standard_type,
          task_type: data.task_type,
          position_id:
            data.position_id && data.position_id !== '__none__'
              ? data.position_id
              : undefined,
          working_area_id:
            data.working_area_id && data.working_area_id !== '__none__'
              ? data.working_area_id
              : undefined,
          target_value: data.target_value,
          unit_of_measure: data.unit_of_measure,
          minimum_acceptable: data.minimum_acceptable || undefined,
          maximum_acceptable: data.maximum_acceptable || undefined,
          excellent_threshold: data.excellent_threshold || undefined,
          effective_from: data.effective_from,
          effective_to: data.effective_to || undefined,
          is_active: data.is_active,
        },
      })

      onOpenChange(false)
    } catch (error) {
      logger.error('Error updating labor standard:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Edit Labor Standard</DialogTitle>
          <DialogDescription>
            Update productivity, quality, or safety standard settings.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
            {/* Activity Linking Section */}
            <div className='space-y-5'>
              <div className='flex items-center gap-2 border-b pb-2'>
                <Link2 className='text-primary h-4 w-4' />
                <h4 className='text-primary text-sm font-semibold'>
                  Activity Linking
                </h4>
              </div>

              {matchedActivity ? (
                <Alert className='border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30'>
                  <Check className='h-4 w-4 text-green-600 dark:text-green-400' />
                  <AlertDescription className='text-green-700 dark:text-green-300'>
                    <div className='flex items-center gap-3'>
                      <span>
                        <strong>Linked to activity:</strong>
                      </span>
                      <div className='flex items-center gap-2'>
                        <div
                          className='h-4 w-4 rounded border'
                          style={{
                            backgroundColor: getActivityColor(
                              matchedActivity.gantt_bg_class
                            ),
                          }}
                        />
                        <span className='font-medium'>
                          {matchedActivity.activity_label}
                        </span>
                        <Badge variant='outline' className='font-mono text-xs'>
                          {matchedActivity.activity_type}
                        </Badge>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className='border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'>
                  <Info className='h-4 w-4 text-amber-600 dark:text-amber-400' />
                  <AlertDescription className='text-amber-700 dark:text-amber-300'>
                    <strong>No linked activity:</strong> This standard's task
                    type ({standard?.task_type || 'N/A'}) doesn't match any
                    configured activity. Link to an activity below to enable
                    automatic tracking.
                  </AlertDescription>
                </Alert>
              )}

              <FormField
                control={form.control}
                name='linked_activity'
                render={({ field }) => (
                  <FormItem className='flex flex-col'>
                    <FormLabel className='flex items-center gap-2'>
                      <Link2 className='h-4 w-4' />
                      Change Linked Activity
                    </FormLabel>
                    <Popover
                      open={activityComboOpen}
                      onOpenChange={setActivityComboOpen}
                    >
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant='outline'
                            role='combobox'
                            aria-expanded={activityComboOpen}
                            className={cn(
                              'w-full justify-between',
                              !field.value && 'text-muted-foreground'
                            )}
                            disabled={activitiesLoading}
                          >
                            {activitiesLoading ? (
                              <span className='flex items-center gap-2'>
                                <Loader2 className='h-4 w-4 animate-spin' />
                                Loading activities...
                              </span>
                            ) : field.value && field.value !== '__none__' ? (
                              <span className='flex items-center gap-2'>
                                <div
                                  className='h-3 w-3 rounded-full'
                                  style={{
                                    backgroundColor: getActivityColor(
                                      activityConfigs.find(
                                        (c) => c.activity_type === field.value
                                      )?.gantt_bg_class
                                    ),
                                  }}
                                />
                                {activityConfigs.find(
                                  (c) => c.activity_type === field.value
                                )?.activity_label || field.value}
                              </span>
                            ) : (
                              'Select an activity to link...'
                            )}
                            <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className='w-[500px] p-0' align='start'>
                        <Command>
                          <CommandInput placeholder='Search activities...' />
                          <CommandList>
                            <CommandEmpty>No activities found.</CommandEmpty>
                            <CommandGroup heading='Available Activities'>
                              <CommandItem
                                value='__none__'
                                onSelect={() => {
                                  field.onChange('__none__')
                                  setActivityComboOpen(false)
                                }}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4',
                                    field.value === '__none__' || !field.value
                                      ? 'opacity-100'
                                      : 'opacity-0'
                                  )}
                                />
                                <span className='text-muted-foreground'>
                                  — No linked activity (manual entry) —
                                </span>
                              </CommandItem>
                              {activityConfigs
                                .filter((config) => config.show_on_timeline)
                                .sort(
                                  (a, b) => a.display_order - b.display_order
                                )
                                .map((config) => (
                                  <CommandItem
                                    key={config.activity_type}
                                    value={config.activity_type}
                                    onSelect={() => {
                                      field.onChange(config.activity_type)
                                      setActivityComboOpen(false)
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        'mr-2 h-4 w-4',
                                        field.value === config.activity_type
                                          ? 'opacity-100'
                                          : 'opacity-0'
                                      )}
                                    />
                                    <div className='flex flex-1 items-center gap-3'>
                                      <div
                                        className='h-4 w-4 rounded border'
                                        style={{
                                          backgroundColor: getActivityColor(
                                            config.gantt_bg_class
                                          ),
                                        }}
                                      />
                                      <div className='flex flex-col'>
                                        <span className='font-medium'>
                                          {config.activity_label}
                                        </span>
                                        <span className='text-muted-foreground font-mono text-xs'>
                                          {config.activity_type}
                                        </span>
                                      </div>
                                      <Badge
                                        variant='secondary'
                                        className='ml-auto text-xs capitalize'
                                      >
                                        {config.activity_category}
                                      </Badge>
                                    </div>
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormDescription>
                      Changing the linked activity will update the task type
                      below.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Basic Information */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Standard Identification
              </h4>

              <FormField
                control={form.control}
                name='standard_name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Standard Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='Warehouse Picking Productivity Standard'
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Descriptive name for this standard
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='grid grid-cols-3 gap-4'>
                <FormField
                  control={form.control}
                  name='standard_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='productivity'>
                            Productivity
                          </SelectItem>
                          <SelectItem value='quality'>Quality</SelectItem>
                          <SelectItem value='safety'>Safety</SelectItem>
                          <SelectItem value='accuracy'>Accuracy</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='task_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='flex items-center gap-2'>
                        Task Type *
                        {linkedActivity && linkedActivity !== '__none__' && (
                          <Badge
                            variant='outline'
                            className='text-xs font-normal'
                          >
                            <Link2 className='mr-1 h-3 w-3' />
                            Linked
                          </Badge>
                        )}
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder='picking'
                          {...field}
                          className={cn(
                            linkedActivity &&
                              linkedActivity !== '__none__' &&
                              'bg-muted/50'
                          )}
                        />
                      </FormControl>
                      <FormDescription>e.g., scan, pick, pack</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='unit_of_measure'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit of Measure *</FormLabel>
                      <FormControl>
                        <Input placeholder='units_per_hour' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Scope */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Scope (Optional)
              </h4>

              <div className='grid grid-cols-4 gap-6'>
                <FormField
                  control={form.control}
                  name='position_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Specific Position</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='All positions' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='__none__'>
                            — All Positions —
                          </SelectItem>
                          {shiftPositions.map(
                            (position: {
                              id: string
                              position_title: string
                            }) => (
                              <SelectItem key={position.id} value={position.id}>
                                {position.position_title}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='working_area_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Specific Area</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='All areas' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='__none__'>
                            — All Areas —
                          </SelectItem>
                          {workingAreas.map(
                            (area: { id: string; area_name: string }) => (
                              <SelectItem key={area.id} value={area.id}>
                                {area.area_name}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Target Metrics */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Target Metrics
              </h4>

              <FormField
                control={form.control}
                name='target_value'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Value *</FormLabel>
                    <FormControl>
                      <Input type='number' min='0' step='0.01' {...field} />
                    </FormControl>
                    <FormDescription>Expected target value</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='grid grid-cols-3 gap-4'>
                <FormField
                  control={form.control}
                  name='minimum_acceptable'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Acceptable</FormLabel>
                      <FormControl>
                        <Input type='number' min='0' step='0.01' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='maximum_acceptable'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maximum Acceptable</FormLabel>
                      <FormControl>
                        <Input type='number' min='0' step='0.01' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='excellent_threshold'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Excellent Threshold</FormLabel>
                      <FormControl>
                        <Input type='number' min='0' step='0.01' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Effective Dates */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Effective Period
              </h4>

              <div className='grid grid-cols-4 gap-6'>
                <FormField
                  control={form.control}
                  name='effective_from'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Effective From *</FormLabel>
                      <FormControl>
                        <Input type='date' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='effective_to'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Effective To</FormLabel>
                      <FormControl>
                        <Input type='date' {...field} />
                      </FormControl>
                      <FormDescription>
                        Leave blank for no end date
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Status */}
            <div className='space-y-4'>
              <FormField
                control={form.control}
                name='is_active'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm'>
                    <div className='space-y-0.5'>
                      <FormLabel>Active Standard</FormLabel>
                      <FormDescription>
                        Inactive standards are not applied to performance
                        tracking
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

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
