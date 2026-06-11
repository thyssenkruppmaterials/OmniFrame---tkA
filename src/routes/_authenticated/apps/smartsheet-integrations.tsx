// Created and developed by Jai Singh
import { useRef } from 'react'
import { useState, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  IconTable,
  IconRefresh,
  IconPlus,
  IconSettings,
  IconActivity,
  IconCheck,
  IconX,
  IconDatabase,
  IconEdit,
  IconTrash,
  IconDownload,
  IconMessage,
  IconPaperclip,
  IconEye,
  IconUpload,
  IconLink,
  IconMessageCircle,
  IconSend,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
// Import our Smartsheet hooks
import {
  useSmartsheetStatus,
  useSmartsheetDashboardStats,
  useSmartsheetSheets,
  useSmartsheetSheet,
  useSmartsheetSyncJobs,
  useUpdateCells,
  useAddRows,
  useRowAttachments,
  useAttachUrlToRow,
  useUploadFileToRow,
  useUploadFileToComment,
  useGetAttachmentDownloadUrl,
  useDeleteAttachment,
  useRowDiscussions,
  useCreateRowDiscussion,
  useAddCommentToDiscussion,
  useUpdateComment,
  useDeleteComment,
  useDeleteDiscussion,
} from '@/hooks/useSmartsheet'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TabMenu } from '@/components/ui/tab-menu'
import { Textarea } from '@/components/ui/textarea'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const smartsheetIntegrationTabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'sheets', label: 'Sheets Manager' },
  { id: 'connections', label: 'Connections' },
  { id: 'sync', label: 'Data Sync' },
  { id: 'automation', label: 'Automation' },
  { id: 'settings', label: 'Settings' },
]

