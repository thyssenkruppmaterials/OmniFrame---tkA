import { useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useShiftProductivitySettings } from '@/hooks/use-shift-productivity-settings'
import { Button } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import ContentSection from '../components/content-section'

const kpiSettingsSchema = z.object({
  enableKPITracking: z.boolean().default(true),
  targetScansPerHour: z.coerce.number().min(1).max(1000).default(30),
  targetPutawaysPerHour: z.coerce.number().min(1).max(1000).default(15),
  targetPicksPerHour: z.coerce.number().min(1).max(1000).default(20),
  targetCycleCountsPerHour: z.coerce.number().min(1).max(100).default(5),
  qualityThreshold: z.coerce.number().min(0).max(100).default(95),
  accuracyThreshold: z.coerce.number().min(0).max(100).default(98),
})

type KPISettingsValues = z.infer<typeof kpiSettingsSchema>

export function KPISettings() {
  const { isLoading, kpiFormValues, updateKPISettings, isUpdatingKPI } =
    useShiftProductivitySettings()

  const form = useForm<KPISettingsValues>({
    resolver: zodResolver(kpiSettingsSchema),
    defaultValues: kpiFormValues,
  })

  useEffect(() => {
    if (!isLoading) {
      form.reset(kpiFormValues)
    }
  }, [isLoading, form, kpiFormValues])

  function onSubmit(data: KPISettingsValues) {
    updateKPISettings(data)
  }

  if (isLoading) {
    return (
      <ContentSection
        title='KPI Thresholds'
        desc='Define performance targets and thresholds for productivity tracking.'
      >
        <div className='space-y-8'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-64 w-full' />
          <Skeleton className='h-48 w-full' />
        </div>
      </ContentSection>
    )
  }

  return (
    <ContentSection
      title='KPI Thresholds'
      desc='Define performance targets and thresholds for productivity tracking.'
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
          <FormField
            control={form.control}
            name='enableKPITracking'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    Enable KPI Tracking
                  </FormLabel>
                  <FormDescription>
                    Track performance against defined KPIs and targets.
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

          <Card>
            <CardHeader>
              <CardTitle>Operational Targets</CardTitle>
              <CardDescription>
                Set hourly targets for core warehouse operations
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-6'>
              <FormField
                control={form.control}
                name='targetScansPerHour'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Scans Per Hour</FormLabel>
                    <FormControl>
                      <Input type='number' {...field} />
                    </FormControl>
                    <FormDescription>
                      Expected number of inbound scans per hour per worker.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='targetPutawaysPerHour'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Putaways Per Hour</FormLabel>
                    <FormControl>
                      <Input type='number' {...field} />
                    </FormControl>
                    <FormDescription>
                      Expected number of putaway operations per hour per worker.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='targetPicksPerHour'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Picks Per Hour</FormLabel>
                    <FormControl>
                      <Input type='number' {...field} />
                    </FormControl>
                    <FormDescription>
                      Expected number of pick operations per hour per worker.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='targetCycleCountsPerHour'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Cycle Counts Per Hour</FormLabel>
                    <FormControl>
                      <Input type='number' {...field} />
                    </FormControl>
                    <FormDescription>
                      Expected number of cycle counts completed per hour per
                      worker.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quality Metrics</CardTitle>
              <CardDescription>
                Set quality and accuracy standards
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-6'>
              <FormField
                control={form.control}
                name='qualityThreshold'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quality Threshold (%)</FormLabel>
                    <FormControl>
                      <Input type='number' {...field} />
                    </FormControl>
                    <FormDescription>
                      Minimum quality score expected for overall operations
                      (0-100%).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='accuracyThreshold'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Accuracy Threshold (%)</FormLabel>
                    <FormControl>
                      <Input type='number' {...field} />
                    </FormControl>
                    <FormDescription>
                      Minimum accuracy expected for data entry and scanning
                      (0-100%).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Button type='submit' disabled={isUpdatingKPI}>
            {isUpdatingKPI ? 'Saving...' : 'Save KPI Settings'}
          </Button>
        </form>
      </Form>
    </ContentSection>
  )
}
