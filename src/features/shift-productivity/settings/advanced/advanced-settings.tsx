// Created and developed by Jai Singh
import { useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { useShiftProductivitySettings } from '@/hooks/use-shift-productivity-settings'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import ContentSection from '../components/content-section'
import {
  SettingsErrorState,
  SettingsSaveBar,
  SettingsStatusBadge,
} from '../components/settings-primitives'

const advancedSettingsSchema = z.object({
  dataRetentionDays: z.coerce.number().min(30).max(365).default(90),
  calculationMethod: z
    .enum(['simple', 'weighted', 'rolling'])
    .default('simple'),
  enableDebugMode: z.boolean().default(false),
  enableAdvancedAnalytics: z.boolean().default(false),
  exportFormat: z.enum(['csv', 'excel', 'json']).default('csv'),
  autoArchive: z.boolean().default(true),
})

type AdvancedSettingsValues = z.infer<typeof advancedSettingsSchema>

export function AdvancedSettings() {
  const {
    isLoading,
    advancedFormValues,
    updateAdvancedSettings,
    isUpdatingAdvanced,
    error,
    refetch,
    organizationId,
  } = useShiftProductivitySettings()

  const form = useForm<AdvancedSettingsValues>({
    resolver: zodResolver(advancedSettingsSchema) as never,
    defaultValues: advancedFormValues,
  })

  useEffect(() => {
    if (!isLoading) {
      form.reset(advancedFormValues)
    }
  }, [isLoading, form, advancedFormValues])

  function onSubmit(data: AdvancedSettingsValues) {
    updateAdvancedSettings(data)
  }

  if (isLoading) {
    return (
      <ContentSection
        title='Advanced Settings'
        desc='Configure advanced productivity tracking options and data management.'
      >
        <div className='space-y-8'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-48 w-full' />
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-32 w-full' />
        </div>
      </ContentSection>
    )
  }

  if (error || !organizationId) {
    return (
      <ContentSection
        title='Advanced Controls'
        desc='Tune retention, export defaults, calculation mode, and diagnostics.'
      >
        <SettingsErrorState
          title={
            !organizationId
              ? 'Organization required'
              : 'Unable to load settings'
          }
          description={
            !organizationId
              ? 'Advanced settings require an organization before they can be saved.'
              : error instanceof Error
                ? error.message
                : 'Advanced settings failed to load.'
          }
          onRetry={organizationId ? () => void refetch() : undefined}
        />
      </ContentSection>
    )
  }

  return (
    <ContentSection
      title='Advanced Controls'
      desc='Tune retention, export defaults, calculation mode, and diagnostics.'
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
          <Alert>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>Advanced Configuration</AlertTitle>
            <AlertDescription>
              These settings affect how productivity data is calculated and
              stored. Changes may impact historical data and reports.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Data Management</CardTitle>
              <CardDescription>
                Configure how productivity data is stored and retained
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-6'>
              <FormField
                control={form.control}
                name='dataRetentionDays'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data Retention Period (days)</FormLabel>
                    <FormControl>
                      <Input type='number' {...field} />
                    </FormControl>
                    <FormDescription>
                      How long to keep detailed productivity data (30-365 days).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='autoArchive'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                    <div className='space-y-0.5'>
                      <FormLabel>Auto-Archive Old Data</FormLabel>
                      <FormDescription>
                        Stores the retention preference. A scheduled archive
                        worker is required before data is moved automatically.
                      </FormDescription>
                      <SettingsStatusBadge status='pending' />
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
                name='exportFormat'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Export Format</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='Select export format' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='csv'>CSV</SelectItem>
                        <SelectItem value='excel'>Excel (.xlsx)</SelectItem>
                        <SelectItem value='json'>JSON</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Default format for productivity report exports.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Separator />

          <Card>
            <CardHeader>
              <CardTitle>Calculation Methods</CardTitle>
              <CardDescription>
                Configure how productivity metrics are calculated
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-6'>
              <FormField
                control={form.control}
                name='calculationMethod'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Productivity Calculation Method</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='Select calculation method' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value='simple'>Simple Average</SelectItem>
                        <SelectItem value='weighted'>
                          Weighted Average
                        </SelectItem>
                        <SelectItem value='rolling'>
                          Rolling Average (7 days)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Method used to calculate productivity scores and trends.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Separator />

          <Card>
            <CardHeader>
              <CardTitle>Development Features</CardTitle>
              <CardDescription>
                Features for testing and development
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <FormField
                control={form.control}
                name='enableDebugMode'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                    <div className='space-y-0.5'>
                      <FormLabel>Debug Mode</FormLabel>
                      <FormDescription>
                        Enable detailed logging for troubleshooting.
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
                name='enableAdvancedAnalytics'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                    <div className='space-y-0.5'>
                      <FormLabel>Advanced Analytics</FormLabel>
                      <FormDescription>
                        Store the preference for future forecasting and anomaly
                        views. Analytics pipeline wiring is required before this
                        changes dashboard outputs.
                      </FormDescription>
                      <SettingsStatusBadge status='pending' />
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
            </CardContent>
          </Card>

          <SettingsSaveBar
            isDirty={form.formState.isDirty}
            isSaving={isUpdatingAdvanced}
            submitLabel='Save advanced settings'
            savingLabel='Saving advanced settings...'
          />
        </form>
      </Form>
    </ContentSection>
  )
}

// Created and developed by Jai Singh
