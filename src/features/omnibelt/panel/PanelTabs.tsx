// Created and developed by Jai Singh
/**
 * OmniBelt — Panel tab strip
 *
 * Four tabs per spec §6.1 / §11:
 *   - Pinned   — `useResolvedTools().pinned` (or first 8 when empty)
 *   - All      — every surviving tool
 *   - Recent   — placeholder until P5 wires telemetry
 *   - Running  — placeholder until P5 wires Mach 3 active jobs
 *
 * The panel owns the active-tab state and passes it down; this
 * component is purely the tab-strip + content slots.
 */
import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type PanelTabId = 'pinned' | 'all' | 'recent' | 'running'

type PanelTabsProps = {
  value: PanelTabId
  onValueChange: (id: PanelTabId) => void
  pinnedContent: ReactNode
  allContent: ReactNode
  recentContent?: ReactNode
  runningContent?: ReactNode
}

export function PanelTabs({
  value,
  onValueChange,
  pinnedContent,
  allContent,
  recentContent,
  runningContent,
}: PanelTabsProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onValueChange(v as PanelTabId)}
      className='w-full'
    >
      <TabsList className='grid w-full grid-cols-4'>
        <TabsTrigger value='pinned'>Pinned</TabsTrigger>
        <TabsTrigger value='all'>All</TabsTrigger>
        <TabsTrigger value='recent'>Recent</TabsTrigger>
        <TabsTrigger value='running'>Running</TabsTrigger>
      </TabsList>
      <TabsContent value='pinned'>{pinnedContent}</TabsContent>
      <TabsContent value='all'>{allContent}</TabsContent>
      <TabsContent value='recent'>
        {recentContent ?? (
          <PanelEmpty
            title='Recent will appear here'
            body='As you launch tools, the most-used will surface here. (Lights up in P5.)'
          />
        )}
      </TabsContent>
      <TabsContent value='running'>
        {runningContent ?? (
          <PanelEmpty
            title='No running jobs'
            body='Background jobs in flight will show here with cancel controls. (Lights up in P5.)'
          />
        )}
      </TabsContent>
    </Tabs>
  )
}

function PanelEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className='text-muted-foreground flex flex-col items-center justify-center gap-1 px-6 py-12 text-center'>
      <p className='text-sm font-medium'>{title}</p>
      <p className='text-xs'>{body}</p>
    </div>
  )
}

// Created and developed by Jai Singh
