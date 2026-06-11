// Created and developed by Jai Singh
/**
 * OmniBeltDashboard — shell + tab strip + section router.
 *
 * P8 of the OmniBelt rollout (2026-05-24). Five sections selectable
 * via `?section=` search param so admins can deep-link and the
 * back/forward buttons restore the right tab.
 *
 * Uses the shared shadcn `Tabs` primitive but keeps the section
 * state authoritative in the URL — `useSearch` reads the current
 * section, `useNavigate` writes a new section on `Tabs.onValueChange`.
 *
 * Header carries a title + a "Reload" button that invalidates
 * every dashboard query key in one go (bootstrap, 24h MV, recent
 * events, audit log, prefs aggregate).
 */
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import {
  IconChartBar,
  IconCompass,
  IconHistory,
  IconRefresh,
  IconTool,
  IconUsersGroup,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AnalyticsSection } from './sections/AnalyticsSection'
import { AuditSection } from './sections/AuditSection'
import { OverviewSection } from './sections/OverviewSection'
import { RoleDefaultsSection } from './sections/RoleDefaultsSection'
import { ToolsSection } from './sections/ToolsSection'

export type OmniBeltDashboardSection =
  | 'overview'
  | 'tools'
  | 'roles'
  | 'analytics'
  | 'audit'

const TAB_DEFS: ReadonlyArray<{
  id: OmniBeltDashboardSection
  label: string
  icon: typeof IconCompass
  description: string
}> = [
  {
    id: 'overview',
    label: 'Overview',
    icon: IconCompass,
    description: 'Master kill switch, live KPIs, recent admin changes.',
  },
  {
    id: 'tools',
    label: 'Tools & Allow-list',
    icon: IconTool,
    description: 'Toggle which registry tools are available org-wide.',
  },
  {
    id: 'roles',
    label: 'Role Defaults',
    icon: IconUsersGroup,
    description: 'Per-role default belt, anchor position and skin.',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: IconChartBar,
    description: 'Telemetry — top tools, heatmap, funnel, skin pie.',
  },
  {
    id: 'audit',
    label: 'Audit',
    icon: IconHistory,
    description: 'Recent role-config edits with actor + timestamp.',
  },
]

const VALID_SECTIONS: readonly OmniBeltDashboardSection[] = [
  'overview',
  'tools',
  'roles',
  'analytics',
  'audit',
] as const

function isSection(value: string): value is OmniBeltDashboardSection {
  return (VALID_SECTIONS as readonly string[]).includes(value)
}

function readSectionFromUrl(searchString: string): OmniBeltDashboardSection {
  if (typeof window === 'undefined') return 'overview'
  try {
    const params = new URLSearchParams(searchString)
    const raw = params.get('section') ?? ''
    if (isSection(raw)) return raw
  } catch {
    /* fall through */
  }
  return 'overview'
}

export function OmniBeltDashboard() {
  const queryClient = useQueryClient()
  const location = useLocation()
  // Initialize from URL on first render; sync on subsequent URL changes
  // (back / forward button, deep link).
  const [active, setActiveState] = useState<OmniBeltDashboardSection>(() =>
    readSectionFromUrl(location.searchStr ?? '')
  )

  useEffect(() => {
    const next = readSectionFromUrl(location.searchStr ?? '')
    setActiveState((prev) => (prev === next ? prev : next))
  }, [location.searchStr])

  const setActive = useCallback((next: string) => {
    if (!isSection(next)) return
    setActiveState(next)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('section', next)
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }, [])

  const reload = useCallback(() => {
    // One sweep invalidates everything keyed under `['omnibelt', 'admin', ...]`.
    void queryClient.invalidateQueries({ queryKey: ['omnibelt', 'admin'] })
  }, [queryClient])

  const currentDef = TAB_DEFS.find((t) => t.id === active) ?? TAB_DEFS[0]

  return (
    <div className='flex h-full min-h-0 flex-col gap-4 p-4 md:p-6'>
      <header className='flex flex-col gap-2 md:flex-row md:items-start md:justify-between'>
        <div className='flex items-start gap-3'>
          <div className='bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-lg'>
            <IconCompass size={22} aria-hidden />
          </div>
          <div className='space-y-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>OmniBelt</h1>
            <p className='text-muted-foreground max-w-2xl text-sm'>
              Manage OmniBelt — kill switch, allow-list, per-role defaults,
              usage analytics, and audit. Changes propagate to every connected
              client in under a second via{' '}
              <code>WsEvent::OmnibeltConfigChanged</code>.
            </p>
          </div>
        </div>
        <div className='flex items-center gap-2 self-end md:self-start'>
          <Button variant='outline' size='sm' onClick={reload}>
            <IconRefresh className='mr-2 h-4 w-4' aria-hidden />
            Reload
          </Button>
        </div>
      </header>

      <Tabs
        value={active}
        onValueChange={setActive}
        className='flex min-h-0 flex-1 flex-col gap-4'
      >
        <TabsList className='h-auto w-full justify-start overflow-x-auto'>
          {TAB_DEFS.map((tab) => {
            const Icon = tab.icon
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className='flex items-center gap-2'
              >
                <Icon className='h-4 w-4' aria-hidden />
                <span>{tab.label}</span>
              </TabsTrigger>
            )
          })}
        </TabsList>

        <div className='text-muted-foreground text-xs'>
          {currentDef.description}
        </div>

        <div className='min-h-0 flex-1'>
          <TabsContent value='overview' className='mt-0'>
            <OverviewSection />
          </TabsContent>
          <TabsContent value='tools' className='mt-0'>
            <ToolsSection />
          </TabsContent>
          <TabsContent value='roles' className='mt-0'>
            <RoleDefaultsSection />
          </TabsContent>
          <TabsContent value='analytics' className='mt-0'>
            <AnalyticsSection />
          </TabsContent>
          <TabsContent value='audit' className='mt-0'>
            <AuditSection />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

export default OmniBeltDashboard

// Created and developed by Jai Singh
