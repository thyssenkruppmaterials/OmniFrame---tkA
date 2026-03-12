/**
 * Worker Monitor Component
 * Real-time monitoring of worker status, task assignments, and performance
 * Allows admin to view and manage worker allocations
 */
import React, { useState } from 'react'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  MoreHorizontal,
  RefreshCw,
  Search,
  User,
  Users,
} from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { SimpleWorkerProfile } from '../context/work-queue-context-simple'
import { useWorkQueue } from '../context/work-queue-context-simple'

// ============================================================================
// INTERFACES
// ============================================================================

interface WorkerRowProps {
  worker: SimpleWorkerProfile
  onWorkerAction: (workerId: string, action: string) => void
}

// ============================================================================
// WORKER ROW COMPONENT
// ============================================================================

const WorkerRow: React.FC<WorkerRowProps> = ({ worker, onWorkerAction }) => {
  const getStatusBadge = (
    isAvailable: boolean,
    currentTasks: number,
    maxTasks: number
  ) => {
    if (!isAvailable) {
      return <Badge variant='secondary'>Offline</Badge>
    }
    if (currentTasks >= maxTasks) {
      return <Badge variant='destructive'>At Capacity</Badge>
    }
    if (currentTasks > maxTasks * 0.8) {
      return <Badge variant='secondary'>Busy</Badge>
    }
    return <Badge variant='default'>Available</Badge>
  }

  const utilizationPercentage =
    worker.max_concurrent_tasks > 0
      ? Math.round(
          ((worker.current_tasks ?? 0) / worker.max_concurrent_tasks) * 100
        )
      : 0

  return (
    <TableRow>
      <TableCell>
        <div className='flex items-center space-x-3'>
          <div className='flex-shrink-0'>
            <div className='flex h-8 w-8 items-center justify-center rounded-full bg-blue-100'>
              <User className='h-4 w-4 text-blue-600' />
            </div>
          </div>
          <div>
            <div className='text-sm font-medium'>
              {worker.user_profiles?.full_name || 'Unknown Worker'}
            </div>
            <div className='text-muted-foreground text-xs'>
              {worker.current_zone || 'No zone assigned'}
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell>
        {getStatusBadge(
          worker.is_available,
          worker.current_tasks || 0,
          worker.max_concurrent_tasks
        )}
      </TableCell>

      <TableCell>
        <div className='flex items-center space-x-2'>
          <span className='text-sm'>
            {worker.current_tasks || 0}/{worker.max_concurrent_tasks}
          </span>
          <div className='h-2 w-16 rounded-full bg-gray-200'>
            <div
              className='h-2 rounded-full bg-blue-600 transition-all duration-300'
              style={{ width: `${Math.min(100, utilizationPercentage)}%` }}
            />
          </div>
          <span className='text-muted-foreground text-xs'>
            {utilizationPercentage}%
          </span>
        </div>
      </TableCell>

      <TableCell>
        <div className='text-sm'>{worker.tasks_completed_today || 0}</div>
        <div className='text-muted-foreground text-xs'>today</div>
      </TableCell>

      <TableCell>
        <div className='text-sm'>
          {Math.round(worker.productivity_score || 0)}
        </div>
        <div className='text-muted-foreground text-xs'>score</div>
      </TableCell>

      <TableCell>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => onWorkerAction(worker.user_id, 'view_details')}
        >
          <MoreHorizontal className='h-4 w-4' />
        </Button>
      </TableCell>
    </TableRow>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function WorkerMonitor() {
  const { availableWorkers, isLoadingWorkers, refreshWorkers } = useWorkQueue()

  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // ========================================================================
  // FILTERING
  // ========================================================================

  const filteredWorkers = availableWorkers.filter((worker) => {
    const matchesSearch =
      !searchTerm ||
      worker.user_profiles?.full_name
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      worker.current_zone?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'available' && worker.is_available) ||
      (statusFilter === 'offline' && !worker.is_available)

    return matchesSearch && matchesStatus
  })

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleWorkerAction = (workerId: string, action: string) => {
    logger.log(`Worker action: ${action} for ${workerId}`)
    // Would implement specific worker actions
  }

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================

  const workerSummary = {
    total: availableWorkers.length,
    available: availableWorkers.filter((w) => w.is_available).length,
    busy: availableWorkers.filter(
      (w) => w.is_available && (w.current_tasks || 0) > 0
    ).length,
    offline: availableWorkers.filter((w) => !w.is_available).length,
  }

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className='space-y-6'>
      {/* Summary Cards */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-4'>
        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <Users className='h-4 w-4 text-blue-600' />
              <span className='text-sm font-medium'>Total Workers</span>
            </div>
            <div className='mt-2 text-2xl font-bold'>{workerSummary.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <CheckCircle className='h-4 w-4 text-green-600' />
              <span className='text-sm font-medium'>Available</span>
            </div>
            <div className='mt-2 text-2xl font-bold text-green-600'>
              {workerSummary.available}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <Clock className='h-4 w-4 text-yellow-600' />
              <span className='text-sm font-medium'>Busy</span>
            </div>
            <div className='mt-2 text-2xl font-bold text-yellow-600'>
              {workerSummary.busy}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <AlertCircle className='h-4 w-4 text-red-600' />
              <span className='text-sm font-medium'>Offline</span>
            </div>
            <div className='mt-2 text-2xl font-bold text-red-600'>
              {workerSummary.offline}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-2'>
          <div className='relative'>
            <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
            <Input
              placeholder='Search workers...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='w-64 pl-9'
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className='border-input bg-background h-9 rounded-md border px-3 text-sm'
          >
            <option value='all'>All Status</option>
            <option value='available'>Available</option>
            <option value='offline'>Offline</option>
          </select>
        </div>

        <Button
          variant='outline'
          size='sm'
          onClick={refreshWorkers}
          disabled={isLoadingWorkers}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isLoadingWorkers ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {/* Workers Table */}
      <Card>
        <CardHeader>
          <CardTitle>Worker Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Workload</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Performance</TableHead>
                <TableHead className='w-[100px]'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredWorkers.map((worker) => (
                <WorkerRow
                  key={worker.user_id}
                  worker={worker}
                  onWorkerAction={handleWorkerAction}
                />
              ))}
            </TableBody>
          </Table>

          {filteredWorkers.length === 0 && (
            <div className='py-8 text-center'>
              <Users className='text-muted-foreground mx-auto mb-4 h-12 w-12' />
              <h3 className='mb-2 text-lg font-semibold'>No Workers Found</h3>
              <p className='text-muted-foreground'>
                {searchTerm || statusFilter !== 'all'
                  ? 'Try adjusting your search or filter criteria'
                  : 'No workers are currently registered in the system'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
