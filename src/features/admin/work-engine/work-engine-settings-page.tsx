// Created and developed by Jai Singh
/**
 * Work Engine Configurability Surface (Phase 0a.4).
 *
 * Three tabs:
 *  - Per Work Type — enable/disable, capacities, abandonment & escalation
 *  - Per Warehouse Overrides — sparse rows; "+ Add" inserts default null override
 *  - Feature Flags — Phase 0.1 + Phase 0a.2 toggles
 *
 * All writes go through `workEngineSettingsService` which enforces manager+
 * via RLS at the database layer; the UI hides write controls when the user
 * does not hold a manager role to avoid jarring 403 responses.
 */
import { useState } from 'react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { useWorkEngineSettings } from '@/hooks/use-work-engine-settings'
import { Card } from '@/components/ui/card'
import { FeatureFlagsTab } from './feature-flags-tab'
import { PerWarehouseOverridesTab } from './per-warehouse-overrides-tab'
import { PerWorkTypeTab } from './per-work-type-tab'

type TabId = 'work-types' | 'warehouse-overrides' | 'flags'

export function WorkEngineSettingsPage() {
  const { authState } = useUnifiedAuth()
  const orgId = authState.profile?.organization_id ?? null
  const { engine, types, overrides, isLoading, refresh } =
    useWorkEngineSettings(orgId)
  const [tab, setTab] = useState<TabId>('work-types')

  if (isLoading) {
    return (
      <Card className='p-6'>
        <div className='text-muted-foreground text-sm'>
          Loading work engine settings…
        </div>
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>Work Engine</h1>
        <p className='text-muted-foreground text-sm'>
          Per-org control plane for the polymorphic work-distribution engine.
          Changes propagate to the Rust dispatcher and supervisor surfaces in
          under a minute via <code>LISTEN work_engine_settings_changed</code>.
        </p>
      </div>

      <div className='flex flex-wrap gap-2 border-b'>
        <TabButton
          active={tab === 'work-types'}
          onClick={() => setTab('work-types')}
        >
          Per Work Type
        </TabButton>
        <TabButton
          active={tab === 'warehouse-overrides'}
          onClick={() => setTab('warehouse-overrides')}
        >
          Warehouse Overrides
        </TabButton>
        <TabButton active={tab === 'flags'} onClick={() => setTab('flags')}>
          Feature Flags
        </TabButton>
      </div>

      {tab === 'work-types' && (
        <PerWorkTypeTab orgId={orgId} types={types} onChange={refresh} />
      )}
      {tab === 'warehouse-overrides' && (
        <PerWarehouseOverridesTab
          orgId={orgId}
          types={types}
          overrides={overrides}
          onChange={refresh}
        />
      )}
      {tab === 'flags' && (
        <FeatureFlagsTab orgId={orgId} engine={engine} onChange={refresh} />
      )}
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground border-transparent'
      }`}
    >
      {children}
    </button>
  )
}

// Created and developed by Jai Singh
