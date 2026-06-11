// Created and developed by Jai Singh
/**
 * Labor Standards Tab Component
 * Management interface for labor productivity and quality standards
 * Created: October 25, 2025
 */
import { useMemo, useState } from 'react'
import {
  Award,
  Download,
  Edit,
  MoreHorizontal,
  Plus,
  Search,
  Target,
  Trash2,
  TrendingUp,
  Upload,
} from 'lucide-react'
import type { LaborStandard } from '@/lib/supabase/labor-management.service'
import { useLaborManagement } from '@/hooks/use-labor-management'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddStandardDialog } from './add-standard-dialog'
import { BulkImportStandardsDialog } from './bulk-import-standards-dialog'
import { DeleteStandardDialog } from './delete-standard-dialog'
import { EditStandardDialog } from './edit-standard-dialog'

export function LaborStandardsTab() {
  const { laborStandards, standardsLoading, shiftPositions, workingAreas } =
    useLaborManagement()

  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterScope, setFilterScope] = useState<string>('all')
  const [addStandardOpen, setAddStandardOpen] = useState(false)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [editStandard, setEditStandard] = useState<LaborStandard | null>(null)
  const [deleteStandard, setDeleteStandard] = useState<LaborStandard | null>(
    null
  )

  // Get position and area names for display
  const getPositionName = (positionId?: string) => {
    if (!positionId) return 'All Positions'
    const position = shiftPositions.find(
      (p: { id: string; position_title?: string }) => p.id === positionId
    )
    return position?.position_title || '—'
  }

  const getAreaName = (areaId?: string) => {
    if (!areaId) return 'All Areas'
    const area = workingAreas.find(
      (a: { id: string; area_name?: string }) => a.id === areaId
    )
    return area?.area_name || '—'
  }

  // Filter and search standards
  const filteredStandards = useMemo(() => {
    let filtered = [...laborStandards]

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (standard) =>
          standard.standard_name.toLowerCase().includes(query) ||
          standard.task_type?.toLowerCase().includes(query) ||
          standard.unit_of_measure.toLowerCase().includes(query)
      )
    }

    // Apply type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(
        (standard) => standard.standard_type === filterType
      )
    }

    // Apply scope filter
    if (filterScope !== 'all') {
      if (filterScope === 'position') {
        filtered = filtered.filter(
          (standard) => standard.position_id && !standard.working_area_id
        )
      } else if (filterScope === 'area') {
        filtered = filtered.filter(
          (standard) => standard.working_area_id && !standard.position_id
        )
      } else if (filterScope === 'both') {
        filtered = filtered.filter(
          (standard) => standard.position_id && standard.working_area_id
        )
      } else if (filterScope === 'global') {
        filtered = filtered.filter(
          (standard) => !standard.position_id && !standard.working_area_id
        )
      }
    }

    return filtered
  }, [laborStandards, searchQuery, filterType, filterScope])

  // Calculate statistics
  const stats = useMemo(() => {
    const activeStandards = laborStandards.filter((s) => s.is_active)
    const productivityStandards = activeStandards.filter(
      (s) => s.standard_type === 'productivity'
    )
    const avgProductivityTarget =
      productivityStandards.length > 0
        ? productivityStandards.reduce((sum, s) => sum + s.target_value, 0) /
          productivityStandards.length
        : 0

    const qualityStandards = activeStandards.filter(
      (s) => s.standard_type === 'quality'
    )
    const avgQualityTarget =
      qualityStandards.length > 0
        ? qualityStandards.reduce((sum, s) => sum + s.target_value, 0) /
          qualityStandards.length
        : 0

    return {
      total: laborStandards.length,
      active: activeStandards.length,
      avgProductivityTarget: avgProductivityTarget.toFixed(1),
      avgQualityTarget: avgQualityTarget.toFixed(1),
      byType: {
        productivity: productivityStandards.length,
        quality: qualityStandards.length,
        safety: activeStandards.filter((s) => s.standard_type === 'safety')
          .length,
        accuracy: activeStandards.filter((s) => s.standard_type === 'accuracy')
          .length,
      },
    }
  }, [laborStandards])

  // Export to CSV
  const handleExport = () => {
    const headers = [
      'Standard Name',
      'Type',
      'Task Type',
      'Position',
      'Area',
      'Target Value',
      'Unit',
      'Min Acceptable',
      'Max Acceptable',
      'Excellent',
      'Effective From',
      'Effective To',
      'Status',
    ]

    const rows = filteredStandards.map((standard) => [
      standard.standard_name,
      standard.standard_type,
      standard.task_type || '',
      getPositionName(standard.position_id),
      getAreaName(standard.working_area_id),
      standard.target_value,
      standard.unit_of_measure,
      standard.minimum_acceptable || '',
      standard.maximum_acceptable || '',
      standard.excellent_threshold || '',
      standard.effective_from,
      standard.effective_to || '',
      standard.is_active ? 'Active' : 'Inactive',
    ])

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `labor-standards-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
  }

  return (
    <div className='space-y-4'>
      {/* Header with Actions */}
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Labor Standards Management</h3>
          <p className='text-muted-foreground text-sm'>
            Define productivity, quality, safety, and accuracy standards for
            positions and areas
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setBulkImportOpen(true)}
          >
            <Upload className='mr-2 h-4 w-4' />
            Bulk Import
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={handleExport}
            disabled={filteredStandards.length === 0}
          >
            <Download className='mr-2 h-4 w-4' />
            Export
          </Button>
          <Button onClick={() => setAddStandardOpen(true)}>
            <Plus className='mr-2 h-4 w-4' />
            Add Standard
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Total Standards
            </CardTitle>
            <Target className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>{stats.total}</div>
            <p className='text-muted-foreground text-xs'>
              {stats.active} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>Productivity</CardTitle>
            <TrendingUp className='h-4 w-4 text-blue-600' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {stats.byType.productivity}
            </div>
            <p className='text-muted-foreground text-xs'>
              Avg Target: {stats.avgProductivityTarget}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>Quality</CardTitle>
            <Award className='h-4 w-4 text-green-600' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>{stats.byType.quality}</div>
            <p className='text-muted-foreground text-xs'>
              Avg Target: {stats.avgQualityTarget}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Safety & Accuracy
            </CardTitle>
            <Target className='h-4 w-4 text-orange-600' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {stats.byType.safety + stats.byType.accuracy}
            </div>
            <p className='text-muted-foreground text-xs'>
              {stats.byType.safety} safety, {stats.byType.accuracy} accuracy
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <div className='flex items-center gap-4'>
        <div className='relative flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search standards by name, task type, or unit...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9'
          />
        </div>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className='border-input bg-background ring-offset-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none'
        >
          <option value='all'>All Types</option>
          <option value='productivity'>Productivity</option>
          <option value='quality'>Quality</option>
          <option value='safety'>Safety</option>
          <option value='accuracy'>Accuracy</option>
        </select>

        <select
          value={filterScope}
          onChange={(e) => setFilterScope(e.target.value)}
          className='border-input bg-background ring-offset-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none'
        >
          <option value='all'>All Scopes</option>
          <option value='global'>Global</option>
          <option value='position'>Position-Specific</option>
          <option value='area'>Area-Specific</option>
          <option value='both'>Position & Area</option>
        </select>
      </div>

      {/* Standards Table */}
      {standardsLoading ? (
        <Alert>
          <AlertDescription>Loading labor standards...</AlertDescription>
        </Alert>
      ) : filteredStandards.length === 0 ? (
        <Card>
          <CardContent className='flex flex-col items-center justify-center py-12'>
            <Target className='text-muted-foreground mb-4 h-12 w-12' />
            <h3 className='mb-2 text-lg font-semibold'>
              {laborStandards.length === 0
                ? 'No Labor Standards Defined'
                : 'No Standards Match Filters'}
            </h3>
            <p className='text-muted-foreground mb-4 text-center text-sm'>
              {laborStandards.length === 0
                ? 'Create standards to track productivity, quality, safety, and accuracy targets'
                : 'Try adjusting your search or filter criteria'}
            </p>
            {laborStandards.length === 0 && (
              <Button onClick={() => setAddStandardOpen(true)}>
                <Plus className='mr-2 h-4 w-4' />
                Create First Standard
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Standard Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Position / Area</TableHead>
                  <TableHead className='text-right'>Target</TableHead>
                  <TableHead className='text-right'>Min / Max</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='w-[70px]'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStandards.map((standard) => (
                  <TableRow key={standard.id}>
                    <TableCell className='font-medium'>
                      {standard.standard_name}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          standard.standard_type === 'productivity'
                            ? 'default'
                            : standard.standard_type === 'quality'
                              ? 'secondary'
                              : 'outline'
                        }
                        className='capitalize'
                      >
                        {standard.standard_type}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-muted-foreground'>
                      {standard.task_type || 'All tasks'}
                    </TableCell>
                    <TableCell className='text-sm'>
                      <div>{getPositionName(standard.position_id)}</div>
                      <div className='text-muted-foreground'>
                        {getAreaName(standard.working_area_id)}
                      </div>
                    </TableCell>
                    <TableCell className='text-right font-mono'>
                      <div className='font-semibold'>
                        {standard.target_value}
                      </div>
                      <div className='text-muted-foreground text-xs'>
                        {standard.unit_of_measure}
                      </div>
                    </TableCell>
                    <TableCell className='text-right font-mono text-sm'>
                      <div>{standard.minimum_acceptable || '—'}</div>
                      <div className='text-muted-foreground'>
                        {standard.maximum_acceptable || '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={standard.is_active ? 'default' : 'secondary'}
                      >
                        {standard.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='ghost' size='sm'>
                            <MoreHorizontal className='h-4 w-4' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem
                            onClick={() => setEditStandard(standard)}
                          >
                            <Edit className='mr-2 h-4 w-4' />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteStandard(standard)}
                            className='text-destructive'
                          >
                            <Trash2 className='mr-2 h-4 w-4' />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Filter Summary */}
      {(searchQuery || filterType !== 'all' || filterScope !== 'all') && (
        <div className='text-muted-foreground text-sm'>
          Showing {filteredStandards.length} of {laborStandards.length}{' '}
          standards
          {searchQuery && ` matching "${searchQuery}"`}
        </div>
      )}

      {/* Dialogs */}
      <AddStandardDialog
        open={addStandardOpen}
        onOpenChange={setAddStandardOpen}
      />
      <BulkImportStandardsDialog
        open={bulkImportOpen}
        onOpenChange={setBulkImportOpen}
      />
      <EditStandardDialog
        open={!!editStandard}
        onOpenChange={(open) => !open && setEditStandard(null)}
        standard={editStandard}
      />
      <DeleteStandardDialog
        open={!!deleteStandard}
        onOpenChange={(open) => !open && setDeleteStandard(null)}
        standard={deleteStandard}
      />
    </div>
  )
}

// Created and developed by Jai Singh
