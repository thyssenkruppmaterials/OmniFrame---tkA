/**
 * Labor Management Settings Component
 * Comprehensive shift hierarchy and organizational structure management
 * Created: October 19, 2025
 */
import { useMemo, useState } from 'react'
import {
  BarChart3,
  Briefcase,
  Building,
  Download,
  Edit,
  MapPin,
  MoreHorizontal,
  Network,
  Plus,
  Target,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react'
import { Search } from 'lucide-react'
import type {
  ShiftPosition,
  WorkingArea,
  ShiftAssignmentWithDetails,
} from '@/lib/supabase/labor-management.service'
import { useLaborManagement } from '@/hooks/use-labor-management'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import ContentSection from '../components/content-section'
import { AddAreaDialog } from './components/add-area-dialog'
import { AddPositionDialog } from './components/add-position-dialog'
import { AssignUserDialog } from './components/assign-user-dialog'
import { BulkAssignUsersDialog } from './components/bulk-assign-users-dialog'
import { DeleteAreaDialog } from './components/delete-area-dialog'
import { DeleteAssignmentDialog } from './components/delete-assignment-dialog'
import { DeletePositionDialog } from './components/delete-position-dialog'
import { EditAreaDialog } from './components/edit-area-dialog'
import { EditAssignmentDialog } from './components/edit-assignment-dialog'
import { EditPositionDialog } from './components/edit-position-dialog'
import { LaborStandardsTab } from './components/labor-standards-tab'
import { OrgChartTree } from './components/org-chart-tree'
import { PositionOptionsTab } from './components/position-options-tab'

export function LaborManagementSettings() {
  const {
    workingAreas,
    areasLoading,
    areaStats,
    shiftPositions,
    positionsLoading,
    positionStats,
    positionHierarchy,
    shiftAssignments,
    assignmentsLoading,
    organizationalTree,
  } = useLaborManagement()

  const [activeTab, setActiveTab] = useState('overview')
  const [addPositionOpen, setAddPositionOpen] = useState(false)
  const [addAreaOpen, setAddAreaOpen] = useState(false)
  const [assignUserOpen, setAssignUserOpen] = useState(false)
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  const [editPosition, setEditPosition] = useState<ShiftPosition | null>(null)
  const [deletePosition, setDeletePosition] = useState<ShiftPosition | null>(
    null
  )
  const [editArea, setEditArea] = useState<WorkingArea | null>(null)
  const [deleteArea, setDeleteArea] = useState<WorkingArea | null>(null)
  const [editAssignment, setEditAssignment] =
    useState<ShiftAssignmentWithDetails | null>(null)
  const [deleteAssignment, setDeleteAssignment] =
    useState<ShiftAssignmentWithDetails | null>(null)
  const [positionSearch, setPositionSearch] = useState('')
  const [areaSearch, setAreaSearch] = useState('')
  const [assignmentSearch, setAssignmentSearch] = useState('')

  // Filtered data
  const filteredPositions = useMemo(() => {
    if (!positionSearch.trim()) return positionHierarchy
    const query = positionSearch.toLowerCase()
    return positionHierarchy.filter(
      (pos) =>
        pos.position_title?.toLowerCase().includes(query) ||
        pos.position_code?.toLowerCase().includes(query) ||
        pos.department?.toLowerCase().includes(query) ||
        pos.position_type?.toLowerCase().includes(query)
    )
  }, [positionHierarchy, positionSearch])

  const filteredAreas = useMemo(() => {
    if (!areaSearch.trim()) return workingAreas
    const query = areaSearch.toLowerCase()
    return workingAreas.filter(
      (area) =>
        area.area_name.toLowerCase().includes(query) ||
        area.area_code.toLowerCase().includes(query) ||
        area.area_type.toLowerCase().includes(query) ||
        area.description?.toLowerCase().includes(query)
    )
  }, [workingAreas, areaSearch])

  const filteredAssignments = useMemo(() => {
    if (!assignmentSearch.trim()) return shiftAssignments
    const query = assignmentSearch.toLowerCase()
    return shiftAssignments.filter(
      (assignment) =>
        assignment.user_full_name?.toLowerCase().includes(query) ||
        assignment.user_email?.toLowerCase().includes(query) ||
        assignment.position_title?.toLowerCase().includes(query) ||
        assignment.area_name?.toLowerCase().includes(query) ||
        assignment.supervisor_name?.toLowerCase().includes(query)
    )
  }, [shiftAssignments, assignmentSearch])

  // Export functions
  const exportPositions = () => {
    const headers = [
      'Position Code',
      'Position Title',
      'Type',
      'Level',
      'Department',
      'Reports To',
      'Headcount Budget',
      'Current Headcount',
      'Supervisory',
      'Status',
    ]
    const rows = positionHierarchy.map((pos) => [
      pos.position_code,
      pos.position_title,
      pos.position_type,
      pos.position_level,
      pos.department || '',
      pos.reports_to_title || '',
      pos.headcount_budget || 0,
      pos.current_headcount || 0,
      pos.is_supervisory ? 'Yes' : 'No',
      pos.is_active ? 'Active' : 'Inactive',
    ])
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `positions-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
  }

  const exportAreas = () => {
    const headers = [
      'Area Code',
      'Area Name',
      'Type',
      'Capacity',
      'Requires Cert',
      'Status',
    ]
    const rows = workingAreas.map((area) => [
      area.area_code,
      area.area_name,
      area.area_type,
      area.capacity || '',
      area.requires_certification ? 'Yes' : 'No',
      area.is_active ? 'Active' : 'Inactive',
    ])
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `working-areas-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
  }

  const exportAssignments = () => {
    const headers = [
      'Employee Name',
      'Employee Email',
      'Position',
      'Area',
      'Supervisor',
      'Type',
      'Pattern',
      'Status',
      'Start Date',
      'End Date',
    ]
    const rows = shiftAssignments.map((assignment) => [
      assignment.user_full_name || '',
      assignment.user_email || '',
      assignment.position_title || '',
      assignment.area_name || '',
      assignment.supervisor_name || '',
      assignment.assignment_type,
      assignment.shift_pattern,
      assignment.status,
      assignment.start_date,
      assignment.end_date || '',
    ])
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `assignments-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
  }

  return (
    <ContentSection
      title='Labor Management'
      desc='Manage shift hierarchy, positions, working areas, and organizational structure.'
    >
      <>
        <TooltipProvider>
          <div className='space-y-6'>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className='grid w-full grid-cols-7'>
                <TabsTrigger value='overview'>
                  <BarChart3 className='mr-2 h-4 w-4' />
                  Overview
                </TabsTrigger>
                <TabsTrigger value='positions'>
                  <Briefcase className='mr-2 h-4 w-4' />
                  Positions
                </TabsTrigger>
                <TabsTrigger value='areas'>
                  <MapPin className='mr-2 h-4 w-4' />
                  Areas
                </TabsTrigger>
                <TabsTrigger value='assignments'>
                  <UserCog className='mr-2 h-4 w-4' />
                  Assignments
                </TabsTrigger>
                <TabsTrigger value='standards'>
                  <Target className='mr-2 h-4 w-4' />
                  Standards
                </TabsTrigger>
                <TabsTrigger value='options'>
                  <Building className='mr-2 h-4 w-4' />
                  Options
                </TabsTrigger>
                <TabsTrigger value='hierarchy'>
                  <Network className='mr-2 h-4 w-4' />
                  Org Chart
                </TabsTrigger>
              </TabsList>

              {/* OVERVIEW TAB */}
              <TabsContent value='overview' className='space-y-6'>
                <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
                  <Card>
                    <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                      <CardTitle className='text-sm font-medium'>
                        Total Positions
                      </CardTitle>
                      <Briefcase className='text-muted-foreground h-4 w-4' />
                    </CardHeader>
                    <CardContent>
                      <div className='text-2xl font-bold'>
                        {positionStats?.totalPositions || 0}
                      </div>
                      <p className='text-muted-foreground text-xs'>
                        {positionStats?.activePositions || 0} active
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                      <CardTitle className='text-sm font-medium'>
                        Working Areas
                      </CardTitle>
                      <MapPin className='text-muted-foreground h-4 w-4' />
                    </CardHeader>
                    <CardContent>
                      <div className='text-2xl font-bold'>
                        {areaStats?.totalAreas || 0}
                      </div>
                      <p className='text-muted-foreground text-xs'>
                        {areaStats?.activeAreas || 0} active
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                      <CardTitle className='text-sm font-medium'>
                        Total Assignments
                      </CardTitle>
                      <Users className='text-muted-foreground h-4 w-4' />
                    </CardHeader>
                    <CardContent>
                      <div className='text-2xl font-bold'>
                        {shiftAssignments?.length || 0}
                      </div>
                      <p className='text-muted-foreground text-xs'>
                        {positionStats?.actualHeadcount || 0} active workers
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                      <CardTitle className='text-sm font-medium'>
                        Headcount Budget
                      </CardTitle>
                      <Target className='text-muted-foreground h-4 w-4' />
                    </CardHeader>
                    <CardContent>
                      <div className='text-2xl font-bold'>
                        {positionStats?.totalHeadcountBudget || 0}
                      </div>
                      <p className='text-muted-foreground text-xs'>
                        {(
                          ((positionStats?.actualHeadcount || 0) /
                            (positionStats?.totalHeadcountBudget || 1)) *
                          100
                        ).toFixed(0)}
                        % utilized
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Quick Start Guide</CardTitle>
                    <CardDescription>
                      Follow these steps to set up your labor management system
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div className='flex items-start space-x-4'>
                      <div className='bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-full'>
                        1
                      </div>
                      <div>
                        <h4 className='font-semibold'>Define Positions</h4>
                        <p className='text-muted-foreground text-sm'>
                          Create organizational positions like Supervisor, Team
                          Lead, Warehouse Associate, etc.
                        </p>
                      </div>
                    </div>
                    <div className='flex items-start space-x-4'>
                      <div className='bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-full'>
                        2
                      </div>
                      <div>
                        <h4 className='font-semibold'>Create Working Areas</h4>
                        <p className='text-muted-foreground text-sm'>
                          Define physical zones like Receiving Dock, Shipping
                          Area, Quality Lab, etc.
                        </p>
                      </div>
                    </div>
                    <div className='flex items-start space-x-4'>
                      <div className='bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-full'>
                        3
                      </div>
                      <div>
                        <h4 className='font-semibold'>Assign Users</h4>
                        <p className='text-muted-foreground text-sm'>
                          Assign team members to positions and areas with
                          supervisor relationships
                        </p>
                      </div>
                    </div>
                    <div className='flex items-start space-x-4'>
                      <div className='bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-full'>
                        4
                      </div>
                      <div>
                        <h4 className='font-semibold'>View Org Chart</h4>
                        <p className='text-muted-foreground text-sm'>
                          Visualize your complete organizational hierarchy and
                          reporting structure
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* POSITIONS TAB */}
              <TabsContent value='positions' className='space-y-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <h3 className='text-lg font-semibold'>
                      Position Management
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Define organizational positions and their relationships
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={exportPositions}
                      disabled={positionHierarchy.length === 0}
                    >
                      <Download className='mr-2 h-4 w-4' />
                      Export
                    </Button>
                    <Button onClick={() => setAddPositionOpen(true)}>
                      <Plus className='mr-2 h-4 w-4' />
                      Add Position
                    </Button>
                  </div>
                </div>

                {/* Search Bar */}
                <div className='relative'>
                  <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                  <Input
                    placeholder='Search positions by title, code, department, or type...'
                    value={positionSearch}
                    onChange={(e) => setPositionSearch(e.target.value)}
                    className='pl-9'
                  />
                </div>

                {positionsLoading ? (
                  <Alert>
                    <AlertDescription>Loading positions...</AlertDescription>
                  </Alert>
                ) : filteredPositions.length === 0 ? (
                  <Card>
                    <CardContent className='flex flex-col items-center justify-center py-12'>
                      <Briefcase className='text-muted-foreground mb-4 h-12 w-12' />
                      <h3 className='mb-2 text-lg font-semibold'>
                        {shiftPositions.length === 0
                          ? 'No Positions Defined'
                          : 'No Positions Match Search'}
                      </h3>
                      <p className='text-muted-foreground mb-4 text-center text-sm'>
                        {shiftPositions.length === 0
                          ? 'Start by creating positions like Supervisor, Team Lead, or Warehouse Associate'
                          : 'Try adjusting your search criteria'}
                      </p>
                      <Button onClick={() => setAddPositionOpen(true)}>
                        <Plus className='mr-2 h-4 w-4' />
                        Create First Position
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className='p-0'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Position Title</TableHead>
                            <TableHead>Code</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Level</TableHead>
                            <TableHead>Reports To</TableHead>
                            <TableHead>Headcount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className='w-[70px]'>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredPositions.map((position) => {
                            const fullPosition = shiftPositions.find(
                              (p) => p.id === position.position_id
                            )
                            return (
                              <TableRow key={position.position_id}>
                                <TableCell className='font-medium'>
                                  {position.position_title}
                                  {position.is_supervisory && (
                                    <Badge variant='outline' className='ml-2'>
                                      Supervisor
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell>{position.position_code}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      position.position_type === 'leadership'
                                        ? 'default'
                                        : position.position_type ===
                                            'operational'
                                          ? 'secondary'
                                          : 'outline'
                                    }
                                    className='capitalize'
                                  >
                                    {position.position_type}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge variant='secondary'>
                                    L{position.position_level}
                                  </Badge>
                                </TableCell>
                                <TableCell className='text-muted-foreground'>
                                  {position.reports_to_title || '—'}
                                </TableCell>
                                <TableCell>
                                  <Badge variant='outline'>
                                    {position.current_headcount || 0}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      position.is_active
                                        ? 'default'
                                        : 'secondary'
                                    }
                                  >
                                    {position.is_active ? 'Active' : 'Inactive'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant='ghost' size='sm'>
                                            <MoreHorizontal className='h-4 w-4' />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align='end'>
                                          <DropdownMenuItem
                                            onClick={() =>
                                              fullPosition &&
                                              setEditPosition(fullPosition)
                                            }
                                          >
                                            <Edit className='mr-2 h-4 w-4' />
                                            Edit
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() =>
                                              fullPosition &&
                                              setDeletePosition(fullPosition)
                                            }
                                            className='text-destructive'
                                          >
                                            <Trash2 className='mr-2 h-4 w-4' />
                                            Delete
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Position actions</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* WORKING AREAS TAB */}
              <TabsContent value='areas' className='space-y-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <h3 className='text-lg font-semibold'>
                      Working Area Management
                    </h3>
                    <p className='text-muted-foreground text-sm'>
                      Define physical and logical work zones
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={exportAreas}
                      disabled={workingAreas.length === 0}
                    >
                      <Download className='mr-2 h-4 w-4' />
                      Export
                    </Button>
                    <Button onClick={() => setAddAreaOpen(true)}>
                      <Plus className='mr-2 h-4 w-4' />
                      Add Area
                    </Button>
                  </div>
                </div>

                {/* Search Bar */}
                <div className='relative'>
                  <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                  <Input
                    placeholder='Search areas by name, code, type, or description...'
                    value={areaSearch}
                    onChange={(e) => setAreaSearch(e.target.value)}
                    className='pl-9'
                  />
                </div>

                {areasLoading ? (
                  <Alert>
                    <AlertDescription>
                      Loading working areas...
                    </AlertDescription>
                  </Alert>
                ) : filteredAreas.length === 0 ? (
                  <Card>
                    <CardContent className='flex flex-col items-center justify-center py-12'>
                      <MapPin className='text-muted-foreground mb-4 h-12 w-12' />
                      <h3 className='mb-2 text-lg font-semibold'>
                        {workingAreas.length === 0
                          ? 'No Working Areas Defined'
                          : 'No Areas Match Search'}
                      </h3>
                      <p className='text-muted-foreground mb-4 text-center text-sm'>
                        {workingAreas.length === 0
                          ? 'Create work zones like Receiving Dock, Shipping Area, or Quality Lab'
                          : 'Try adjusting your search criteria'}
                      </p>
                      <Button onClick={() => setAddAreaOpen(true)}>
                        <Plus className='mr-2 h-4 w-4' />
                        Create First Area
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className='grid gap-4 md:grid-cols-2'>
                    {filteredAreas.map((area) => (
                      <Card key={area.id}>
                        <CardHeader>
                          <div className='flex items-start justify-between'>
                            <div className='flex-1'>
                              <CardTitle>{area.area_name}</CardTitle>
                              <CardDescription>
                                {area.area_code}
                              </CardDescription>
                            </div>
                            <div className='flex items-center gap-2'>
                              <Badge
                                variant={
                                  area.is_active ? 'default' : 'secondary'
                                }
                              >
                                {area.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant='ghost' size='sm'>
                                    <MoreHorizontal className='h-4 w-4' />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align='end'>
                                  <DropdownMenuItem
                                    onClick={() => setEditArea(area)}
                                  >
                                    <Edit className='mr-2 h-4 w-4' />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => setDeleteArea(area)}
                                    className='text-destructive'
                                  >
                                    <Trash2 className='mr-2 h-4 w-4' />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className='space-y-3'>
                          <div className='flex items-center text-sm'>
                            <Building className='text-muted-foreground mr-2 h-4 w-4' />
                            <span className='capitalize'>
                              {area.area_type.replace('_', ' ')}
                            </span>
                          </div>
                          {area.capacity && (
                            <div className='flex items-center text-sm'>
                              <Users className='text-muted-foreground mr-2 h-4 w-4' />
                              <span>Capacity: {area.capacity} workers</span>
                            </div>
                          )}
                          {area.requires_certification && (
                            <Badge variant='outline' className='text-xs'>
                              Requires Certification
                            </Badge>
                          )}
                          {area.description && (
                            <p className='text-muted-foreground text-sm'>
                              {area.description}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ASSIGNMENTS TAB */}
              <TabsContent value='assignments' className='space-y-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <h3 className='text-lg font-semibold'>User Assignments</h3>
                    <p className='text-muted-foreground text-sm'>
                      Assign team members to positions and working areas
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={exportAssignments}
                      disabled={shiftAssignments.length === 0}
                    >
                      <Download className='mr-2 h-4 w-4' />
                      Export
                    </Button>
                    <Button
                      variant='outline'
                      onClick={() => setBulkAssignOpen(true)}
                    >
                      <Users className='mr-2 h-4 w-4' />
                      Bulk Assign
                    </Button>
                    <Button onClick={() => setAssignUserOpen(true)}>
                      <Plus className='mr-2 h-4 w-4' />
                      Assign User
                    </Button>
                  </div>
                </div>

                {/* Search Bar */}
                <div className='relative'>
                  <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                  <Input
                    placeholder='Search assignments by employee, position, area, or supervisor...'
                    value={assignmentSearch}
                    onChange={(e) => setAssignmentSearch(e.target.value)}
                    className='pl-9'
                  />
                </div>

                {assignmentsLoading ? (
                  <Alert>
                    <AlertDescription>Loading assignments...</AlertDescription>
                  </Alert>
                ) : filteredAssignments.length === 0 ? (
                  <Card>
                    <CardContent className='flex flex-col items-center justify-center py-12'>
                      <UserCog className='text-muted-foreground mb-4 h-12 w-12' />
                      <h3 className='mb-2 text-lg font-semibold'>
                        {shiftAssignments.length === 0
                          ? 'No Assignments Created'
                          : 'No Assignments Match Search'}
                      </h3>
                      <p className='text-muted-foreground mb-4 text-center text-sm'>
                        {shiftAssignments.length === 0
                          ? 'Assign users to positions and working areas to build your team structure'
                          : 'Try adjusting your search criteria'}
                      </p>
                      <Button onClick={() => setAssignUserOpen(true)}>
                        <Plus className='mr-2 h-4 w-4' />
                        Create First Assignment
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className='p-0'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead>Position</TableHead>
                            <TableHead>Working Area</TableHead>
                            <TableHead>Supervisor</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className='w-[70px]'>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredAssignments.map((assignment) => (
                            <TableRow key={assignment.id}>
                              <TableCell>
                                <div>
                                  <div className='font-medium'>
                                    {assignment.user_full_name}
                                  </div>
                                  <div className='text-muted-foreground text-sm'>
                                    {assignment.user_email}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>{assignment.position_title}</TableCell>
                              <TableCell>
                                {assignment.area_name || '—'}
                              </TableCell>
                              <TableCell className='text-muted-foreground'>
                                {assignment.supervisor_name || '—'}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    assignment.assignment_type === 'permanent'
                                      ? 'default'
                                      : assignment.assignment_type ===
                                          'temporary'
                                        ? 'secondary'
                                        : 'outline'
                                  }
                                  className='capitalize'
                                >
                                  {assignment.assignment_type}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    assignment.status === 'active'
                                      ? 'default'
                                      : assignment.status === 'on_leave'
                                        ? 'secondary'
                                        : assignment.status === 'terminated'
                                          ? 'destructive'
                                          : 'outline'
                                  }
                                  className='capitalize'
                                >
                                  {assignment.status.replace('_', ' ')}
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
                                      onClick={() =>
                                        setEditAssignment(assignment)
                                      }
                                    >
                                      <Edit className='mr-2 h-4 w-4' />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setDeleteAssignment(assignment)
                                      }
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
              </TabsContent>

              {/* LABOR STANDARDS TAB */}
              <TabsContent value='standards' className='space-y-4'>
                <LaborStandardsTab />
              </TabsContent>

              {/* POSITION OPTIONS TAB */}
              <TabsContent value='options' className='space-y-4'>
                <PositionOptionsTab />
              </TabsContent>

              {/* ORG CHART TAB */}
              <TabsContent value='hierarchy' className='space-y-4'>
                <div>
                  <h3 className='mb-2 text-lg font-semibold'>
                    Organizational Hierarchy
                  </h3>
                  <p className='text-muted-foreground text-sm'>
                    Visual representation of reporting structure and chain of
                    command. Click on nodes with direct reports to expand or
                    collapse them.
                  </p>
                </div>

                <OrgChartTree data={organizationalTree} />
              </TabsContent>
            </Tabs>

            <Alert className='border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30'>
              <Building className='h-4 w-4 text-blue-600 dark:text-blue-400' />
              <AlertDescription className='text-blue-700 dark:text-blue-300'>
                <strong className='text-blue-800 dark:text-blue-200'>
                  Pro Tip:
                </strong>{' '}
                Start by defining positions with clear reporting relationships,
                then create working areas with supervisors. Area supervisors are
                automatically added to the org chart without needing rate
                tracking for performance. Team members can then be assigned to
                positions and areas.
              </AlertDescription>
            </Alert>
          </div>
        </TooltipProvider>

        {/* Form Modals */}
        <AddPositionDialog
          open={addPositionOpen}
          onOpenChange={setAddPositionOpen}
        />
        <EditPositionDialog
          open={!!editPosition}
          onOpenChange={(open) => !open && setEditPosition(null)}
          position={editPosition}
        />
        <DeletePositionDialog
          open={!!deletePosition}
          onOpenChange={(open) => !open && setDeletePosition(null)}
          position={deletePosition}
        />

        <AddAreaDialog open={addAreaOpen} onOpenChange={setAddAreaOpen} />
        <EditAreaDialog
          open={!!editArea}
          onOpenChange={(open) => !open && setEditArea(null)}
          area={editArea}
        />
        <DeleteAreaDialog
          open={!!deleteArea}
          onOpenChange={(open) => !open && setDeleteArea(null)}
          area={deleteArea}
        />

        <AssignUserDialog
          open={assignUserOpen}
          onOpenChange={setAssignUserOpen}
        />
        <BulkAssignUsersDialog
          open={bulkAssignOpen}
          onOpenChange={setBulkAssignOpen}
        />
        <EditAssignmentDialog
          open={!!editAssignment}
          onOpenChange={(open) => !open && setEditAssignment(null)}
          assignment={editAssignment}
        />
        <DeleteAssignmentDialog
          open={!!deleteAssignment}
          onOpenChange={(open) => !open && setDeleteAssignment(null)}
          assignment={deleteAssignment}
        />
      </>
    </ContentSection>
  )
}
