// Created and developed by Jai Singh
import {
  Activity,
  AlertTriangle,
  Bell,
  Database,
  Network,
  Target,
  Users,
} from 'lucide-react'
import { useActivitySourceConfig } from '@/hooks/use-activity-source-config'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { useShiftProductivitySettings } from '@/hooks/use-shift-productivity-settings'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import ContentSection from '../components/content-section'
import {
  SettingsErrorState,
  SettingsSectionCard,
  SettingsStatusBadge,
  SettingsSummaryCard,
} from '../components/settings-primitives'
import {
  automationBacklog,
  settingsFeatureMatrix,
  settingsHealthSections,
  statusCopy,
} from '../settings-feature-matrix'

export function SettingsOverview() {
  const { effectiveSettings, error, isLoading, refetch, organizationId } =
    useShiftProductivitySettings()
  const {
    positionStats,
    areaStats,
    shiftAssignments,
    laborStandards,
    positionStatsLoading,
    areaStatsLoading,
    assignmentsLoading,
    standardsLoading,
  } = useLaborManagement()
  const { activitySources, activitySourcesLoading } = useActivitySourceConfig()

  const liveCount = settingsFeatureMatrix.filter(
    (feature) => feature.status === 'live'
  ).length
  const actionableCount = settingsFeatureMatrix.filter(
    (feature) => feature.status !== 'pending'
  ).length
  const completionPercent = Math.round(
    (actionableCount / settingsFeatureMatrix.length) * 100
  )

  if (!organizationId) {
    return (
      <ContentSection
        title='Settings Overview'
        desc='Review configuration health and setup progress.'
      >
        <SettingsErrorState
          title='Organization required'
          description='Shift Productivity settings require an organization before configuration can be loaded or saved.'
        />
      </ContentSection>
    )
  }

  return (
    <ContentSection
      title='Settings Overview'
      desc='Review configuration health, setup progress, and which saved controls are wired into live behavior.'
    >
      <div className='flex flex-col gap-6'>
        {error && (
          <SettingsErrorState
            description={
              error instanceof Error
                ? error.message
                : 'Settings failed to load.'
            }
            onRetry={() => void refetch()}
          />
        )}

        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
          <SettingsSummaryCard
            title='Feature wiring'
            value={`${completionPercent}%`}
            description={`${liveCount} live, ${automationBacklog.length} pending automation`}
            icon={Activity}
            isLoading={isLoading}
          />
          <SettingsSummaryCard
            title='Positions'
            value={positionStats?.totalPositions || 0}
            description={`${positionStats?.activePositions || 0} active positions`}
            icon={Network}
            isLoading={positionStatsLoading}
            toneClassName='bg-violet-500/10 text-violet-600 dark:text-violet-400'
          />
          <SettingsSummaryCard
            title='Assignments'
            value={shiftAssignments.length}
            description={`${positionStats?.actualHeadcount || 0} active workers`}
            icon={Users}
            isLoading={assignmentsLoading}
            toneClassName='bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
          />
          <SettingsSummaryCard
            title='Activity sources'
            value={activitySources.length}
            description={`${activitySources.filter((source) => source.is_active).length} active sources`}
            icon={Database}
            isLoading={activitySourcesLoading}
            toneClassName='bg-amber-500/10 text-amber-600 dark:text-amber-400'
          />
        </div>

        <SettingsSectionCard
          title='Configuration Health'
          description='A quick read on which parts of Shift Productivity are fully connected.'
          icon={Target}
        >
          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <div className='flex items-center justify-between gap-4 text-sm'>
                <span className='font-medium'>
                  Live or setup-ready controls
                </span>
                <span className='text-muted-foreground'>
                  {actionableCount} of {settingsFeatureMatrix.length}
                </span>
              </div>
              <Progress value={completionPercent} />
            </div>

            <div className='grid gap-3 md:grid-cols-3'>
              {settingsHealthSections.map((section) => {
                const Icon = section.icon
                const count = settingsFeatureMatrix.filter(
                  (feature) => feature.status === section.status
                ).length
                return (
                  <div key={section.id} className='rounded-lg border p-4'>
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <p className='font-medium'>{section.title}</p>
                        <p className='text-muted-foreground text-sm'>
                          {section.description}
                        </p>
                      </div>
                      <Icon className='text-muted-foreground size-4 shrink-0' />
                    </div>
                    <p className='mt-3 text-2xl font-bold'>{count}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </SettingsSectionCard>

        {automationBacklog.length > 0 && (
          <Alert>
            <AlertTriangle className='size-4' />
            <AlertTitle>Automation Backlog</AlertTitle>
            <AlertDescription>
              {automationBacklog.length} saved settings still require background
              jobs or deeper service wiring. They are shown as pending instead
              of being presented as active automation.
            </AlertDescription>
          </Alert>
        )}

        <SettingsSectionCard
          title='Settings Wiring Matrix'
          description='Every saved control is categorized so operators know what is live, setup-only, partial, or pending automation.'
          icon={Bell}
          contentClassName='p-0'
        >
          <div className='divide-y'>
            {settingsFeatureMatrix.map((feature) => (
              <div
                key={`${feature.category}-${feature.feature}`}
                className='grid gap-3 p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]'
              >
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <p className='font-medium'>{feature.feature}</p>
                    <SettingsStatusBadge status={feature.status} />
                  </div>
                  <p className='text-muted-foreground mt-1 text-sm'>
                    {feature.behavior}
                  </p>
                </div>
                <div className='text-sm'>
                  <p className='text-muted-foreground'>Stored in</p>
                  <p className='mt-1 font-mono text-xs break-words'>
                    {feature.storage}
                  </p>
                </div>
                <div className='text-sm'>
                  <p className='text-muted-foreground'>Read path</p>
                  <p className='mt-1 break-words'>{feature.readPath}</p>
                </div>
                <div className='text-sm lg:max-w-[190px]'>
                  <p className='text-muted-foreground'>Status meaning</p>
                  <p className='mt-1'>
                    {statusCopy[feature.status].description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SettingsSectionCard>

        <SettingsSectionCard
          title='Current Runtime Defaults'
          description='The settings currently loaded for this organization.'
          icon={Activity}
        >
          <div className='grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4'>
            <div className='rounded-lg border p-3'>
              <p className='text-muted-foreground'>Tracking</p>
              <p className='font-medium'>
                {effectiveSettings.tracking_enabled ? 'Enabled' : 'Disabled'}
              </p>
            </div>
            <div className='rounded-lg border p-3'>
              <p className='text-muted-foreground'>Timezone</p>
              <p className='font-medium'>{effectiveSettings.timezone}</p>
            </div>
            <div className='rounded-lg border p-3'>
              <p className='text-muted-foreground'>Default export</p>
              <p className='font-medium uppercase'>
                {effectiveSettings.export_format}
              </p>
            </div>
            <div className='rounded-lg border p-3'>
              <p className='text-muted-foreground'>Labor standards</p>
              <p className='font-medium'>
                {standardsLoading ? 'Loading...' : laborStandards.length}
              </p>
            </div>
            <div className='rounded-lg border p-3'>
              <p className='text-muted-foreground'>Working areas</p>
              <p className='font-medium'>
                {areaStatsLoading
                  ? 'Loading...'
                  : `${areaStats?.totalAreas || 0} total`}
              </p>
            </div>
            <div className='rounded-lg border p-3'>
              <p className='text-muted-foreground'>Notifications</p>
              <p className='font-medium'>
                {effectiveSettings.enable_notifications ? 'Stored' : 'Disabled'}
              </p>
            </div>
            <div className='rounded-lg border p-3'>
              <p className='text-muted-foreground'>Calculation</p>
              <p className='font-medium capitalize'>
                {effectiveSettings.calculation_method}
              </p>
            </div>
            <div className='rounded-lg border p-3'>
              <p className='text-muted-foreground'>Archive automation</p>
              <p className='font-medium'>
                {effectiveSettings.auto_archive ? 'Pending worker' : 'Off'}
              </p>
            </div>
          </div>
        </SettingsSectionCard>
      </div>
    </ContentSection>
  )
}

// Created and developed by Jai Singh
