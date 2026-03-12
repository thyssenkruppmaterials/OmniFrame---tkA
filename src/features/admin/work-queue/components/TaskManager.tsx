/**
 * Task Manager Component
 * Admin interface for creating, editing, prioritizing, and managing work queue tasks
 * Provides comprehensive task lifecycle management
 */
import { useState } from 'react'
import {
  BarChart3,
  CheckCircle,
  Clock,
  Edit,
  MapPin,
  Package,
  Plus,
  Search,
  Trash2,
  User,
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
import { useWorkQueue } from '../context/work-queue-context-simple'

export function TaskManager() {
  const { pendingTasks, assignedTasks } = useWorkQueue()

  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Combine all tasks for display
  const allTasks = [...pendingTasks, ...assignedTasks]

  const filteredTasks = allTasks.filter((task) => {
    const matchesSearch =
      !searchTerm ||
      task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      task.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      task.material_number?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesStatus = statusFilter === 'all' || task.status === statusFilter

    return matchesSearch && matchesStatus
  })

  const handleCreateTask = () => {
    logger.log('Create new task')
    // Would implement task creation dialog
  }

  const handleEditTask = (taskId: string) => {
    logger.log('Edit task:', taskId)
    // Would implement task editing
  }

  const handleDeleteTask = (taskId: string) => {
    logger.log('Delete task:', taskId)
    // Would implement task deletion
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Task Management</h3>
          <p className='text-muted-foreground text-sm'>
            Create, edit, and manage work queue tasks
          </p>
        </div>
        <Button onClick={handleCreateTask}>
          <Plus className='mr-2 h-4 w-4' />
          Create Task
        </Button>
      </div>

      {/* Summary Cards */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-4'>
        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <Clock className='h-4 w-4 text-blue-600' />
              <span className='text-sm font-medium'>Pending</span>
            </div>
            <div className='mt-2 text-2xl font-bold'>{pendingTasks.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <User className='h-4 w-4 text-green-600' />
              <span className='text-sm font-medium'>Assigned</span>
            </div>
            <div className='mt-2 text-2xl font-bold'>
              {assignedTasks.length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <BarChart3 className='h-4 w-4 text-yellow-600' />
              <span className='text-sm font-medium'>In Progress</span>
            </div>
            <div className='mt-2 text-2xl font-bold'>
              {assignedTasks.filter((t) => t.status === 'in_progress').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <CheckCircle className='h-4 w-4 text-green-600' />
              <span className='text-sm font-medium'>Completed Today</span>
            </div>
            <div className='mt-2 text-2xl font-bold'>0</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className='flex items-center space-x-2'>
        <div className='relative'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
          <Input
            placeholder='Search tasks...'
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
          <option value='pending'>Pending</option>
          <option value='assigned'>Assigned</option>
          <option value='in_progress'>In Progress</option>
          <option value='completed'>Completed</option>
        </select>
      </div>

      {/* Tasks Table */}
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className='w-[100px]'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <div>
                      <div className='text-sm font-medium'>{task.title}</div>
                      {task.description && (
                        <div className='text-muted-foreground max-w-[200px] truncate text-xs'>
                          {task.description}
                        </div>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    <Badge variant='outline'>
                      {task.task_type.replace('_', ' ')}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        task.priority >= 80
                          ? 'destructive'
                          : task.priority >= 50
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      P{task.priority}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        task.status === 'completed'
                          ? 'default'
                          : task.status === 'in_progress'
                            ? 'secondary'
                            : task.status === 'failed'
                              ? 'destructive'
                              : 'outline'
                      }
                    >
                      {task.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    {task.assigned_to ? (
                      <div className='flex items-center space-x-1'>
                        <User className='h-3 w-3' />
                        <span className='text-sm'>Assigned</span>
                      </div>
                    ) : (
                      <span className='text-muted-foreground text-xs'>
                        Unassigned
                      </span>
                    )}
                  </TableCell>

                  <TableCell>
                    {task.zone ? (
                      <div className='flex items-center space-x-1'>
                        <MapPin className='h-3 w-3' />
                        <span className='text-sm'>{task.zone}</span>
                      </div>
                    ) : (
                      <span className='text-muted-foreground text-xs'>
                        No location
                      </span>
                    )}
                  </TableCell>

                  <TableCell>
                    <span className='text-xs'>
                      {new Date(task.created_at).toLocaleDateString()}
                    </span>
                  </TableCell>

                  <TableCell>
                    <div className='flex items-center space-x-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleEditTask(task.id)}
                      >
                        <Edit className='h-3 w-3' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleDeleteTask(task.id)}
                      >
                        <Trash2 className='h-3 w-3' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filteredTasks.length === 0 && (
            <div className='py-8 text-center'>
              <Package className='text-muted-foreground mx-auto mb-4 h-12 w-12' />
              <h3 className='mb-2 text-lg font-semibold'>No Tasks Found</h3>
              <p className='text-muted-foreground'>
                {searchTerm || statusFilter !== 'all'
                  ? 'Try adjusting your search or filter criteria'
                  : 'No tasks have been created yet'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
