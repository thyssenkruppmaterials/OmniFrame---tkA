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
import { ShiftScheduleManagement } from './components/shift-schedule-management'
import { UnassignedUsersManagement } from './components/unassigned-users-management'

const teamSettingsSchema = z.object({
  enableTeamTracking: z.boolean().default(true),
  teamSize: z.coerce.number().min(1).max(100).default(10),
  shiftRotation: z.enum(['fixed', 'rotating', 'flexible']).default('fixed'),
  competitiveMode: z.boolean().default(false),
  teamGoalsVisible: z.boolean().default(true),
  individualMetricsVisible: z.boolean().default(true),
  crossTrainingTracking: z.boolean().default(false),
})

type TeamSettingsValues = z.infer<typeof teamSettingsSchema>

export function TeamSettings() {
  const { isLoading, teamFormValues, updateTeamSettings, isUpdatingTeam } =
    useShiftProductivitySettings()

  const form = useForm<TeamSettingsValues>({
    resolver: zodResolver(teamSettingsSchema),
    defaultValues: teamFormValues,
  })

  useEffect(() => {
    if (!isLoading) {
      form.reset(teamFormValues)
    }
  }, [isLoading, form, teamFormValues])

  function onSubmit(data: TeamSettingsValues) {
    updateTeamSettings(data)
  }

  if (isLoading) {
    return (
      <ContentSection
        title='Team Settings'
        desc='Configure team-wide productivity settings and collaboration features.'
      >
        <div className='space-y-8'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-48 w-full' />
          <Skeleton className='h-64 w-full' />
        </div>
      </ContentSection>
    )
  }

  return (
    <ContentSection
      title='Team Settings'
      desc='Configure team-wide productivity settings and collaboration features.'
    >
      <div className='space-y-8'>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
            <FormField
              control={form.control}
              name='enableTeamTracking'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                  <div className='space-y-0.5'>
                    <FormLabel className='text-base'>
                      Enable Team Tracking
                    </FormLabel>
                    <FormDescription>
                      Track team-wide productivity metrics and collaboration.
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
                <CardTitle>Team Configuration</CardTitle>
                <CardDescription>
                  Basic team structure and shift organization
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-6'>
                <FormField
                  control={form.control}
                  name='teamSize'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Average Team Size</FormLabel>
                      <FormControl>
                        <Input type='number' {...field} />
                      </FormControl>
                      <FormDescription>
                        Typical number of workers per shift.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='shiftRotation'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Shift Rotation Type</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder='Select rotation type' />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='fixed'>Fixed Shifts</SelectItem>
                          <SelectItem value='rotating'>
                            Rotating Shifts
                          </SelectItem>
                          <SelectItem value='flexible'>
                            Flexible Shifts
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        How shifts are organized and rotated among team members.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Visibility & Privacy</CardTitle>
                <CardDescription>
                  Control what metrics are visible to team members
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <FormField
                  control={form.control}
                  name='competitiveMode'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                      <div className='space-y-0.5'>
                        <FormLabel>Competitive Mode</FormLabel>
                        <FormDescription>
                          Show rankings and leaderboards to encourage healthy
                          competition.
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
                  name='teamGoalsVisible'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                      <div className='space-y-0.5'>
                        <FormLabel>Team Goals Visible</FormLabel>
                        <FormDescription>
                          Show team-wide productivity goals to all members.
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
                  name='individualMetricsVisible'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                      <div className='space-y-0.5'>
                        <FormLabel>Individual Metrics Visible</FormLabel>
                        <FormDescription>
                          Allow team members to view their own detailed metrics.
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
                  name='crossTrainingTracking'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                      <div className='space-y-0.5'>
                        <FormLabel>Cross-Training Tracking</FormLabel>
                        <FormDescription>
                          Track cross-training progress and multi-skill
                          development.
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
              </CardContent>
            </Card>

            <Button type='submit' disabled={isUpdatingTeam}>
              {isUpdatingTeam ? 'Saving...' : 'Save Team Settings'}
            </Button>
          </form>
        </Form>

        <Separator className='my-8' />

        {/* Shift Schedule Management */}
        <ShiftScheduleManagement />

        <Separator className='my-8' />

        {/* Unassigned Users - Bulk Assignment Table */}
        <UnassignedUsersManagement />
      </div>
    </ContentSection>
  )
}
