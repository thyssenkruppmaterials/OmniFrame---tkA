/**
 * Add Working Area Dialog Component
 * Form modal for creating new working areas
 * Created: October 20, 2025
 * Updated: December 25, 2025 - Use configurable area types
 */
import { useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { useAreaOptions } from '@/hooks/use-area-options'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { Button } from '@/components/ui/button'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const areaSchema = z.object({
  area_code: z
    .string()
    .min(2, 'Area code must be at least 2 characters')
    .max(50, 'Area code must be less than 50 characters')
    .regex(
      /^[A-Z0-9-]+$/,
      'Area code must be uppercase letters, numbers, and hyphens only'
    ),
  area_name: z
    .string()
    .min(3, 'Area name must be at least 3 characters')
    .max(200, 'Area name must be less than 200 characters'),
  area_type: z.string().min(1, 'Area type is required'),
  description: z.string().optional(),
  capacity: z.coerce
    .number()
    .int()
    .min(1, 'Capacity must be at least 1')
    .max(500),
  requires_certification: z.boolean().default(false),
  required_certifications: z.string().optional(),
  primary_supervisor_id: z.string().optional(),
  backup_supervisor_id: z.string().optional(),
  operating_hours_start: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)'),
  operating_hours_end: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)'),
  operating_days: z
    .array(z.number().min(1).max(7))
    .min(1, 'Select at least one operating day'),
})

type AreaFormData = z.infer<typeof areaSchema>

interface AddAreaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddAreaDialog({ open, onOpenChange }: AddAreaDialogProps) {
  const { createWorkingArea } = useLaborManagement()
  const { activeAreaTypes } = useAreaOptions()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<AreaFormData>({
    resolver: zodResolver(areaSchema),
    defaultValues: {
      area_code: '',
      area_name: '',
      area_type: 'warehouse_zone',
      description: '',
      capacity: 10,
      requires_certification: false,
      required_certifications: '',
      primary_supervisor_id: '',
      backup_supervisor_id: '',
      operating_hours_start: '06:00',
      operating_hours_end: '22:00',
      operating_days: [1, 2, 3, 4, 5], // Monday-Friday default
    },
  })

  const onSubmit = async (data: AreaFormData) => {
    try {
      setIsSubmitting(true)

      // Parse certifications from comma-separated string to array
      const certificationsArray = data.required_certifications
        ? data.required_certifications
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
        : []

      await createWorkingArea({
        area_code: data.area_code,
        area_name: data.area_name,
        area_type: data.area_type,
        description: data.description || undefined,
        capacity: data.capacity,
        requires_certification: data.requires_certification,
        required_certifications: certificationsArray,
        primary_supervisor_id: data.primary_supervisor_id || undefined,
        backup_supervisor_id: data.backup_supervisor_id || undefined,
        operating_hours: {
          start: data.operating_hours_start,
          end: data.operating_hours_end,
        },
        operating_days: data.operating_days,
        is_active: true,
      })

      form.reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Error creating working area:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleDay = (day: number) => {
    const currentDays = form.getValues('operating_days')
    const newDays = currentDays.includes(day)
      ? currentDays.filter((d) => d !== day)
      : [...currentDays, day].sort()
    form.setValue('operating_days', newDays)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Add New Working Area</DialogTitle>
          <DialogDescription>
            Create a new working area with supervisor assignments and operating
            schedule.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
            {/* Basic Information */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Basic Information
              </h4>

              <div className='grid grid-cols-4 gap-6'>
                <FormField
                  control={form.control}
                  name='area_code'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Area Code *</FormLabel>
                      <FormControl>
                        <Input placeholder='WH-ZONE-A' {...field} />
                      </FormControl>
                      <FormDescription>Unique code (uppercase)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='area_name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Area Name *</FormLabel>
                      <FormControl>
                        <Input placeholder='Warehouse Zone A' {...field} />
                      </FormControl>
                      <FormDescription>Display name</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='grid grid-cols-4 gap-6'>
                <FormField
                  control={form.control}
                  name='area_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Area Type *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select area type' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {activeAreaTypes.length === 0 ? (
                            <SelectItem value='__none__' disabled>
                              No area types available - configure in Options tab
                            </SelectItem>
                          ) : (
                            activeAreaTypes.map((areaType) => (
                              <SelectItem
                                key={areaType.id}
                                value={areaType.type_value}
                              >
                                {areaType.type_label}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='capacity'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Worker Capacity *</FormLabel>
                      <FormControl>
                        <Input type='number' min='1' max='500' {...field} />
                      </FormControl>
                      <FormDescription>Maximum workers</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name='description'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='Describe the working area purpose and layout...'
                        className='resize-none'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Certification Requirements */}
            <div className='space-y-4'>
              <h4 className='text-sm font-semibold'>Certification & Safety</h4>

              <FormField
                control={form.control}
                name='requires_certification'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm'>
                    <div className='space-y-0.5'>
                      <FormLabel>Requires Certification</FormLabel>
                      <FormDescription>
                        Workers must have specific certifications
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

              {form.watch('requires_certification') && (
                <FormField
                  control={form.control}
                  name='required_certifications'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Required Certifications *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder='Hazmat, Forklift License (comma-separated)'
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>Comma-separated list</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {/* Operating Schedule */}
            <div className='space-y-4'>
              <h4 className='text-sm font-semibold'>Operating Schedule</h4>

              <div className='grid grid-cols-4 gap-6'>
                <FormField
                  control={form.control}
                  name='operating_hours_start'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time *</FormLabel>
                      <FormControl>
                        <Input type='time' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='operating_hours_end'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Time *</FormLabel>
                      <FormControl>
                        <Input type='time' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div>
                <FormLabel>Operating Days *</FormLabel>
                <div className='mt-2 flex gap-2'>
                  {[
                    { value: 1, label: 'Mon' },
                    { value: 2, label: 'Tue' },
                    { value: 3, label: 'Wed' },
                    { value: 4, label: 'Thu' },
                    { value: 5, label: 'Fri' },
                    { value: 6, label: 'Sat' },
                    { value: 7, label: 'Sun' },
                  ].map((day) => (
                    <Button
                      key={day.value}
                      type='button'
                      variant={
                        form.watch('operating_days').includes(day.value)
                          ? 'default'
                          : 'outline'
                      }
                      size='sm'
                      onClick={() => toggleDay(day.value)}
                    >
                      {day.label}
                    </Button>
                  ))}
                </div>
                <p className='text-muted-foreground mt-2 text-xs'>
                  Selected: {form.watch('operating_days').length} day(s)
                </p>
              </div>
            </div>

            <DialogFooter>
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
                Create Working Area
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
