/**
 * Add Position Dialog Component
 * Form modal for creating new organizational positions
 * Created: October 20, 2025
 * Updated: December 25, 2025 - Use configurable departments
 */
import { useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { useAreaOptions } from '@/hooks/use-area-options'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { usePositionOptions } from '@/hooks/use-position-options'
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

const positionSchema = z.object({
  position_code: z
    .string()
    .min(3, 'Position code must be at least 3 characters')
    .max(50, 'Position code must be less than 50 characters')
    .regex(
      /^[A-Z0-9-]+$/,
      'Position code must be uppercase letters, numbers, and hyphens only'
    ),
  position_title: z
    .string()
    .min(3, 'Position title must be at least 3 characters')
    .max(200, 'Position title must be less than 200 characters'),
  position_type: z.string().min(1, 'Position type is required'),
  position_level: z.coerce
    .number()
    .int()
    .min(1, 'Level must be between 1 and 20')
    .max(20, 'Level must be between 1 and 20'),
  department: z.string().min(2, 'Department is required').max(100),
  description: z.string().optional(),
  responsibilities: z.string().optional(),
  reports_to_position_id: z.string().optional(),
  headcount_budget: z.coerce
    .number()
    .int()
    .min(1, 'Headcount budget must be at least 1')
    .max(1000),
  is_supervisory: z.boolean().default(false),
  minimum_experience_years: z.coerce.number().min(0).max(50).optional(),
  required_skills: z.string().optional(),
  required_certifications: z.string().optional(),
})

type PositionFormData = z.infer<typeof positionSchema>

interface AddPositionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddPositionDialog({
  open,
  onOpenChange,
}: AddPositionDialogProps) {
  const { shiftPositions, createShiftPosition } = useLaborManagement()
  const { activePositionTypes, activePositionLevels } = usePositionOptions()
  const { activeDepartments } = useAreaOptions()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<PositionFormData>({
    resolver: zodResolver(positionSchema),
    defaultValues: {
      position_code: '',
      position_title: '',
      position_type: 'operational',
      position_level: 2,
      department: '',
      description: '',
      responsibilities: '',
      reports_to_position_id: '__none__',
      headcount_budget: 1,
      is_supervisory: false,
      minimum_experience_years: 0,
      required_skills: '',
      required_certifications: '',
    },
  })

  const onSubmit = async (data: PositionFormData) => {
    try {
      setIsSubmitting(true)

      // Validation: Check supervisor level is higher than this position
      if (data.reports_to_position_id) {
        const supervisorPosition = shiftPositions.find(
          (p) => p.id === data.reports_to_position_id
        )
        if (
          supervisorPosition &&
          supervisorPosition.position_level <= data.position_level
        ) {
          form.setError('reports_to_position_id', {
            message: 'Supervisor must be at a higher level than this position',
          })
          setIsSubmitting(false)
          return
        }
      }

      // Parse skills and certifications from comma-separated strings to arrays
      const skillsArray = data.required_skills
        ? data.required_skills
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
      const certificationsArray = data.required_certifications
        ? data.required_certifications
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
        : []

      await createShiftPosition({
        position_code: data.position_code,
        position_title: data.position_title,
        position_type: data.position_type,
        position_level: data.position_level,
        department: data.department,
        description: data.description || undefined,
        responsibilities: data.responsibilities || undefined,
        reports_to_position_id:
          data.reports_to_position_id &&
          data.reports_to_position_id !== '__none__'
            ? data.reports_to_position_id
            : undefined,
        headcount_budget: data.headcount_budget,
        is_supervisory: data.is_supervisory,
        minimum_experience_years: data.minimum_experience_years || undefined,
        required_skills: skillsArray,
        required_certifications: certificationsArray,
        is_active: true,
      })

      form.reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Error creating position:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] w-[95vw] max-w-[1400px] min-w-[1200px] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Add New Position</DialogTitle>
          <DialogDescription>
            Create a new organizational position with reporting relationships
            and requirements.
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
                  name='position_code'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Position Code *</FormLabel>
                      <FormControl>
                        <Input placeholder='MGR-WH-01' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='position_title'
                  render={({ field }) => (
                    <FormItem className='col-span-2'>
                      <FormLabel>Position Title *</FormLabel>
                      <FormControl>
                        <Input placeholder='Warehouse Manager' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='department'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select department' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent position='popper' sideOffset={5}>
                          {activeDepartments.length === 0 ? (
                            <SelectItem value='__none__' disabled>
                              No departments available - configure in Options
                              tab
                            </SelectItem>
                          ) : (
                            activeDepartments.map((dept) => (
                              <SelectItem
                                key={dept.id}
                                value={dept.department_label}
                              >
                                {dept.department_label}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='grid grid-cols-4 gap-6'>
                <FormField
                  control={form.control}
                  name='position_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select type' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent position='popper' sideOffset={5}>
                          {activePositionTypes.length === 0 ? (
                            <SelectItem value='__none__' disabled>
                              No types available - configure in Options tab
                            </SelectItem>
                          ) : (
                            activePositionTypes.map((type) => (
                              <SelectItem key={type.id} value={type.type_value}>
                                {type.type_label}
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
                  name='position_level'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Level *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value.toString()}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select level' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent position='popper' sideOffset={5}>
                          {activePositionLevels.length === 0 ? (
                            <SelectItem value='1' disabled>
                              No levels available - configure in Options tab
                            </SelectItem>
                          ) : (
                            activePositionLevels.map((level) => (
                              <SelectItem
                                key={level.id}
                                value={level.level_value.toString()}
                              >
                                {level.level_label}
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
                  name='headcount_budget'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Headcount *</FormLabel>
                      <FormControl>
                        <Input type='number' min='1' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='reports_to_position_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reports To</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='None' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent position='popper' sideOffset={5}>
                          <SelectItem value='__none__'>
                            — No Supervisor —
                          </SelectItem>
                          {shiftPositions
                            .filter((p) => p.is_supervisory)
                            .sort((a, b) => b.position_level - a.position_level)
                            .map((position) => (
                              <SelectItem key={position.id} value={position.id}>
                                L{position.position_level} -{' '}
                                {position.position_title}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Descriptions */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Description & Responsibilities
              </h4>

              <div className='grid grid-cols-2 gap-6'>
                <FormField
                  control={form.control}
                  name='description'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder='Brief description of the position...'
                          className='h-20 resize-none'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='responsibilities'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Key Responsibilities</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder='Main duties and responsibilities...'
                          className='h-20 resize-none'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Requirements */}
            <div className='space-y-5'>
              <h4 className='text-primary border-b pb-2 text-sm font-semibold'>
                Requirements
              </h4>

              <div className='grid grid-cols-2 gap-6'>
                <FormField
                  control={form.control}
                  name='required_skills'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Required Skills</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder='Forklift, WMS, RF Terminal (comma-separated)'
                          className='h-20 resize-none'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='required_certifications'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Required Certifications</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder='Forklift License, OSHA Safety (comma-separated)'
                          className='h-20 resize-none'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='grid grid-cols-4 gap-6'>
                <FormField
                  control={form.control}
                  name='minimum_experience_years'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min Experience (years)</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min='0'
                          step='0.25'
                          placeholder='0'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className='col-span-3 grid grid-cols-2 gap-6'>
                  <FormField
                    control={form.control}
                    name='is_supervisory'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                        <FormLabel>Supervisory</FormLabel>
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
                Create Position
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
