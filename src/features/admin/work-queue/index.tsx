import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { AnalyticsDashboard } from './components/AnalyticsDashboard'
import { ConfigurationPanel } from './components/ConfigurationPanel'
import { QueueOverview } from './components/QueueOverview'
import { TaskManager } from './components/TaskManager'
import { WorkerMonitor } from './components/WorkerMonitor'
import { WorkQueueProvider } from './context/work-queue-context'

/**
 * Main Work Queue Administration Interface
 * Comprehensive admin dashboard for managing the work queue system
 */
export default function WorkQueueAdministration() {
  return (
    <WorkQueueProvider>
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-2 flex flex-wrap items-center justify-between space-y-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              Work Queue Management
            </h2>
            <p className='text-muted-foreground'>
              Monitor and manage the intelligent work queue system. View
              real-time metrics, manage workers, and configure queue behavior.
            </p>
          </div>
        </div>

        <div className='-mx-4 flex-1 overflow-auto px-4 py-1'>
          <Tabs defaultValue='overview' className='space-y-4'>
            <TabsList className='grid w-full grid-cols-5'>
              <TabsTrigger value='overview'>Overview</TabsTrigger>
              <TabsTrigger value='workers'>Workers</TabsTrigger>
              <TabsTrigger value='tasks'>Tasks</TabsTrigger>
              <TabsTrigger value='analytics'>Analytics</TabsTrigger>
              <TabsTrigger value='config'>Configuration</TabsTrigger>
            </TabsList>

            <TabsContent value='overview' className='space-y-4'>
              <QueueOverview />
            </TabsContent>

            <TabsContent value='workers' className='space-y-4'>
              <WorkerMonitor />
            </TabsContent>

            <TabsContent value='tasks' className='space-y-4'>
              <TaskManager />
            </TabsContent>

            <TabsContent value='analytics' className='space-y-4'>
              <AnalyticsDashboard />
            </TabsContent>

            <TabsContent value='config' className='space-y-4'>
              <ConfigurationPanel />
            </TabsContent>
          </Tabs>
        </div>
      </Main>
    </WorkQueueProvider>
  )
}
