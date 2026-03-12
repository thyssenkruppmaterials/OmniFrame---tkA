import { useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useShiftProductivitySettings } from '@/hooks/use-shift-productivity-settings'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import ContentSection from '../components/content-section'

const generalSettingsSchema = z.object({
  trackingEnabled: z.boolean().default(true),
  shiftDuration: z.enum(['8', '10', '12']).default('8'),
  breakTracking: z.boolean().default(true),
  autoClockOut: z.boolean().default(false),
  timezone: z.string().default('America/New_York'),
})

type GeneralSettingsValues = z.infer<typeof generalSettingsSchema>

export function GeneralSettings() {
  const {
    isLoading,
    generalFormValues,
    updateGeneralSettings,
    isUpdatingGeneral,
  } = useShiftProductivitySettings()

  const form = useForm<GeneralSettingsValues>({
    resolver: zodResolver(generalSettingsSchema),
    defaultValues: generalFormValues,
  })

  useEffect(() => {
    if (!isLoading) {
      form.reset(generalFormValues)
    }
  }, [isLoading, form, generalFormValues])

  function onSubmit(data: GeneralSettingsValues) {
    updateGeneralSettings(data)
  }

  if (isLoading) {
    return (
      <ContentSection
        title='General Settings'
        desc='Configure basic productivity tracking preferences and shift management.'
      >
        <div className='space-y-8'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-16 w-full' />
        </div>
      </ContentSection>
    )
  }

  return (
    <ContentSection
      title='General Settings'
      desc='Configure basic productivity tracking preferences and shift management.'
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
          <FormField
            control={form.control}
            name='trackingEnabled'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    Enable Productivity Tracking
                  </FormLabel>
                  <FormDescription>
                    Track productivity metrics across all shifts and team
                    members.
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
            name='shiftDuration'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Default Shift Duration (hours)</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder='Select shift duration' />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value='8'>8 Hours</SelectItem>
                    <SelectItem value='10'>10 Hours</SelectItem>
                    <SelectItem value='12'>12 Hours</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  Standard shift duration for productivity calculations.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='breakTracking'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>Track Break Time</FormLabel>
                  <FormDescription>
                    Monitor and deduct break time from productivity
                    calculations.
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
            name='autoClockOut'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    Automatic Clock Out
                  </FormLabel>
                  <FormDescription>
                    Automatically clock out workers at the end of their
                    scheduled shift.
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
            name='timezone'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Timezone</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder='Select timezone' />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value='America/New_York'>
                      Eastern Time (ET)
                    </SelectItem>
                    <SelectItem value='America/Chicago'>
                      Central Time (CT)
                    </SelectItem>
                    <SelectItem value='America/Denver'>
                      Mountain Time (MT)
                    </SelectItem>
                    <SelectItem value='America/Los_Angeles'>
                      Pacific Time (PT)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  Timezone for shift scheduling and reporting.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type='submit' disabled={isUpdatingGeneral}>
            {isUpdatingGeneral ? 'Saving...' : 'Save Settings'}
          </Button>
        </form>
      </Form>
    </ContentSection>
  )
}
