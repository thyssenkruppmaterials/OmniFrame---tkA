// Created and developed by Jai Singh
import { useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useShiftProductivitySettings } from '@/hooks/use-shift-productivity-settings'
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
import ContentSection from '../components/content-section'
import {
  SettingsErrorState,
  SettingsSaveBar,
  SettingsToggleRow,
} from '../components/settings-primitives'

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
    error,
    refetch,
    organizationId,
  } = useShiftProductivitySettings()

  const form = useForm<GeneralSettingsValues>({
    resolver: zodResolver(generalSettingsSchema) as never,
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

  if (error || !organizationId) {
    return (
      <ContentSection
        title='Tracking & Operations'
        desc='Configure shift tracking preferences, schedule defaults, and reporting timezone.'
      >
        <SettingsErrorState
          title={
            !organizationId
              ? 'Organization required'
              : 'Unable to load settings'
          }
          description={
            !organizationId
              ? 'Shift Productivity settings require an organization before they can be saved.'
              : error instanceof Error
                ? error.message
                : 'General settings failed to load.'
          }
          onRetry={organizationId ? () => void refetch() : undefined}
        />
      </ContentSection>
    )
  }

  return (
    <ContentSection
      title='Tracking & Operations'
      desc='Configure shift tracking preferences, schedule defaults, and reporting timezone.'
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
          <FormField
            control={form.control}
            name='trackingEnabled'
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <SettingsToggleRow
                    title='Enable Productivity Tracking'
                    description='Track productivity metrics across all shifts and team members. When disabled, dashboards show an explicit tracking-off state.'
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
                <Select onValueChange={field.onChange} value={field.value}>
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
              <FormItem>
                <FormControl>
                  <SettingsToggleRow
                    title='Track Break Time'
                    description='Use scheduled breaks as part of productivity and idle-time interpretation.'
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
              <FormItem>
                <FormControl>
                  <SettingsToggleRow
                    title='Automatic Clock Out'
                    description='Stores the preference for a time-clock automation worker. No worker runs until backend automation is enabled.'
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
                <Select onValueChange={field.onChange} value={field.value}>
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

          <SettingsSaveBar
            isDirty={form.formState.isDirty}
            isSaving={isUpdatingGeneral}
            submitLabel='Save tracking settings'
            savingLabel='Saving tracking settings...'
          />
        </form>
      </Form>
    </ContentSection>
  )
}

// Created and developed by Jai Singh
