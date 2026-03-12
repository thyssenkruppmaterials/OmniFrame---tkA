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
} from '@/components/ui/form'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import ContentSection from '../components/content-section'

const notificationSettingsSchema = z.object({
  enableNotifications: z.boolean().default(true),
  shiftStartReminder: z.boolean().default(true),
  shiftEndReminder: z.boolean().default(true),
  lowProductivityAlert: z.boolean().default(true),
  targetMissedAlert: z.boolean().default(true),
  teamMilestoneNotification: z.boolean().default(true),
  dailySummary: z.boolean().default(false),
})

type NotificationSettingsValues = z.infer<typeof notificationSettingsSchema>

export function NotificationSettings() {
  const {
    isLoading,
    notificationFormValues,
    updateNotificationSettings,
    isUpdatingNotification,
  } = useShiftProductivitySettings()

  const form = useForm<NotificationSettingsValues>({
    resolver: zodResolver(notificationSettingsSchema),
    defaultValues: notificationFormValues,
  })

  useEffect(() => {
    if (!isLoading) {
      form.reset(notificationFormValues)
    }
  }, [isLoading, form, notificationFormValues])

  function onSubmit(data: NotificationSettingsValues) {
    updateNotificationSettings(data)
  }

  if (isLoading) {
    return (
      <ContentSection
        title='Notification Settings'
        desc='Configure alerts and notifications for productivity events.'
      >
        <div className='space-y-8'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-32 w-full' />
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-48 w-full' />
        </div>
      </ContentSection>
    )
  }

  return (
    <ContentSection
      title='Notification Settings'
      desc='Configure alerts and notifications for productivity events.'
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
          <FormField
            control={form.control}
            name='enableNotifications'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    Enable Notifications
                  </FormLabel>
                  <FormDescription>
                    Master toggle for all productivity notifications.
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

          <Separator />

          <div className='space-y-4'>
            <h4 className='text-sm font-medium'>Shift Reminders</h4>

            <FormField
              control={form.control}
              name='shiftStartReminder'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Shift Start Reminder</FormLabel>
                    <FormDescription>
                      Notify when shift is about to start (15 min before).
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch('enableNotifications')}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='shiftEndReminder'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Shift End Reminder</FormLabel>
                    <FormDescription>
                      Notify when shift is ending (30 min before).
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch('enableNotifications')}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          <Separator />

          <div className='space-y-4'>
            <h4 className='text-sm font-medium'>Performance Alerts</h4>

            <FormField
              control={form.control}
              name='lowProductivityAlert'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Low Productivity Alert</FormLabel>
                    <FormDescription>
                      Alert when productivity falls below 70% of target.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch('enableNotifications')}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='targetMissedAlert'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Target Missed Alert</FormLabel>
                    <FormDescription>
                      Alert when hourly targets are missed.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch('enableNotifications')}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='teamMilestoneNotification'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Team Milestone Notifications</FormLabel>
                    <FormDescription>
                      Celebrate when team reaches milestones.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch('enableNotifications')}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          <Separator />

          <div className='space-y-4'>
            <h4 className='text-sm font-medium'>Reports</h4>

            <FormField
              control={form.control}
              name='dailySummary'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Daily Summary Email</FormLabel>
                    <FormDescription>
                      Receive daily productivity summary via email.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch('enableNotifications')}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          <Button type='submit' disabled={isUpdatingNotification}>
            {isUpdatingNotification
              ? 'Saving...'
              : 'Save Notification Settings'}
          </Button>
        </form>
      </Form>
    </ContentSection>
  )
}