// Dashboard Component
function SmartsheetDashboard() {
  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useSmartsheetDashboardStats()
  const {
    data: sheets,
    isLoading: sheetsLoading,
    error: sheetsError,
  } = useSmartsheetSheets({ page_size: 10 })
  const { data: syncJobs, isLoading: jobsLoading } = useSmartsheetSyncJobs()
  const status = useSmartsheetStatus()

  const recentSheets = useMemo(() => {
    return sheets?.sheets?.slice(0, 5) || []
  }, [sheets])

  const recentJobs = useMemo(() => {
    return syncJobs?.data?.jobs?.slice(0, 5) || []
  }, [syncJobs])

  if (statsLoading && sheetsLoading) {
    return (
      <div className='space-y-6'>
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <Skeleton className='h-4 w-20' />
                <Skeleton className='h-4 w-4' />
              </CardHeader>
              <CardContent>
                <Skeleton className='mb-1 h-8 w-16' />
                <Skeleton className='h-3 w-24' />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // Show errors but don't prevent the component from rendering
  const hasErrors = statsError || !status.isHealthy

  const dashboardStats = stats?.data?.statistics || {
    total_activities: 0,
    successful_activities: 0,
    unique_sheets_accessed: 0,
    active_connections: 0,
    recent_sync_jobs: 0,
  }

  return (
    <div className='space-y-6'>
      {/* Status Alert - only show if there are actual errors */}
      {hasErrors && (
        <Alert>
          <IconX className='h-4 w-4' />
          <AlertDescription>
            {statsError
              ? `Error loading dashboard: ${statsError.message}`
              : 'Smartsheet service is currently initializing. Please wait...'}
          </AlertDescription>
        </Alert>
      )}

      {/* Statistics Cards */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Total Activities
            </CardTitle>
            <IconActivity className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {dashboardStats.total_activities || 0}
            </div>
            <p className='text-muted-foreground text-xs'>
              {dashboardStats.successful_activities || 0} successful
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Sheets Accessed
            </CardTitle>
            <IconTable className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {dashboardStats.unique_sheets_accessed || 0}
            </div>
            <p className='text-muted-foreground text-xs'>
              Unique sheets this month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Active Connections
            </CardTitle>
            <IconDatabase className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {dashboardStats.active_connections || 1}
            </div>
            <p className='text-muted-foreground text-xs'>
              {status.isHealthy ? 'API Key Configured' : 'Connecting...'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Recent Sync Jobs
            </CardTitle>
            <IconRefresh className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {dashboardStats.recent_sync_jobs || 0}
            </div>
            <p className='text-muted-foreground text-xs'>Past 7 days</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
        {/* Recent Sheets */}
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Recent Sheets</CardTitle>
            <CardDescription>
              Recently accessed Smartsheet sheets
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sheetsLoading ? (
              <div className='space-y-3'>
                {[1, 2, 3].map((i) => (
                  <div key={i} className='flex items-center space-x-3'>
                    <Skeleton className='h-4 w-4' />
                    <Skeleton className='h-4 flex-1' />
                  </div>
                ))}
              </div>
            ) : sheetsError ? (
              <div className='space-y-3'>
                <div className='text-sm text-red-600'>
                  Error loading sheets: {sheetsError.message}
                </div>
                <div className='text-muted-foreground text-xs'>
                  API Key: RJrCudtNnWpz9abrWJfZtPjEKNX8rjI4Derq2 (configured)
                </div>
                <div className='text-muted-foreground text-xs'>
                  Backend Status:{' '}
                  {status.isHealthy ? '✅ Connected' : '❌ Not connected'}
                </div>
              </div>
            ) : recentSheets.length > 0 ? (
              <div className='space-y-3'>
                {recentSheets.map((sheet) => (
                  <div
                    key={sheet.id}
                    className='flex items-center justify-between'
                  >
                    <div className='flex items-center space-x-3'>
                      <IconTable className='text-muted-foreground h-4 w-4' />
                      <div>
                        <p className='text-sm font-medium'>{sheet.name}</p>
                        <p className='text-muted-foreground text-xs'>
                          {sheet.total_row_count
                            ? `${sheet.total_row_count} rows`
                            : 'Sheet'}
                        </p>
                      </div>
                    </div>
                    <Badge variant='outline'>{sheet.access_level}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className='space-y-2'>
                <p className='text-muted-foreground text-sm'>No sheets found</p>
                <div className='text-muted-foreground text-xs'>
                  API Key: RJrCudtNnWpz9abrWJfZtPjEKNX8rjI4Derq2 ✅
                </div>
                <div className='text-muted-foreground text-xs'>
                  Status: {status.isHealthy ? 'Connected' : 'Connecting...'}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Sync Jobs */}
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Sync Jobs</CardTitle>
            <CardDescription>Recent data synchronization jobs</CardDescription>
          </CardHeader>
          <CardContent>
            {jobsLoading ? (
              <div className='space-y-3'>
                {[1, 2, 3].map((i) => (
                  <div key={i} className='flex items-center space-x-3'>
                    <Skeleton className='h-4 w-4' />
                    <Skeleton className='h-4 flex-1' />
                    <Skeleton className='h-6 w-16' />
                  </div>
                ))}
              </div>
            ) : recentJobs.length > 0 ? (
              <div className='space-y-3'>
                {recentJobs.map((job) => (
                  <div
                    key={job.id}
                    className='flex items-center justify-between'
                  >
                    <div className='flex items-center space-x-3'>
                      <IconRefresh className='text-muted-foreground h-4 w-4' />
                      <div>
                        <p className='text-sm font-medium'>{job.job_name}</p>
                        <p className='text-muted-foreground text-xs'>
                          {job.job_type} • {job.records_processed}/
                          {job.records_total} records
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={
                        job.status === 'completed'
                          ? 'default'
                          : job.status === 'failed'
                            ? 'destructive'
                            : job.status === 'running'
                              ? 'secondary'
                              : 'outline'
                      }
                    >
                      {job.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className='text-muted-foreground text-sm'>No sync jobs</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Sheets Manager Component
function SmartsheetSheetsManager() {
  const {
    data: sheets,
    isLoading: sheetsLoading,
    error: sheetsError,
  } = useSmartsheetSheets({ include_all: true })
  const [selectedSheetId, setSelectedSheetId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list')

  // Get detailed sheet data when a sheet is selected
  const {
    data: sheetDetails,
    isLoading: detailsLoading,
    error: detailsError,
  } = useSmartsheetSheet(selectedSheetId!, {
    level: 2, // Include rows and columns
    enabled: !!selectedSheetId && viewMode === 'detail',
  })

  const handleSheetSelect = (sheetId: number) => {
    setSelectedSheetId(sheetId)
    setViewMode('detail')
  }

  const handleBackToList = () => {
    setSelectedSheetId(null)
    setViewMode('list')
  }

  // Test with specific sheet ID 6008763031965572
  const testSheetId = 6008763031965572
  const {
    data: testSheet,
    isLoading: testLoading,
    error: testError,
  } = useSmartsheetSheet(testSheetId, {
    level: 2,
    enabled: true, // Always enabled for testing
  })

  if (viewMode === 'detail' && selectedSheetId) {
    return (
      <div className='space-y-6'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center space-x-4'>
            <Button variant='outline' onClick={handleBackToList}>
              <IconRefresh className='mr-2 h-4 w-4' />
              Back to Sheets List
            </Button>
            <div>
              <h3 className='text-lg font-semibold'>Sheet Details</h3>
              <p className='text-muted-foreground'>
                Viewing sheet ID: {selectedSheetId}
              </p>
            </div>
          </div>
        </div>

        {detailsLoading ? (
          <Card>
            <CardContent className='p-6'>
              <div className='flex items-center space-x-2'>
                <IconRefresh className='h-4 w-4 animate-spin' />
                <span>Loading sheet details...</span>
              </div>
            </CardContent>
          </Card>
        ) : detailsError ? (
          <Alert>
            <IconX className='h-4 w-4' />
            <AlertDescription>
              Error loading sheet details: {detailsError.message}
            </AlertDescription>
          </Alert>
        ) : sheetDetails?.sheet ? (
          <div className='space-y-6'>
            {/* Sheet Info */}
            <Card>
              <CardHeader>
                <CardTitle>{sheetDetails.sheet.name}</CardTitle>
                <CardDescription>
                  {sheetDetails.sheet.total_row_count || 0} rows •{' '}
                  {sheetDetails.sheet.columns?.length || 0} columns
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className='grid grid-cols-2 gap-4 text-sm md:grid-cols-4'>
                  <div>
                    <span className='font-medium'>Access Level:</span>
                    <p className='text-muted-foreground'>
                      {sheetDetails.sheet.access_level}
                    </p>
                  </div>
                  <div>
                    <span className='font-medium'>Created:</span>
                    <p className='text-muted-foreground'>
                      {sheetDetails.sheet.created_at
                        ? new Date(
                            sheetDetails.sheet.created_at
                          ).toLocaleDateString()
                        : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className='font-medium'>Modified:</span>
                    <p className='text-muted-foreground'>
                      {sheetDetails.sheet.modified_at
                        ? new Date(
                            sheetDetails.sheet.modified_at
                          ).toLocaleDateString()
                        : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className='font-medium'>Version:</span>
                    <p className='text-muted-foreground'>
                      {sheetDetails.sheet.version || 'N/A'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Columns */}
            {sheetDetails.sheet.columns &&
              sheetDetails.sheet.columns.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      Columns ({sheetDetails.sheet.columns.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className='overflow-x-auto'>
                      <table className='w-full text-sm'>
                        <thead>
                          <tr className='border-b'>
                            <th className='p-2 text-left'>Index</th>
                            <th className='p-2 text-left'>Title</th>
                            <th className='p-2 text-left'>Type</th>
                            <th className='p-2 text-left'>Primary</th>
                            <th className='p-2 text-left'>Width</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheetDetails.sheet.columns.map((column, index) => (
                            <tr key={column.id || index} className='border-b'>
                              <td className='p-2'>{column.index ?? index}</td>
                              <td className='p-2 font-medium'>
                                {column.title}
                              </td>
                              <td className='p-2'>{column.type}</td>
                              <td className='p-2'>
                                {column.primary ? '✓' : ''}
                              </td>
                              <td className='p-2'>{column.width || 'Auto'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

            {/* Rows Data */}
            {sheetDetails.sheet.rows && sheetDetails.sheet.rows.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Data Rows ({sheetDetails.sheet.rows.length})
                  </CardTitle>
                  <CardDescription>
                    Showing first {Math.min(sheetDetails.sheet.rows.length, 10)}{' '}
                    rows
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='overflow-x-auto'>
                    <table className='w-full text-sm'>
                      <thead>
                        <tr className='border-b'>
                          <th className='p-2 text-left'>Row #</th>
                          {sheetDetails.sheet.columns
                            ?.slice(0, 5)
                            .map((column) => (
                              <th
                                key={column.id}
                                className='max-w-32 truncate p-2 text-left'
                              >
                                {column.title}
                              </th>
                            ))}
                          {sheetDetails.sheet.columns &&
                            sheetDetails.sheet.columns.length > 5 && (
                              <th className='p-2 text-left'>...</th>
                            )}
                        </tr>
                      </thead>
                      <tbody>
                        {sheetDetails.sheet.rows
                          .slice(0, 10)
                          .map((row, index) => (
                            <tr key={row.id || index} className='border-b'>
                              <td className='p-2'>
                                {row.row_number || index + 1}
                              </td>
                              {sheetDetails.sheet?.columns
                                ?.slice(0, 5)
                                .map((column) => {
                                  const cell = row.cells?.find(
                                    (cell) => cell.column_id === column.id
                                  )
                                  const cellValue =
                                    cell?.display_value ?? cell?.value ?? '-'
                                  const displayValue =
                                    typeof cellValue === 'object'
                                      ? JSON.stringify(cellValue)
                                      : String(cellValue)
                                  return (
                                    <td
                                      key={column.id}
                                      className='max-w-32 truncate p-2'
                                    >
                                      {displayValue}
                                    </td>
                                  )
                                })}
                              {sheetDetails.sheet?.columns &&
                                sheetDetails.sheet.columns.length > 5 && (
                                  <td className='p-2'>...</td>
                                )}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <Alert>
            <IconX className='h-4 w-4' />
            <AlertDescription>No sheet data available</AlertDescription>
          </Alert>
        )}
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Sheets Manager</h3>
          <p className='text-muted-foreground'>
            View and manage all Smartsheets in your account.
          </p>
        </div>
        <Button
          onClick={() => window.open('https://app.smartsheet.com', '_blank')}
        >
          <IconPlus className='mr-2 h-4 w-4' />
          Open Smartsheet
        </Button>
      </div>

      {/* Test Sheet Operations Section */}
      <TestSheetOperations
        testSheetId={testSheetId}
        testSheet={testSheet}
        testLoading={testLoading}
        testError={testError}
        onViewDetails={() => handleSheetSelect(testSheetId)}
      />

      {/* All Sheets List */}
      <Card>
        <CardHeader>
          <CardTitle>All Sheets</CardTitle>
          <CardDescription>
            All Smartsheets accessible with your API key
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sheetsLoading ? (
            <div className='space-y-3'>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className='flex items-center space-x-3'>
                  <Skeleton className='h-4 w-4' />
                  <Skeleton className='h-4 flex-1' />
                  <Skeleton className='h-6 w-16' />
                </div>
              ))}
            </div>
          ) : sheetsError ? (
            <Alert>
              <IconX className='h-4 w-4' />
              <AlertDescription>
                Error loading sheets: {sheetsError.message}
              </AlertDescription>
            </Alert>
          ) : sheets?.sheets && sheets.sheets.length > 0 ? (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='border-b'>
                    <th className='p-3 text-left'>Name</th>
                    <th className='p-3 text-left'>ID</th>
                    <th className='p-3 text-left'>Access Level</th>
                    <th className='p-3 text-left'>Rows</th>
                    <th className='p-3 text-left'>Modified</th>
                    <th className='p-3 text-left'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.sheets.map((sheet) => (
                    <tr key={sheet.id} className='hover:bg-muted/50 border-b'>
                      <td className='p-3 font-medium'>{sheet.name}</td>
                      <td className='p-3 font-mono text-xs'>{sheet.id}</td>
                      <td className='p-3'>
                        <Badge variant='outline'>{sheet.access_level}</Badge>
                      </td>
                      <td className='p-3'>{sheet.total_row_count || 0}</td>
                      <td className='p-3'>
                        {sheet.modified_at
                          ? new Date(sheet.modified_at).toLocaleDateString()
                          : 'N/A'}
                      </td>
                      <td className='p-3'>
                        <div className='flex items-center space-x-2'>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() => handleSheetSelect(sheet.id)}
                          >
                            View
                          </Button>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() =>
                              window.open(sheet.permalink, '_blank')
                            }
                          >
                            Open in Smartsheet
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className='py-8 text-center'>
              <IconTable className='text-muted-foreground mx-auto mb-4 h-8 w-8' />
              <h3 className='mb-2 text-lg font-semibold'>No Sheets Found</h3>
              <p className='text-muted-foreground mb-4'>
                No Smartsheets are accessible with your current API key.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Connections Component
function SmartsheetConnections() {
  const status = useSmartsheetStatus()

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>
            Smartsheet API Configuration
          </h3>
          <p className='text-muted-foreground'>
            Your Smartsheet API key is configured and ready to use.
          </p>
        </div>
      </div>

      {/* Show current API key status */}
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <CardTitle className='text-base'>API Key Configuration</CardTitle>
            <div className='flex items-center space-x-2'>
              <Badge
                variant={status.isHealthy ? 'default' : 'secondary'}
                className='flex items-center space-x-1'
              >
                {status.isHealthy ? (
                  <IconCheck className='h-3 w-3' />
                ) : (
                  <IconX className='h-3 w-3' />
                )}
                <span>{status.isHealthy ? 'Connected' : 'Connecting...'}</span>
              </Badge>
            </div>
          </div>
          <CardDescription>
            API Key: RJrCudtNnWpz9abrWJfZtPjEKNX8rjI4Derq2
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>
                Status:{' '}
                {status.isHealthy ? 'Active and working' : 'Initializing...'}
              </span>
              {status.user && (
                <span className='text-sm font-medium'>
                  Connected as: {status.user.email}
                </span>
              )}
            </div>

            {status.isHealthy && (
              <div className='text-xs text-green-600'>
                ✅ Your Smartsheet integration is working! You can access your
                sheets in the Dashboard tab.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Advanced connection management (for future use) */}
      <Card>
        <CardHeader>
          <CardTitle>Advanced Connection Management</CardTitle>
          <CardDescription>
            For enterprise deployments with multiple Smartsheet accounts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='text-muted-foreground text-sm'>
            <p>
              Your current setup uses a configured API key for direct access to
              your Smartsheet account.
            </p>
            <p className='mt-2'>
              For advanced multi-account management, additional connection
              features can be configured here in the future.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Placeholder components for other tabs
function SmartsheetDataSync() {
  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Data Synchronization</h3>
          <p className='text-muted-foreground'>
            Configure and monitor data sync between OmniFrame and Smartsheet.
          </p>
        </div>
        <Button>
          <IconPlus className='mr-2 h-4 w-4' />
          New Sync Job
        </Button>
      </div>

      <Card>
        <CardContent className='py-8 text-center'>
          <IconRefresh className='text-muted-foreground mx-auto mb-4 h-8 w-8' />
          <h3 className='mb-2 text-lg font-semibold'>Data Sync Jobs</h3>
          <p className='text-muted-foreground mb-4'>
            Monitor and manage your data synchronization jobs between OmniFrame
            and Smartsheet.
          </p>
          <p className='text-muted-foreground text-sm'>
            Advanced sync functionality will be available once connections are
            configured.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function SmartsheetAutomation() {
  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Integration Automation</h3>
          <p className='text-muted-foreground'>
            Set up automated workflows and triggers for Smartsheet integration.
          </p>
        </div>
        <Button>
          <IconPlus className='mr-2 h-4 w-4' />
          Create Automation
        </Button>
      </div>

      <Card>
        <CardContent className='py-8 text-center'>
          <IconSettings className='text-muted-foreground mx-auto mb-4 h-8 w-8' />
          <h3 className='mb-2 text-lg font-semibold'>Workflow Automation</h3>
          <p className='text-muted-foreground mb-4'>
            Automate repetitive tasks and create intelligent workflows between
            OmniFrame and Smartsheet.
          </p>
          <p className='text-muted-foreground text-sm'>
            Automation features will be enabled once your Smartsheet connections
            are active.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function SmartsheetSettings() {
  return (
    <div className='space-y-6'>
      <div>
        <h3 className='text-lg font-semibold'>Integration Settings</h3>
        <p className='text-muted-foreground'>
          Configure global settings and preferences for Smartsheet integrations.
        </p>
      </div>

      <div className='grid gap-6'>
        <Card>
          <CardHeader>
            <CardTitle>Global Configuration</CardTitle>
            <CardDescription>
              General settings that apply to all Smartsheet integrations
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <p className='text-muted-foreground text-sm'>
              Configuration options for cache settings, rate limiting, and
              default behaviors.
            </p>
            <Button variant='outline'>Configure Settings</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security Settings</CardTitle>
            <CardDescription>
              Manage security and access control for Smartsheet integrations
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <p className='text-muted-foreground text-sm'>
              Configure API token security, access permissions, and audit
              logging.
            </p>
            <Button variant='outline'>Manage Security</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Enhanced Attachment Manager Component
function AttachmentManager({
  sheetId,
  rowId,
  attachments,
  onRefresh,
}: {
  sheetId: number
  rowId: number
  attachments: Array<{
    id: number
    name: string
    mime_type?: string
    size_in_kb?: number
    attachment_type?: string
    created_at?: string
  }>
  onRefresh: () => void
}) {
  const [urlAttachment, setUrlAttachment] = useState({ url: '', name: '' })
  const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const attachUrlMutation = useAttachUrlToRow()
  const uploadFileMutation = useUploadFileToRow()
  const downloadMutation = useGetAttachmentDownloadUrl()
  const deleteMutation = useDeleteAttachment()

  const handleAttachUrl = () => {
    if (!urlAttachment.url || !urlAttachment.name) return
    attachUrlMutation.mutate(
      {
        sheetId,
        rowId,
        url: urlAttachment.url,
        name: urlAttachment.name,
      },
      {
        onSuccess: () => {
          setUrlAttachment({ url: '', name: '' })
          setIsUrlDialogOpen(false)
          onRefresh()
        },
      }
    )
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    uploadFileMutation.mutate(
      {
        sheetId,
        rowId,
        file,
      },
      {
        onSuccess: () => {
          onRefresh()
          if (fileInputRef.current) fileInputRef.current.value = ''
        },
      }
    )
  }

  const handleDownload = (attachmentId: number) => {
    downloadMutation.mutate({ sheetId, attachmentId })
  }

  const handleDelete = (attachmentId: number) => {
    deleteMutation.mutate(
      { sheetId, attachmentId, rowId },
      {
        onSuccess: () => onRefresh(),
      }
    )
  }

  const getFileIcon = (mimeType: string) => {
    if (mimeType?.includes('image')) return '🖼️'
    if (mimeType?.includes('pdf')) return '📄'
    if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel'))
      return '📊'
    if (mimeType?.includes('document') || mimeType?.includes('word'))
      return '📝'
    return '📎'
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-2'>
          <IconPaperclip className='text-muted-foreground h-4 w-4' />
          <span className='text-sm font-medium'>
            Attachments ({attachments?.length || 0})
          </span>
        </div>
        <div className='flex space-x-2'>
          {/* File Upload */}
          <input
            ref={fileInputRef}
            type='file'
            onChange={handleFileUpload}
            className='hidden'
            accept='*/*'
          />
          <Button
            size='sm'
            variant='outline'
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadFileMutation.isPending}
          >
            <IconUpload className='mr-1 h-4 w-4' />
            {uploadFileMutation.isPending ? 'Uploading...' : 'Upload File'}
          </Button>

          {/* URL Attachment Dialog */}
          <Dialog open={isUrlDialogOpen} onOpenChange={setIsUrlDialogOpen}>
            <DialogTrigger asChild>
              <Button size='sm' variant='outline'>
                <IconLink className='mr-1 h-4 w-4' />
                Attach URL
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Attach URL to Row</DialogTitle>
                <DialogDescription>
                  Add a link attachment to this row
                </DialogDescription>
              </DialogHeader>
              <div className='space-y-4'>
                <div>
                  <Label>URL</Label>
                  <Input
                    value={urlAttachment.url}
                    onChange={(e) =>
                      setUrlAttachment({
                        ...urlAttachment,
                        url: e.target.value,
                      })
                    }
                    placeholder='https://example.com/document'
                  />
                </div>
                <div>
                  <Label>Display Name</Label>
                  <Input
                    value={urlAttachment.name}
                    onChange={(e) =>
                      setUrlAttachment({
                        ...urlAttachment,
                        name: e.target.value,
                      })
                    }
                    placeholder='Document Name'
                  />
                </div>
                <div className='flex justify-end space-x-2'>
                  <Button
                    variant='outline'
                    onClick={() => setIsUrlDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAttachUrl}
                    disabled={attachUrlMutation.isPending}
                  >
                    {attachUrlMutation.isPending ? 'Attaching...' : 'Attach'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Attachments List */}
      {attachments && attachments.length > 0 ? (
        <div className='space-y-2'>
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className='bg-muted/30 flex items-center justify-between rounded-lg border p-3'
            >
              <div className='flex items-center space-x-3'>
                <span className='text-lg'>
                  {getFileIcon(attachment.mime_type ?? '')}
                </span>
                <div>
                  <p className='text-sm font-medium'>{attachment.name}</p>
                  <p className='text-muted-foreground text-xs'>
                    {attachment.size_in_kb
                      ? `${attachment.size_in_kb} KB`
                      : 'Link'}{' '}
                    • {attachment.attachment_type}
                    {attachment.created_at &&
                      ` • ${new Date(attachment.created_at).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              <div className='flex space-x-1'>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => handleDownload(attachment.id)}
                  disabled={downloadMutation.isPending}
                  title='Download'
                >
                  <IconDownload className='h-4 w-4' />
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => handleDelete(attachment.id)}
                  disabled={deleteMutation.isPending}
                  className='text-destructive hover:text-destructive'
                  title='Delete'
                >
                  <IconTrash className='h-4 w-4' />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className='text-muted-foreground py-4 text-center text-sm'>
          No attachments yet. Upload a file or attach a URL.
        </p>
      )}
    </div>
  )
}

// Enhanced Discussion Manager Component
function DiscussionManager({
  sheetId,
  rowId,
  discussions,
  onRefresh,
}: {
  sheetId: number
  rowId: number
  discussions: Array<{
    id: number
    title?: string
    comment_count?: number
    comments?: Array<{
      id: number
      text: string
      created_by?: { name?: string; email?: string }
      created_at?: string
      attachments?: Array<{ id: number; name: string }>
    }>
    created_at?: string
  }>
  onRefresh: () => void
}) {
  const [newDiscussion, setNewDiscussion] = useState({ title: '', comment: '' })
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false)
  const [expandedDiscussions, setExpandedDiscussions] = useState<number[]>([])
  const [replyText, setReplyText] = useState<{
    [discussionId: number]: string
  }>({})
  const [editingComment, setEditingComment] = useState<{
    id: number
    text: string
  } | null>(null)
  const commentFileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingCommentId, setUploadingCommentId] = useState<number | null>(
    null
  )

  const createDiscussionMutation = useCreateRowDiscussion()
  const addCommentMutation = useAddCommentToDiscussion()
  const updateCommentMutation = useUpdateComment()
  const deleteCommentMutation = useDeleteComment()
  const deleteDiscussionMutation = useDeleteDiscussion()
  const uploadToCommentMutation = useUploadFileToComment()

  const handleCreateDiscussion = () => {
    if (!newDiscussion.title || !newDiscussion.comment) return
    createDiscussionMutation.mutate(
      {
        sheetId,
        rowId,
        title: newDiscussion.title,
        comment: newDiscussion.comment,
      },
      {
        onSuccess: () => {
          setNewDiscussion({ title: '', comment: '' })
          setIsNewDialogOpen(false)
          onRefresh()
        },
      }
    )
  }

  const handleAddReply = (discussionId: number) => {
    const text = replyText[discussionId]
    if (!text?.trim()) return
    addCommentMutation.mutate(
      {
        sheetId,
        discussionId,
        text,
        rowId,
      },
      {
        onSuccess: () => {
          setReplyText({ ...replyText, [discussionId]: '' })
          onRefresh()
        },
      }
    )
  }

  const handleUpdateComment = () => {
    if (!editingComment) return
    updateCommentMutation.mutate(
      {
        sheetId,
        commentId: editingComment.id,
        text: editingComment.text,
      },
      {
        onSuccess: () => {
          setEditingComment(null)
          onRefresh()
        },
      }
    )
  }

  const handleDeleteComment = (commentId: number) => {
    deleteCommentMutation.mutate(
      { sheetId, commentId },
      {
        onSuccess: () => onRefresh(),
      }
    )
  }

  const handleDeleteDiscussion = (discussionId: number) => {
    deleteDiscussionMutation.mutate(
      { sheetId, discussionId },
      {
        onSuccess: () => onRefresh(),
      }
    )
  }

  const handleCommentFileUpload = (
    event: React.ChangeEvent<HTMLInputElement>,
    commentId: number
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    uploadToCommentMutation.mutate(
      {
        sheetId,
        commentId,
        file,
      },
      {
        onSuccess: () => {
          onRefresh()
          setUploadingCommentId(null)
          if (commentFileInputRef.current)
            commentFileInputRef.current.value = ''
        },
      }
    )
  }

  const toggleDiscussion = (discussionId: number) => {
    setExpandedDiscussions((prev) =>
      prev.includes(discussionId)
        ? prev.filter((id) => id !== discussionId)
        : [...prev, discussionId]
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-2'>
          <IconMessage className='text-muted-foreground h-4 w-4' />
          <span className='text-sm font-medium'>
            Discussions ({discussions?.length || 0})
          </span>
        </div>
        <Dialog open={isNewDialogOpen} onOpenChange={setIsNewDialogOpen}>
          <DialogTrigger asChild>
            <Button size='sm' variant='outline'>
              <IconPlus className='mr-1 h-4 w-4' />
              New Discussion
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Discussion</DialogTitle>
              <DialogDescription>
                Start a discussion on this row
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-4'>
              <div>
                <Label>Title</Label>
                <Input
                  value={newDiscussion.title}
                  onChange={(e) =>
                    setNewDiscussion({
                      ...newDiscussion,
                      title: e.target.value,
                    })
                  }
                  placeholder='Discussion topic'
                />
              </div>
              <div>
                <Label>Initial Comment</Label>
                <Textarea
                  value={newDiscussion.comment}
                  onChange={(e) =>
                    setNewDiscussion({
                      ...newDiscussion,
                      comment: e.target.value,
                    })
                  }
                  placeholder='Write your comment...'
                  rows={3}
                />
              </div>
              <div className='flex justify-end space-x-2'>
                <Button
                  variant='outline'
                  onClick={() => setIsNewDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateDiscussion}
                  disabled={createDiscussionMutation.isPending}
                >
                  {createDiscussionMutation.isPending
                    ? 'Creating...'
                    : 'Create Discussion'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Hidden file input for comment attachments */}
      <input
        ref={commentFileInputRef}
        type='file'
        onChange={(e) =>
          uploadingCommentId && handleCommentFileUpload(e, uploadingCommentId)
        }
        className='hidden'
        accept='*/*'
      />

      {/* Discussions List */}
      {discussions && discussions.length > 0 ? (
        <div className='space-y-3'>
          {discussions.map((discussion) => {
            const isExpanded = expandedDiscussions.includes(discussion.id)

            return (
              <div
                key={discussion.id}
                className='overflow-hidden rounded-lg border'
              >
                {/* Discussion Header */}
                <div
                  className='bg-muted/30 hover:bg-muted/50 flex cursor-pointer items-center justify-between p-3'
                  onClick={() => toggleDiscussion(discussion.id)}
                >
                  <div className='flex items-center space-x-2'>
                    {isExpanded ? (
                      <IconChevronUp className='text-muted-foreground h-4 w-4' />
                    ) : (
                      <IconChevronDown className='text-muted-foreground h-4 w-4' />
                    )}
                    <div>
                      <p className='text-sm font-medium'>
                        {discussion.title || 'Discussion'}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {discussion.comment_count ||
                          discussion.comments?.length ||
                          0}{' '}
                        comments
                        {discussion.created_at &&
                          ` • ${new Date(discussion.created_at).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteDiscussion(discussion.id)
                    }}
                    disabled={deleteDiscussionMutation.isPending}
                    className='text-destructive hover:text-destructive'
                    title='Delete Discussion'
                  >
                    <IconTrash className='h-4 w-4' />
                  </Button>
                </div>

                {/* Comments (Expanded) */}
                {isExpanded && (
                  <div className='space-y-3 border-t p-3'>
                    {discussion.comments?.map((comment) => (
                      <div
                        key={comment.id}
                        className='border-primary/20 space-y-2 border-l-2 pl-4'
                      >
                        {editingComment?.id === comment.id && editingComment ? (
                          <div className='space-y-2'>
                            <Textarea
                              value={editingComment.text}
                              onChange={(e) =>
                                setEditingComment({
                                  id: editingComment.id,
                                  text: e.target.value,
                                })
                              }
                              rows={2}
                            />
                            <div className='flex space-x-2'>
                              <Button
                                size='sm'
                                onClick={handleUpdateComment}
                                disabled={updateCommentMutation.isPending}
                              >
                                {updateCommentMutation.isPending
                                  ? 'Saving...'
                                  : 'Save'}
                              </Button>
                              <Button
                                size='sm'
                                variant='outline'
                                onClick={() => setEditingComment(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className='text-sm'>{comment.text}</p>
                            <div className='flex items-center justify-between'>
                              <p className='text-muted-foreground text-xs'>
                                {comment.created_by?.name ||
                                  comment.created_by?.email ||
                                  'Unknown'}
                                {comment.created_at &&
                                  ` • ${new Date(comment.created_at).toLocaleString()}`}
                              </p>
                              <div className='flex space-x-1'>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  onClick={() => {
                                    setUploadingCommentId(comment.id)
                                    commentFileInputRef.current?.click()
                                  }}
                                  disabled={uploadToCommentMutation.isPending}
                                  title='Attach file to comment'
                                >
                                  <IconPaperclip className='h-3 w-3' />
                                </Button>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  onClick={() =>
                                    setEditingComment({
                                      id: comment.id,
                                      text: comment.text,
                                    })
                                  }
                                  title='Edit'
                                >
                                  <IconEdit className='h-3 w-3' />
                                </Button>
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  onClick={() =>
                                    handleDeleteComment(comment.id)
                                  }
                                  disabled={deleteCommentMutation.isPending}
                                  className='text-destructive hover:text-destructive'
                                  title='Delete'
                                >
                                  <IconTrash className='h-3 w-3' />
                                </Button>
                              </div>
                            </div>
                            {/* Comment Attachments */}
                            {comment.attachments &&
                              comment.attachments.length > 0 && (
                                <div className='mt-2 flex flex-wrap gap-2'>
                                  {comment.attachments.map((att) => (
                                    <Badge
                                      key={att.id}
                                      variant='secondary'
                                      className='text-xs'
                                    >
                                      📎 {att.name}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                          </>
                        )}
                      </div>
                    ))}

                    {/* Reply Input */}
                    <div className='mt-3 flex space-x-2'>
                      <Input
                        value={replyText[discussion.id] || ''}
                        onChange={(e) =>
                          setReplyText({
                            ...replyText,
                            [discussion.id]: e.target.value,
                          })
                        }
                        placeholder='Write a reply...'
                        className='flex-1'
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleAddReply(discussion.id)
                          }
                        }}
                      />
                      <Button
                        size='sm'
                        onClick={() => handleAddReply(discussion.id)}
                        disabled={
                          addCommentMutation.isPending ||
                          !replyText[discussion.id]?.trim()
                        }
                      >
                        <IconSend className='h-4 w-4' />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className='text-muted-foreground py-4 text-center text-sm'>
          No discussions yet. Start a new discussion to collaborate.
        </p>
      )}
    </div>
  )
}

// Test Sheet Operations Component
function TestSheetOperations({
  testSheetId,
  testSheet,
  testLoading,
  testError,
  onViewDetails,
}: {
  testSheetId: number
  testSheet:
    | {
        sheet?: {
          name?: string
          total_row_count?: number
          columns?: Array<{
            id: number
            title: string
            index?: number
            type?: string
            primary?: boolean
            width?: number
          }>
          rows?: Array<{
            id: number
            row_number?: number
            cells?: Array<{
              column_id: number
              value?: unknown
              display_value?: string
            }>
          }>
          access_level?: string
        }
      }
    | undefined
  testLoading: boolean
  testError: Error | null
  onViewDetails: () => void
}) {
  const [editingCell, setEditingCell] = useState<{
    rowId: number
    columnId: number
    currentValue: string
  } | null>(null)
  const [newRowData, setNewRowData] = useState<{ [columnId: number]: string }>(
    {}
  )
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'attachments' | 'discussions'>(
    'attachments'
  )

  // Mutations
  const updateCellsMutation = useUpdateCells()
  const addRowsMutation = useAddRows()

  // Data queries for selected row
  const { data: rowAttachments, refetch: refetchAttachments } =
    useRowAttachments(testSheetId, selectedRowId!, !!selectedRowId)
  const { data: rowDiscussions, refetch: refetchDiscussions } =
    useRowDiscussions(testSheetId, selectedRowId!, !!selectedRowId)

  const handleCellEdit = (
    rowId: number,
    columnId: number,
    currentValue: string
  ) => {
    setEditingCell({ rowId, columnId, currentValue })
  }

  const handleSaveCellEdit = () => {
    if (!editingCell) return

    updateCellsMutation.mutate({
      sheetId: testSheetId,
      rowId: editingCell.rowId,
      cellUpdates: [
        {
          column_id: editingCell.columnId,
          value: editingCell.currentValue,
        },
      ],
    })
    setEditingCell(null)
  }

  const handleAddRow = () => {
    if (!testSheet?.sheet?.columns) return

    const cells = Object.entries(newRowData).map(([columnId, value]) => ({
      column_id: parseInt(columnId),
      value: value,
    }))

    addRowsMutation.mutate({
      sheetId: testSheetId,
      rowsData: [{ cells }],
      location: 'toBottom',
    })
    setNewRowData({})
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center space-x-2'>
          <IconDatabase className='h-5 w-5' />
          <span>Test Sheet Operations</span>
        </CardTitle>
        <CardDescription>
          Testing comprehensive editing, comments, and attachments with sheet
          ID: {testSheetId}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {testLoading ? (
          <div className='flex items-center space-x-2'>
            <IconRefresh className='h-4 w-4 animate-spin' />
            <span>Loading test sheet...</span>
          </div>
        ) : testError ? (
          <Alert>
            <IconX className='h-4 w-4' />
            <AlertDescription>
              Error loading test sheet: {testError.message}
            </AlertDescription>
          </Alert>
        ) : testSheet?.sheet ? (
          <div className='space-y-6'>
            {/* Sheet Info */}
            <div className='flex items-center space-x-2 text-green-600'>
              <IconCheck className='h-4 w-4' />
              <span className='font-medium'>
                Test sheet loaded successfully!
              </span>
            </div>

            <div className='grid grid-cols-2 gap-4 text-sm md:grid-cols-4'>
              <div>
                <span className='font-medium'>Name:</span>
                <p className='text-muted-foreground'>{testSheet.sheet.name}</p>
              </div>
              <div>
                <span className='font-medium'>Rows:</span>
                <p className='text-muted-foreground'>
                  {testSheet.sheet.total_row_count || 0}
                </p>
              </div>
              <div>
                <span className='font-medium'>Columns:</span>
                <p className='text-muted-foreground'>
                  {testSheet.sheet.columns?.length || 0}
                </p>
              </div>
              <div>
                <span className='font-medium'>Access:</span>
                <p className='text-muted-foreground'>
                  {testSheet.sheet.access_level}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className='flex flex-wrap gap-2'>
              <Button variant='outline' onClick={onViewDetails}>
                <IconEye className='mr-2 h-4 w-4' />
                View Details
              </Button>

              {/* Cell Editing Dialog */}
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant='outline'>
                    <IconEdit className='mr-2 h-4 w-4' />
                    Edit Cells
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Cell Value</DialogTitle>
                    <DialogDescription>
                      Click on any cell in the preview table to edit its value
                    </DialogDescription>
                  </DialogHeader>
                  {editingCell && (
                    <div className='space-y-4'>
                      <Label>Cell Value</Label>
                      <Input
                        value={editingCell.currentValue}
                        onChange={(e) =>
                          setEditingCell({
                            ...editingCell,
                            currentValue: e.target.value,
                          })
                        }
                        placeholder='Enter new value'
                      />
                      <div className='flex space-x-2'>
                        <Button
                          onClick={handleSaveCellEdit}
                          disabled={updateCellsMutation.isPending}
                        >
                          {updateCellsMutation.isPending ? 'Saving...' : 'Save'}
                        </Button>
                        <Button
                          variant='outline'
                          onClick={() => setEditingCell(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>

              {/* Add Row Dialog */}
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant='outline'>
                    <IconPlus className='mr-2 h-4 w-4' />
                    Add Row
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Row</DialogTitle>
                    <DialogDescription>
                      Enter values for the new row
                    </DialogDescription>
                  </DialogHeader>
                  <div className='max-h-[60vh] space-y-4 overflow-y-auto'>
                    {testSheet.sheet.columns?.slice(0, 5).map((column) => (
                      <div key={column.id} className='space-y-2'>
                        <Label>{column.title}</Label>
                        <Input
                          value={newRowData[column.id] || ''}
                          onChange={(e) =>
                            setNewRowData({
                              ...newRowData,
                              [column.id]: e.target.value,
                            })
                          }
                          placeholder={`Enter ${column.title}`}
                        />
                      </div>
                    ))}
                    <Button
                      onClick={handleAddRow}
                      disabled={addRowsMutation.isPending}
                      className='w-full'
                    >
                      {addRowsMutation.isPending ? 'Adding...' : 'Add Row'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {/* Interactive Data Table for Editing */}
            {testSheet.sheet.rows && testSheet.sheet.rows.length > 0 && (
              <Card>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-base'>
                    Data Preview & Row Selection
                  </CardTitle>
                  <CardDescription>
                    Click "Select" to manage attachments and discussions for a
                    row
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className='overflow-x-auto'>
                    <table className='w-full text-sm'>
                      <thead>
                        <tr className='bg-muted/50 border-b'>
                          <th className='p-2 text-left font-medium'>Row ID</th>
                          <th className='p-2 text-left font-medium'>Actions</th>
                          {testSheet.sheet.columns
                            ?.slice(0, 4)
                            .map((column) => (
                              <th
                                key={column.id}
                                className='max-w-32 truncate p-2 text-left font-medium'
                              >
                                {column.title}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {testSheet.sheet.rows.slice(0, 5).map((row, index) => (
                          <tr
                            key={row.id || index}
                            className={`hover:bg-muted/30 border-b transition-colors ${
                              selectedRowId === row.id
                                ? 'bg-primary/10 border-primary/30'
                                : ''
                            }`}
                          >
                            <td className='p-2 font-mono text-xs'>{row.id}</td>
                            <td className='p-2'>
                              <Button
                                size='sm'
                                variant={
                                  selectedRowId === row.id
                                    ? 'default'
                                    : 'outline'
                                }
                                onClick={() => setSelectedRowId(row.id)}
                              >
                                {selectedRowId === row.id
                                  ? 'Selected'
                                  : 'Select'}
                              </Button>
                            </td>
                            {testSheet.sheet?.columns
                              ?.slice(0, 4)
                              .map((column) => {
                                const cell = row.cells?.find(
                                  (c) => c.column_id === column.id
                                )
                                const cellValue =
                                  cell?.display_value || cell?.value || '-'

                                return (
                                  <td
                                    key={column.id}
                                    className='max-w-32 cursor-pointer truncate p-2 hover:bg-blue-50 dark:hover:bg-blue-950'
                                    onClick={() =>
                                      handleCellEdit(
                                        row.id,
                                        column.id,
                                        String(cellValue)
                                      )
                                    }
                                    title='Click to edit'
                                  >
                                    {String(cellValue)}
                                  </td>
                                )
                              })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Row-specific Operations - Comments & Attachments */}
            {selectedRowId && (
              <Card className='border-primary/20 border-2'>
                <CardHeader className='pb-3'>
                  <div className='flex items-center justify-between'>
                    <div>
                      <CardTitle className='flex items-center space-x-2 text-base'>
                        <IconMessageCircle className='h-5 w-5' />
                        <span>
                          Row {selectedRowId} - Comments & Attachments
                        </span>
                      </CardTitle>
                      <CardDescription>
                        Manage attachments and discussions for this row
                      </CardDescription>
                    </div>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => setSelectedRowId(null)}
                    >
                      <IconX className='h-4 w-4' />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className='space-y-4'>
                  {/* Tabs for Attachments/Discussions */}
                  <div className='flex space-x-1 border-b'>
                    <button
                      onClick={() => setActiveTab('attachments')}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'attachments'
                          ? 'border-primary text-primary border-b-2'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <IconPaperclip className='mr-1 inline h-4 w-4' />
                      Attachments
                    </button>
                    <button
                      onClick={() => setActiveTab('discussions')}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'discussions'
                          ? 'border-primary text-primary border-b-2'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <IconMessage className='mr-1 inline h-4 w-4' />
                      Discussions
                    </button>
                  </div>

                  {/* Tab Content */}
                  <div className='pt-2'>
                    {activeTab === 'attachments' ? (
                      <AttachmentManager
                        sheetId={testSheetId}
                        rowId={selectedRowId}
                        attachments={rowAttachments?.attachments || []}
                        onRefresh={() => refetchAttachments()}
                      />
                    ) : (
                      <DiscussionManager
                        sheetId={testSheetId}
                        rowId={selectedRowId}
                        discussions={rowDiscussions?.discussions || []}
                        onRefresh={() => refetchDiscussions()}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <Alert>
            <IconX className='h-4 w-4' />
            <AlertDescription>No test sheet data available</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

function SmartsheetIntegrations() {
  const [activeTab, setActiveTab] = useTabSearchParam('dashboard')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <SmartsheetDashboard />
      case 'sheets':
        return <SmartsheetSheetsManager />
      case 'connections':
        return <SmartsheetConnections />
      case 'sync':
        return <SmartsheetDataSync />
      case 'automation':
        return <SmartsheetAutomation />
      case 'settings':
        return <SmartsheetSettings />
      default:
        return <SmartsheetDashboard />
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

      <Main>
        <div className='mb-2 flex flex-wrap items-center justify-between space-y-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              Smartsheet Integrations
            </h2>
            <p className='text-muted-foreground'>
              Manage Smartsheet integrations and data synchronization.
            </p>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={smartsheetIntegrationTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='smartsheet_integrations'
            fallbackTab='dashboard'
          />

          <div className='bg-background rounded-lg border p-6'>
            {renderTabContent()}
          </div>
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute(
  '/_authenticated/apps/smartsheet-integrations'
)({
  beforeLoad: createStandardProtectedRoute('SMARTSHEET_INTEGRATIONS'),
  component: SmartsheetIntegrations,
})

// Created and developed by Jai Singh
