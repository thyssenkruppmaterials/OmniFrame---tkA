// Created and developed by Jai Singh
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronRight, Sparkles } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { ActivitySourcesSettings } from './activity-sources/activity-sources-settings'
import { AdvancedSettings } from './advanced/advanced-settings'
import SidebarNav, { type SidebarNavGroup } from './components/sidebar-nav'
import { GeneralSettings } from './general/general-settings'
import { KPISettings } from './kpi/kpi-settings'
import { LaborManagementSettings } from './labor-management/labor-management-settings'
import { NotificationSettings } from './notifications/notification-settings'
import { SettingsOverview } from './overview/settings-overview'
import {
  settingsFeatureMatrix,
  settingsSectionGroups,
  settingsSections,
  type SettingsSectionConfig,
} from './settings-feature-matrix'
import { TeamSettings } from './team/team-settings'

const legacySectionMap: Record<string, string> = {
  general: 'tracking',
  kpi: 'performance-standards',
  'labor-management': 'operating-model',
  'activity-sources': 'data-sources',
  notifications: 'automation',
  team: 'team-schedules',
}

export default function ShiftProductivitySettings() {
  const sectionsById = useMemo(
    () =>
      settingsSections.reduce<Record<string, SettingsSectionConfig>>(
        (acc, section) => {
          acc[section.id] = section
          return acc
        },
        {}
      ),
    []
  )

  const navGroups = useMemo<SidebarNavGroup[]>(() => {
    return settingsSectionGroups
      .map((group) => ({
        id: group.id,
        label: group.label,
        description: group.description,
        items: settingsSections.filter((section) => section.group === group.id),
      }))
      .filter((group) => group.items.length > 0)
  }, [])

  const [activeSection, setActiveSection] = useState(() => {
    if (typeof window === 'undefined') return 'overview'
    const params = new URLSearchParams(window.location.search)
    const section = params.get('section')
    const normalized = section ? (legacySectionMap[section] ?? section) : null
    return normalized && sectionsById[normalized] ? normalized : 'overview'
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const section = params.get('section')
    const normalized = section ? (legacySectionMap[section] ?? section) : null
    if (!normalized || !sectionsById[normalized]) return
    setActiveSection(normalized)
  }, [sectionsById])

  const handleSectionChange = (section: string) => {
    if (!sectionsById[section]) return

    setActiveSection(section)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', 'settings')
    if (section === 'overview') {
      url.searchParams.delete('section')
    } else {
      url.searchParams.set('section', section)
    }
    window.history.replaceState(null, '', url.toString())
  }

  const activeSectionConfig = sectionsById[activeSection] ?? settingsSections[0]
  const activeGroup = settingsSectionGroups.find(
    (group) => group.id === activeSectionConfig.group
  )

  const liveCount = settingsFeatureMatrix.filter(
    (feature) => feature.status === 'live'
  ).length
  const pendingCount = settingsFeatureMatrix.filter(
    (feature) => feature.status === 'pending'
  ).length
  const actionableCount = settingsFeatureMatrix.filter(
    (feature) => feature.status !== 'pending'
  ).length
  const completionPercent = Math.round(
    (actionableCount / settingsFeatureMatrix.length) * 100
  )

  const ActiveIcon = activeSectionConfig.icon

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':
        return <SettingsOverview />
      case 'tracking':
        return <GeneralSettings />
      case 'performance-standards':
        return <KPISettings />
      case 'operating-model':
        return <LaborManagementSettings />
      case 'data-sources':
        return <ActivitySourcesSettings />
      case 'automation':
        return <NotificationSettings />
      case 'team-schedules':
        return <TeamSettings />
      case 'advanced':
        return <AdvancedSettings />
      default:
        return <SettingsOverview />
    }
  }

  return (
    <div className='grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]'>
      <aside className='top-24 flex flex-col gap-5 lg:sticky lg:self-start'>
        <SidebarHero
          completionPercent={completionPercent}
          liveCount={liveCount}
          pendingCount={pendingCount}
          totalCount={settingsFeatureMatrix.length}
        />

        <SidebarNav
          groups={navGroups}
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
        />
      </aside>

      <div className='flex min-w-0 flex-col gap-4'>
        <div className='border-border/60 bg-card/70 supports-[backdrop-filter]:bg-card/50 sticky top-24 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 backdrop-blur'>
          <div className='flex min-w-0 items-center gap-2 text-sm'>
            <span className='text-muted-foreground'>Settings</span>
            {activeGroup && (
              <>
                <ChevronRight className='text-muted-foreground/60 size-3.5' />
                <span className='text-muted-foreground'>
                  {activeGroup.label}
                </span>
              </>
            )}
            <ChevronRight className='text-muted-foreground/60 size-3.5' />
            <span className='text-foreground flex items-center gap-2 truncate font-medium'>
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-md ${activeSectionConfig.accent}`}
              >
                <ActiveIcon className='size-3' />
              </span>
              {activeSectionConfig.shortTitle}
            </span>
          </div>

          <div className='flex items-center gap-2 text-xs'>
            <CheckCircle2 className='size-3.5 text-emerald-500' />
            <span className='text-muted-foreground'>
              {liveCount} live · {pendingCount} pending
            </span>
          </div>
        </div>

        <div className='border-border/60 bg-card flex-1 rounded-2xl border p-5 shadow-sm sm:p-6'>
          {renderContent()}
        </div>
      </div>
    </div>
  )
}

interface SidebarHeroProps {
  completionPercent: number
  liveCount: number
  pendingCount: number
  totalCount: number
}

function SidebarHero({
  completionPercent,
  liveCount,
  pendingCount,
  totalCount,
}: SidebarHeroProps) {
  return (
    <div className='border-border/60 bg-card rounded-2xl border p-4'>
      <div className='flex items-center gap-3'>
        <div className='bg-primary/10 text-primary flex size-9 items-center justify-center rounded-xl'>
          <Sparkles className='size-4' />
        </div>
        <div className='min-w-0'>
          <p className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
            Shift Productivity
          </p>
          <p className='truncate text-sm font-semibold'>Operations Center</p>
        </div>
      </div>

      <div className='mt-4 flex flex-col gap-2'>
        <div className='flex items-center justify-between text-xs'>
          <span className='text-muted-foreground'>Configuration health</span>
          <span className='font-semibold tabular-nums'>
            {completionPercent}%
          </span>
        </div>
        <Progress value={completionPercent} className='h-1.5' />
        <div className='text-muted-foreground mt-1 flex items-center justify-between text-[11px]'>
          <span className='inline-flex items-center gap-1.5'>
            <span className='size-1.5 rounded-full bg-emerald-500' />
            {liveCount} live
          </span>
          <span className='inline-flex items-center gap-1.5'>
            <span className='size-1.5 rounded-full bg-amber-500' />
            {pendingCount} pending
          </span>
          <span className='tabular-nums'>{totalCount} total</span>
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
