// Created and developed by Jai Singh
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { AgentIdentityTab } from './components/agent-identity-tab'
import { AgentTriggersTab } from './components/agent-triggers-tab'
import { ConfirmTOTab } from './components/confirm-to-tab'
// Tab Components
import { ConnectionTestTab } from './components/connection-test-tab'
import { CreateTOTab } from './components/create-to-tab'
import { GoodsReceiptTab } from './components/goods-receipt-tab'
import { InventoryManagementTab } from './components/inventory-management-tab'
import { OneClickShipTab } from './components/one-click-ship-tab'
import { OpenTOsTab } from './components/open-tos-tab'
import { ScheduledJobsTab } from './components/scheduled-jobs-tab'
import { WarehouseDataTab } from './components/warehouse-data-tab'

// Tabs from `connection-test` through `warehouse-data` are temporarily hidden.
// Their components and routes remain wired up so direct URLs still work.
const SAP_TESTING_TABS = [
  // { id: 'connection-test', label: 'Connection Test' },
  // { id: 'goods-receipt', label: 'Goods Receipt (MIGO)' },
  // { id: 'create-to', label: 'Create TO' },
  // { id: 'confirm-to', label: 'Confirm TO' },
  // { id: 'open-tos', label: 'Open TOs' },
  // { id: 'warehouse-data', label: 'Warehouse Data' },
  { id: 'one-click-ship', label: 'One Click Ship' },
  { id: 'agent-triggers', label: 'Agent Triggers' },
  { id: 'inventory-management', label: 'Inventory Management' },
  // Phase D #14 — recurring SAP automations enqueued by Postgres on a
  // cron schedule and consumed by the on-prem agent like any other job.
  { id: 'scheduled-jobs', label: 'Scheduled Jobs' },
  // 2026-05-09 — `to-history` was removed from the tab list. The
  // entire TO History feature is now a query in the Inventory
  // Management Query Library (`lt24-history`) under WAREHOUSE,
  // rendering a dual-mode Journey/Timeline visualization. Old deep
  // links (`?tab=to-history`) fall through to the `default` branch
  // which lands on `one-click-ship`; the SAP console's TO-number
  // links route through `openToNumberInToHistory` (now switches to
  // `?tab=inventory-management` + writes the
  // `omniframe.inventory_query_handoff.v1` key the receiver in
  // `inventory-management-tab.tsx` consumes on mount). See
  // [[Implementations/Implement-LT24-History-Trail]].
  // Phase 10 (rust-work-service integration plan, 2026-05-07) —
  // agent identity v2 management. Admin registers agents, mints
  // service keys (shown ONCE), revokes leaked / offboarded keys.
  // See `Decisions/ADR-Agent-Identity-V2-Phase10.md`.
  { id: 'agent-setup', label: 'Agent Setup' },
]

/**
 * SAP Testing Page - Admin-only SAP RFC integration testing and operations
 * Supports both ECC (Classic WM) and S/4 HANA (EWM) systems
 */
export function SAPTestingPage() {
  const [activeTab, setActiveTab] = useTabSearchParam('one-click-ship')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'connection-test':
        return <ConnectionTestTab />
      case 'goods-receipt':
        return <GoodsReceiptTab />
      case 'create-to':
        return <CreateTOTab />
      case 'confirm-to':
        return <ConfirmTOTab />
      case 'open-tos':
        return <OpenTOsTab />
      case 'warehouse-data':
        return <WarehouseDataTab />
      case 'one-click-ship':
        return <OneClickShipTab />
      case 'agent-triggers':
        return <AgentTriggersTab />
      case 'inventory-management':
        return <InventoryManagementTab />
      case 'scheduled-jobs':
        return <ScheduledJobsTab />
      case 'agent-setup':
        return <AgentIdentityTab />
      default:
        return <OneClickShipTab />
    }
  }

  return (
    <>
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      {/*
        2026-05-09 — `bg-background min-h-[calc(100svh-4rem)]` extends
        the theme-aware page surface to fit the TALLEST child (e.g.
        the LT24 Timeline view with hundreds of rows). Without this
        Main has no bg and the parent `#content` is `h-svh` (fixed at
        viewport height in `authenticated-layout.tsx`), so when the
        right pane scrolls past the Query Library's sticky height the
        body box ends and the html canvas (default light) bled
        through below — visually appearing as a "dark bg cut off"
        in dark mode (and a slightly different shade in light mode).
        Now Main carries its own `bg-background` AND grows past svh
        with content, so the surface follows the longest column all
        the way down. `bg-background` is the same theme token that
        powers the body gradient (light: oklch(1 0 0), dark:
        oklch(0.205 0 0) — see `src/index.css`), so light/dark modes
        both render correctly. The `-4rem` offset accounts for the
        fixed `<Header>` (`h-16` = 4rem) so the initial fill exactly
        matches the visible content area.
      */}
      <Main className='bg-background min-h-[calc(100svh-4rem)]'>
        <div className='space-y-6'>
          <div className='flex flex-wrap items-center gap-x-6 gap-y-2'>
            <h2 className='text-lg font-semibold tracking-tight whitespace-nowrap'>
              SAP Testing
            </h2>
            <div className='min-w-0 flex-1'>
              <TabMenu
                tabs={SAP_TESTING_TABS}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                pageResource='sap_testing'
                showHiddenTabs={true}
              />
            </div>
          </div>

          <div>{renderTabContent()}</div>
        </div>
      </Main>
    </>
  )
}

// Created and developed by Jai Singh
