/**
 * Position Options Tab Component
 * Manage position types, levels, area types, and departments configuration
 * Created: October 25, 2025
 * Updated: December 25, 2025 - Added Area Types and Departments
 * Updated: December 30, 2025 - Added clickable color picker to color code fields
 */
import { useEffect, useRef, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  AlertCircle,
  Building2,
  Edit,
  Layers,
  Loader2,
  MapPin,
  MoreHorizontal,
  Palette,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type {
  AreaTypeOption,
  DepartmentOption,
} from '@/lib/supabase/area-options.service'
import type {
  PositionTypeOption,
  PositionLevelOption,
} from '@/lib/supabase/position-options.service'
import { logger } from '@/lib/utils/logger'
import { useAreaOptions } from '@/hooks/use-area-options'
import { usePositionOptions } from '@/hooks/use-position-options'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// ===== COLOR PICKER INPUT COMPONENT =====
interface ColorPickerInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function ColorPickerInput({
  value,
  onChange,
  placeholder = '#3b82f6',
}: ColorPickerInputProps) {
  const colorInputRef = useRef<HTMLInputElement>(null)
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
  }

  // Preset color palette for quick selection
  const presetColors = [
    '#3b82f6',
    '#2563eb',
    '#1d4ed8', // Blues
    '#10b981',
    '#059669',
    '#047857', // Greens
    '#f59e0b',
    '#d97706',
    '#b45309', // Ambers
    '#ef4444',
    '#dc2626',
    '#b91c1c', // Reds
    '#8b5cf6',
    '#7c3aed',
    '#6d28d9', // Purples
    '#ec4899',
    '#db2777',
    '#be185d', // Pinks
    '#64748b',
    '#475569',
    '#334155', // Slates
    '#78716c',
    '#57534e',
    '#44403c', // Stones
  ]

  return (
    <div className='flex items-center gap-2'>
      <Input
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className='flex-1'
      />
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type='button'
            className='hover:ring-primary group relative h-10 w-10 flex-shrink-0 cursor-pointer overflow-hidden rounded border transition-all hover:ring-2 hover:ring-offset-2'
            style={{ backgroundColor: value || placeholder }}
            title='Click to pick a color'
          >
            <div className='absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/10'>
              <Palette className='h-4 w-4 text-white opacity-0 drop-shadow-md transition-opacity group-hover:opacity-100' />
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent className='w-64 p-3' align='end'>
          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <span className='text-sm font-medium'>Color Picker</span>
              <div
                className='h-6 w-6 rounded border'
                style={{ backgroundColor: value || placeholder }}
              />
            </div>

            {/* Native color picker */}
            <div className='flex items-center gap-2'>
              <input
                ref={colorInputRef}
                type='color'
                value={value || placeholder}
                onChange={handleColorChange}
                className='h-10 w-full cursor-pointer rounded border-0'
                style={{ padding: 0 }}
              />
            </div>

            {/* Preset colors grid */}
            <div>
              <span className='text-muted-foreground mb-2 block text-xs'>
                Preset Colors
              </span>
              <div className='grid grid-cols-8 gap-1'>
                {presetColors.map((color) => (
                  <button
                    key={color}
                    type='button'
                    className={`h-6 w-6 cursor-pointer rounded border transition-transform hover:scale-110 ${
                      value?.toLowerCase() === color.toLowerCase()
                        ? 'ring-primary ring-2 ring-offset-1'
                        : 'border-border'
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => {
                      onChange(color)
                      setIsPopoverOpen(false)
                    }}
                    title={color}
                  />
                ))}
              </div>
            </div>

            {/* Current value display */}
            <div className='flex items-center gap-2 border-t pt-2'>
              <span className='text-muted-foreground text-xs'>Current:</span>
              <code className='bg-muted rounded px-2 py-1 text-xs'>
                {value || placeholder}
              </code>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// ===== TYPE OPTION SCHEMA =====
const typeSchema = z.object({
  type_value: z
    .string()
    .min(2, 'Type value must be at least 2 characters')
    .max(100, 'Type value must be less than 100 characters')
    .regex(
      /^[a-z_]+$/,
      'Type value must be lowercase letters and underscores only'
    ),
  type_label: z
    .string()
    .min(2, 'Type label must be at least 2 characters')
    .max(200, 'Type label must be less than 200 characters'),
  description: z.string().optional(),
  color_code: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be valid hex color (e.g., #3b82f6)')
    .optional(),
  is_active: z.boolean().default(true),
})

type TypeFormData = z.infer<typeof typeSchema>

// ===== LEVEL OPTION SCHEMA =====
const levelSchema = z.object({
  level_value: z.coerce
    .number()
    .int()
    .min(1, 'Level must be between 1 and 20')
    .max(20, 'Level must be between 1 and 20'),
  level_label: z
    .string()
    .min(2, 'Level label must be at least 2 characters')
    .max(200, 'Level label must be less than 200 characters'),
  description: z.string().optional(),
  color_code: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be valid hex color (e.g., #3b82f6)')
    .optional(),
  is_active: z.boolean().default(true),
})

type LevelFormData = z.infer<typeof levelSchema>

// ===== AREA TYPE SCHEMA =====
const areaTypeSchema = z.object({
  type_value: z
    .string()
    .min(2, 'Type value must be at least 2 characters')
    .max(100, 'Type value must be less than 100 characters')
    .regex(
      /^[a-z_]+$/,
      'Type value must be lowercase letters and underscores only'
    ),
  type_label: z
    .string()
    .min(2, 'Type label must be at least 2 characters')
    .max(200, 'Type label must be less than 200 characters'),
  description: z.string().optional(),
  color_code: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be valid hex color (e.g., #3b82f6)')
    .optional(),
  is_active: z.boolean().default(true),
})

type AreaTypeFormData = z.infer<typeof areaTypeSchema>

// ===== DEPARTMENT SCHEMA =====
const departmentSchema = z.object({
  department_value: z
    .string()
    .min(2, 'Department value must be at least 2 characters')
    .max(100, 'Department value must be less than 100 characters')
    .regex(
      /^[a-z_]+$/,
      'Department value must be lowercase letters and underscores only'
    ),
  department_label: z
    .string()
    .min(2, 'Department label must be at least 2 characters')
    .max(200, 'Department label must be less than 200 characters'),
  description: z.string().optional(),
  color_code: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be valid hex color (e.g., #3b82f6)')
    .optional(),
  is_active: z.boolean().default(true),
})

type DepartmentFormData = z.infer<typeof departmentSchema>

export function PositionOptionsTab() {
  const {
    positionTypes,
    typesLoading,
    createPositionType,
    updatePositionType,
    deletePositionType,

    positionLevels,
    levelsLoading,
    createPositionLevel,
    updatePositionLevel,
    deletePositionLevel,
  } = usePositionOptions()

  const {
    areaTypes,
    areaTypesLoading,
    createAreaType,
    updateAreaType,
    deleteAreaType,

    departments,
    departmentsLoading,
    createDepartment,
    updateDepartment,
    deleteDepartment,
  } = useAreaOptions()

  const [typeDialogOpen, setTypeDialogOpen] = useState(false)
  const [levelDialogOpen, setLevelDialogOpen] = useState(false)
  const [areaTypeDialogOpen, setAreaTypeDialogOpen] = useState(false)
  const [departmentDialogOpen, setDepartmentDialogOpen] = useState(false)
  const [editingType, setEditingType] = useState<PositionTypeOption | null>(
    null
  )
  const [editingLevel, setEditingLevel] = useState<PositionLevelOption | null>(
    null
  )
  const [editingAreaType, setEditingAreaType] = useState<AreaTypeOption | null>(
    null
  )
  const [editingDepartment, setEditingDepartment] =
    useState<DepartmentOption | null>(null)
  const [deletingType, setDeletingType] = useState<PositionTypeOption | null>(
    null
  )
  const [deletingLevel, setDeletingLevel] =
    useState<PositionLevelOption | null>(null)
  const [deletingAreaType, setDeletingAreaType] =
    useState<AreaTypeOption | null>(null)
  const [deletingDepartment, setDeletingDepartment] =
    useState<DepartmentOption | null>(null)

  return (
    <div className='space-y-6'>
      <div>
        <h3 className='text-lg font-semibold'>Options Configuration</h3>
        <p className='text-muted-foreground text-sm'>
          Customize position types, levels, area types, and departments for your
          organization
        </p>
      </div>

      <div className='space-y-6'>
        {/* POSITION TYPES SECTION */}
        <Card>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-3'>
                <div className='rounded-lg bg-blue-500/10 p-2'>
                  <Settings2 className='h-5 w-5 text-blue-500' />
                </div>
                <div>
                  <CardTitle>Position Types</CardTitle>
                  <CardDescription>
                    Define the categories of positions in your organization
                    (e.g., Leadership, Operational)
                  </CardDescription>
                </div>
              </div>
              <Button
                onClick={() => {
                  setEditingType(null)
                  setTypeDialogOpen(true)
                }}
              >
                <Plus className='mr-2 h-4 w-4' />
                Add Type
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {typesLoading ? (
              <Alert>
                <AlertDescription>Loading position types...</AlertDescription>
              </Alert>
            ) : positionTypes.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-8 text-center'>
                <Settings2 className='text-muted-foreground mb-4 h-12 w-12' />
                <p className='text-muted-foreground mb-4 text-sm'>
                  No position types defined. Click "Add Type" to create your
                  first position type.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type Value</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='w-[70px]'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positionTypes.map((type) => (
                    <TableRow key={type.id}>
                      <TableCell className='font-mono text-sm'>
                        {type.type_value}
                      </TableCell>
                      <TableCell className='font-medium'>
                        {type.type_label}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-sm'>
                        {type.description || '—'}
                      </TableCell>
                      <TableCell>
                        {type.color_code && (
                          <div className='flex items-center gap-2'>
                            <div
                              className='h-6 w-6 rounded border'
                              style={{ backgroundColor: type.color_code }}
                            />
                            <span className='text-muted-foreground text-xs'>
                              {type.color_code}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={type.is_active ? 'default' : 'secondary'}
                        >
                          {type.is_active ? 'Active' : 'Inactive'}
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
                              onClick={() => {
                                setEditingType(type)
                                setTypeDialogOpen(true)
                              }}
                            >
                              <Edit className='mr-2 h-4 w-4' />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeletingType(type)}
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
            )}
          </CardContent>
        </Card>

        {/* POSITION LEVELS SECTION */}
        <Card>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-3'>
                <div className='rounded-lg bg-purple-500/10 p-2'>
                  <Layers className='h-5 w-5 text-purple-500' />
                </div>
                <div>
                  <CardTitle>Position Levels</CardTitle>
                  <CardDescription>
                    Define the hierarchical levels in your organization (e.g.,
                    L1 - Entry, L2 - Intermediate)
                  </CardDescription>
                </div>
              </div>
              <Button
                onClick={() => {
                  setEditingLevel(null)
                  setLevelDialogOpen(true)
                }}
              >
                <Plus className='mr-2 h-4 w-4' />
                Add Level
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {levelsLoading ? (
              <Alert>
                <AlertDescription>Loading position levels...</AlertDescription>
              </Alert>
            ) : positionLevels.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-8 text-center'>
                <Settings2 className='text-muted-foreground mb-4 h-12 w-12' />
                <p className='text-muted-foreground mb-4 text-sm'>
                  No position levels defined. Click "Add Level" to create your
                  first position level.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Level Value</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='w-[70px]'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positionLevels.map((level) => (
                    <TableRow key={level.id}>
                      <TableCell className='font-mono text-sm'>
                        Level {level.level_value}
                      </TableCell>
                      <TableCell className='font-medium'>
                        {level.level_label}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-sm'>
                        {level.description || '—'}
                      </TableCell>
                      <TableCell>
                        {level.color_code && (
                          <div className='flex items-center gap-2'>
                            <div
                              className='h-6 w-6 rounded border'
                              style={{ backgroundColor: level.color_code }}
                            />
                            <span className='text-muted-foreground text-xs'>
                              {level.color_code}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={level.is_active ? 'default' : 'secondary'}
                        >
                          {level.is_active ? 'Active' : 'Inactive'}
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
                              onClick={() => {
                                setEditingLevel(level)
                                setLevelDialogOpen(true)
                              }}
                            >
                              <Edit className='mr-2 h-4 w-4' />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeletingLevel(level)}
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
            )}
          </CardContent>
        </Card>

        {/* AREA TYPES SECTION */}
        <Card>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-3'>
                <div className='rounded-lg bg-green-500/10 p-2'>
                  <MapPin className='h-5 w-5 text-green-500' />
                </div>
                <div>
                  <CardTitle>Area Types</CardTitle>
                  <CardDescription>
                    Define the types of working areas in your facility (e.g.,
                    Warehouse Zone, Shipping Dock)
                  </CardDescription>
                </div>
              </div>
              <Button
                onClick={() => {
                  setEditingAreaType(null)
                  setAreaTypeDialogOpen(true)
                }}
              >
                <Plus className='mr-2 h-4 w-4' />
                Add Area Type
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {areaTypesLoading ? (
              <Alert>
                <AlertDescription>Loading area types...</AlertDescription>
              </Alert>
            ) : areaTypes.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-8 text-center'>
                <MapPin className='text-muted-foreground mb-4 h-12 w-12' />
                <p className='text-muted-foreground mb-4 text-sm'>
                  No area types defined. Click "Add Area Type" to create your
                  first area type.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type Value</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='w-[70px]'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {areaTypes.map((areaType) => (
                    <TableRow key={areaType.id}>
                      <TableCell className='font-mono text-sm'>
                        {areaType.type_value}
                      </TableCell>
                      <TableCell className='font-medium'>
                        {areaType.type_label}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-sm'>
                        {areaType.description || '—'}
                      </TableCell>
                      <TableCell>
                        {areaType.color_code && (
                          <div className='flex items-center gap-2'>
                            <div
                              className='h-6 w-6 rounded border'
                              style={{ backgroundColor: areaType.color_code }}
                            />
                            <span className='text-muted-foreground text-xs'>
                              {areaType.color_code}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={areaType.is_active ? 'default' : 'secondary'}
                        >
                          {areaType.is_active ? 'Active' : 'Inactive'}
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
                              onClick={() => {
                                setEditingAreaType(areaType)
                                setAreaTypeDialogOpen(true)
                              }}
                            >
                              <Edit className='mr-2 h-4 w-4' />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeletingAreaType(areaType)}
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
            )}
          </CardContent>
        </Card>

        {/* DEPARTMENTS SECTION */}
        <Card>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-3'>
                <div className='rounded-lg bg-orange-500/10 p-2'>
                  <Building2 className='h-5 w-5 text-orange-500' />
                </div>
                <div>
                  <CardTitle>Departments</CardTitle>
                  <CardDescription>
                    Define the departments in your organization (e.g.,
                    Operations, Shipping, Quality)
                  </CardDescription>
                </div>
              </div>
              <Button
                onClick={() => {
                  setEditingDepartment(null)
                  setDepartmentDialogOpen(true)
                }}
              >
                <Plus className='mr-2 h-4 w-4' />
                Add Department
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {departmentsLoading ? (
              <Alert>
                <AlertDescription>Loading departments...</AlertDescription>
              </Alert>
            ) : departments.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-8 text-center'>
                <Building2 className='text-muted-foreground mb-4 h-12 w-12' />
                <p className='text-muted-foreground mb-4 text-sm'>
                  No departments defined. Click "Add Department" to create your
                  first department.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department Value</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='w-[70px]'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {departments.map((dept) => (
                    <TableRow key={dept.id}>
                      <TableCell className='font-mono text-sm'>
                        {dept.department_value}
                      </TableCell>
                      <TableCell className='font-medium'>
                        {dept.department_label}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-sm'>
                        {dept.description || '—'}
                      </TableCell>
                      <TableCell>
                        {dept.color_code && (
                          <div className='flex items-center gap-2'>
                            <div
                              className='h-6 w-6 rounded border'
                              style={{ backgroundColor: dept.color_code }}
                            />
                            <span className='text-muted-foreground text-xs'>
                              {dept.color_code}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={dept.is_active ? 'default' : 'secondary'}
                        >
                          {dept.is_active ? 'Active' : 'Inactive'}
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
                              onClick={() => {
                                setEditingDepartment(dept)
                                setDepartmentDialogOpen(true)
                              }}
                            >
                              <Edit className='mr-2 h-4 w-4' />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeletingDepartment(dept)}
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* DIALOGS */}
      <TypeFormDialog
        open={typeDialogOpen}
        onOpenChange={setTypeDialogOpen}
        editingType={editingType}
        onCreate={async (data) => {
          await createPositionType(
            data as Omit<
              PositionTypeOption,
              'id' | 'created_at' | 'updated_at' | 'created_by'
            >
          )
        }}
        onUpdate={async (params) => {
          await updatePositionType(params)
        }}
      />

      <LevelFormDialog
        open={levelDialogOpen}
        onOpenChange={setLevelDialogOpen}
        editingLevel={editingLevel}
        onCreate={async (data) => {
          await createPositionLevel(
            data as Omit<
              PositionLevelOption,
              'id' | 'created_at' | 'updated_at' | 'created_by'
            >
          )
        }}
        onUpdate={async (params) => {
          await updatePositionLevel(params)
        }}
      />

      <AreaTypeFormDialog
        open={areaTypeDialogOpen}
        onOpenChange={setAreaTypeDialogOpen}
        editingAreaType={editingAreaType}
        onCreate={async (data) => {
          await createAreaType(
            data as Omit<
              AreaTypeOption,
              'id' | 'created_at' | 'updated_at' | 'created_by'
            >
          )
        }}
        onUpdate={async (params) => {
          await updateAreaType(params)
        }}
      />

      <DepartmentFormDialog
        open={departmentDialogOpen}
        onOpenChange={setDepartmentDialogOpen}
        editingDepartment={editingDepartment}
        onCreate={async (data) => {
          await createDepartment(
            data as Omit<
              DepartmentOption,
              'id' | 'created_at' | 'updated_at' | 'created_by'
            >
          )
        }}
        onUpdate={async (params) => {
          await updateDepartment(params)
        }}
      />

      <DeleteTypeDialog
        open={!!deletingType}
        onOpenChange={(open) => !open && setDeletingType(null)}
        type={deletingType}
        onDelete={deletePositionType}
      />

      <DeleteLevelDialog
        open={!!deletingLevel}
        onOpenChange={(open) => !open && setDeletingLevel(null)}
        level={deletingLevel}
        onDelete={deletePositionLevel}
      />

      <DeleteAreaTypeDialog
        open={!!deletingAreaType}
        onOpenChange={(open) => !open && setDeletingAreaType(null)}
        areaType={deletingAreaType}
        onDelete={deleteAreaType}
      />

      <DeleteDepartmentDialog
        open={!!deletingDepartment}
        onOpenChange={(open) => !open && setDeletingDepartment(null)}
        department={deletingDepartment}
        onDelete={deleteDepartment}
      />
    </div>
  )
}

// ===== TYPE FORM DIALOG =====
interface TypeFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingType: PositionTypeOption | null
  onCreate: (data: Record<string, unknown>) => Promise<void>
  onUpdate: (params: {
    id: string
    updates: Record<string, unknown>
  }) => Promise<void>
}

function TypeFormDialog({
  open,
  onOpenChange,
  editingType,
  onCreate,
  onUpdate,
}: TypeFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''

  const form = useForm<TypeFormData>({
    resolver: zodResolver(typeSchema),
    defaultValues: {
      type_value: editingType?.type_value || '',
      type_label: editingType?.type_label || '',
      description: editingType?.description || '',
      color_code: editingType?.color_code || '#3b82f6',
      is_active: editingType?.is_active ?? true,
    },
  })

  // Update form when editing type changes
  useEffect(() => {
    if (editingType) {
      form.reset({
        type_value: editingType.type_value,
        type_label: editingType.type_label,
        description: editingType.description || '',
        color_code: editingType.color_code || '#3b82f6',
        is_active: editingType.is_active,
      })
    } else {
      form.reset({
        type_value: '',
        type_label: '',
        description: '',
        color_code: '#3b82f6',
        is_active: true,
      })
    }
  }, [editingType, form])

  const onSubmit = async (data: TypeFormData) => {
    try {
      setIsSubmitting(true)

      if (editingType) {
        await onUpdate({ id: editingType.id, updates: data })
      } else {
        await onCreate({
          organization_id: organizationId,
          ...data,
          display_order: 0,
        })
      }

      form.reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Error saving position type:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {editingType ? 'Edit Position Type' : 'Add Position Type'}
          </DialogTitle>
          <DialogDescription>
            {editingType
              ? 'Update the position type configuration.'
              : 'Create a new position type for your organization.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='type_value'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type Value *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='operational'
                      {...field}
                      disabled={!!editingType} // Can't change value once created
                    />
                  </FormControl>
                  <FormDescription>
                    Lowercase identifier used in code (e.g., operational,
                    leadership)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='type_label'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Label *</FormLabel>
                  <FormControl>
                    <Input placeholder='Operational' {...field} />
                  </FormControl>
                  <FormDescription>
                    Human-readable name shown in UI
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Description of this position type...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='color_code'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color Code</FormLabel>
                  <FormControl>
                    <ColorPickerInput
                      value={field.value || ''}
                      onChange={field.onChange}
                      placeholder='#3b82f6'
                    />
                  </FormControl>
                  <FormDescription>
                    Hex color code for UI display (e.g., #3b82f6)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='is_active'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Active</FormLabel>
                    <FormDescription>
                      Inactive types won't appear in position creation forms
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  form.reset()
                  onOpenChange(false)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                {editingType ? 'Update Type' : 'Create Type'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ===== LEVEL FORM DIALOG =====
interface LevelFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingLevel: PositionLevelOption | null
  onCreate: (data: Record<string, unknown>) => Promise<void>
  onUpdate: (params: {
    id: string
    updates: Record<string, unknown>
  }) => Promise<void>
}

function LevelFormDialog({
  open,
  onOpenChange,
  editingLevel,
  onCreate,
  onUpdate,
}: LevelFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''

  const form = useForm<LevelFormData>({
    resolver: zodResolver(levelSchema),
    defaultValues: {
      level_value: editingLevel?.level_value || 1,
      level_label: editingLevel?.level_label || '',
      description: editingLevel?.description || '',
      color_code: editingLevel?.color_code || '#64748b',
      is_active: editingLevel?.is_active ?? true,
    },
  })

  // Update form when editing level changes
  useEffect(() => {
    if (editingLevel) {
      form.reset({
        level_value: editingLevel.level_value,
        level_label: editingLevel.level_label,
        description: editingLevel.description || '',
        color_code: editingLevel.color_code || '#64748b',
        is_active: editingLevel.is_active,
      })
    } else {
      form.reset({
        level_value: 1,
        level_label: '',
        description: '',
        color_code: '#64748b',
        is_active: true,
      })
    }
  }, [editingLevel, form])

  const onSubmit = async (data: LevelFormData) => {
    try {
      setIsSubmitting(true)

      if (editingLevel) {
        await onUpdate({ id: editingLevel.id, updates: data })
      } else {
        await onCreate({
          organization_id: organizationId,
          ...data,
          display_order: data.level_value,
        })
      }

      form.reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Error saving position level:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {editingLevel ? 'Edit Position Level' : 'Add Position Level'}
          </DialogTitle>
          <DialogDescription>
            {editingLevel
              ? 'Update the position level configuration.'
              : 'Create a new position level for your organization.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='level_value'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Level Number *</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min='1'
                      max='20'
                      placeholder='1'
                      {...field}
                      disabled={!!editingLevel} // Can't change value once created
                    />
                  </FormControl>
                  <FormDescription>
                    Numeric level (1-20), where higher numbers typically
                    indicate higher seniority
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='level_label'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Label *</FormLabel>
                  <FormControl>
                    <Input placeholder='L1 - Entry' {...field} />
                  </FormControl>
                  <FormDescription>
                    Human-readable name shown in UI (e.g., L1 - Entry, L2 -
                    Intermediate)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Description of this level...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='color_code'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color Code</FormLabel>
                  <FormControl>
                    <ColorPickerInput
                      value={field.value || ''}
                      onChange={field.onChange}
                      placeholder='#64748b'
                    />
                  </FormControl>
                  <FormDescription>
                    Hex color code for UI display (e.g., #64748b)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='is_active'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Active</FormLabel>
                    <FormDescription>
                      Inactive levels won't appear in position creation forms
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  form.reset()
                  onOpenChange(false)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                {editingLevel ? 'Update Level' : 'Create Level'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ===== AREA TYPE FORM DIALOG =====
interface AreaTypeFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingAreaType: AreaTypeOption | null
  onCreate: (data: Record<string, unknown>) => Promise<void>
  onUpdate: (params: {
    id: string
    updates: Record<string, unknown>
  }) => Promise<void>
}

function AreaTypeFormDialog({
  open,
  onOpenChange,
  editingAreaType,
  onCreate,
  onUpdate,
}: AreaTypeFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''

  const form = useForm<AreaTypeFormData>({
    resolver: zodResolver(areaTypeSchema),
    defaultValues: {
      type_value: editingAreaType?.type_value || '',
      type_label: editingAreaType?.type_label || '',
      description: editingAreaType?.description || '',
      color_code: editingAreaType?.color_code || '#10b981',
      is_active: editingAreaType?.is_active ?? true,
    },
  })

  // Update form when editing area type changes
  useEffect(() => {
    if (editingAreaType) {
      form.reset({
        type_value: editingAreaType.type_value,
        type_label: editingAreaType.type_label,
        description: editingAreaType.description || '',
        color_code: editingAreaType.color_code || '#10b981',
        is_active: editingAreaType.is_active,
      })
    } else {
      form.reset({
        type_value: '',
        type_label: '',
        description: '',
        color_code: '#10b981',
        is_active: true,
      })
    }
  }, [editingAreaType, form])

  const onSubmit = async (data: AreaTypeFormData) => {
    try {
      setIsSubmitting(true)

      if (editingAreaType) {
        await onUpdate({ id: editingAreaType.id, updates: data })
      } else {
        await onCreate({
          organization_id: organizationId,
          ...data,
          display_order: 0,
        })
      }

      form.reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Error saving area type:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {editingAreaType ? 'Edit Area Type' : 'Add Area Type'}
          </DialogTitle>
          <DialogDescription>
            {editingAreaType
              ? 'Update the area type configuration.'
              : 'Create a new area type for your organization.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='type_value'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type Value *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='warehouse_zone'
                      {...field}
                      disabled={!!editingAreaType} // Can't change value once created
                    />
                  </FormControl>
                  <FormDescription>
                    Lowercase identifier used in code (e.g., warehouse_zone,
                    shipping_dock)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='type_label'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Label *</FormLabel>
                  <FormControl>
                    <Input placeholder='Warehouse Zone' {...field} />
                  </FormControl>
                  <FormDescription>
                    Human-readable name shown in UI
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Description of this area type...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='color_code'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color Code</FormLabel>
                  <FormControl>
                    <ColorPickerInput
                      value={field.value || ''}
                      onChange={field.onChange}
                      placeholder='#10b981'
                    />
                  </FormControl>
                  <FormDescription>
                    Hex color code for UI display (e.g., #10b981)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='is_active'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Active</FormLabel>
                    <FormDescription>
                      Inactive types won't appear in area creation forms
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  form.reset()
                  onOpenChange(false)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                {editingAreaType ? 'Update Area Type' : 'Create Area Type'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ===== DEPARTMENT FORM DIALOG =====
interface DepartmentFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingDepartment: DepartmentOption | null
  onCreate: (data: Record<string, unknown>) => Promise<void>
  onUpdate: (params: {
    id: string
    updates: Record<string, unknown>
  }) => Promise<void>
}

function DepartmentFormDialog({
  open,
  onOpenChange,
  editingDepartment,
  onCreate,
  onUpdate,
}: DepartmentFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { authState } = useUnifiedAuth()
  const { profile } = authState
  const organizationId = profile?.organization_id || ''

  const form = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
    defaultValues: {
      department_value: editingDepartment?.department_value || '',
      department_label: editingDepartment?.department_label || '',
      description: editingDepartment?.description || '',
      color_code: editingDepartment?.color_code || '#f59e0b',
      is_active: editingDepartment?.is_active ?? true,
    },
  })

  // Update form when editing department changes
  useEffect(() => {
    if (editingDepartment) {
      form.reset({
        department_value: editingDepartment.department_value,
        department_label: editingDepartment.department_label,
        description: editingDepartment.description || '',
        color_code: editingDepartment.color_code || '#f59e0b',
        is_active: editingDepartment.is_active,
      })
    } else {
      form.reset({
        department_value: '',
        department_label: '',
        description: '',
        color_code: '#f59e0b',
        is_active: true,
      })
    }
  }, [editingDepartment, form])

  const onSubmit = async (data: DepartmentFormData) => {
    try {
      setIsSubmitting(true)

      if (editingDepartment) {
        await onUpdate({ id: editingDepartment.id, updates: data })
      } else {
        await onCreate({
          organization_id: organizationId,
          ...data,
          display_order: 0,
        })
      }

      form.reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Error saving department:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {editingDepartment ? 'Edit Department' : 'Add Department'}
          </DialogTitle>
          <DialogDescription>
            {editingDepartment
              ? 'Update the department configuration.'
              : 'Create a new department for your organization.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
            <FormField
              control={form.control}
              name='department_value'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Department Value *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='operations'
                      {...field}
                      disabled={!!editingDepartment} // Can't change value once created
                    />
                  </FormControl>
                  <FormDescription>
                    Lowercase identifier used in code (e.g., operations,
                    shipping)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='department_label'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Label *</FormLabel>
                  <FormControl>
                    <Input placeholder='Operations' {...field} />
                  </FormControl>
                  <FormDescription>
                    Human-readable name shown in UI
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Description of this department...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='color_code'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color Code</FormLabel>
                  <FormControl>
                    <ColorPickerInput
                      value={field.value || ''}
                      onChange={field.onChange}
                      placeholder='#f59e0b'
                    />
                  </FormControl>
                  <FormDescription>
                    Hex color code for UI display (e.g., #f59e0b)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='is_active'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Active</FormLabel>
                    <FormDescription>
                      Inactive departments won't appear in position creation
                      forms
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  form.reset()
                  onOpenChange(false)
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                {editingDepartment ? 'Update Department' : 'Create Department'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ===== DELETE TYPE DIALOG =====
interface DeleteTypeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: PositionTypeOption | null
  onDelete: (id: string) => Promise<void>
}

function DeleteTypeDialog({
  open,
  onOpenChange,
  type,
  onDelete,
}: DeleteTypeDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!type) return

    try {
      setIsDeleting(true)
      await onDelete(type.id)
      onOpenChange(false)
    } catch (error) {
      logger.error('Error deleting type:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  if (!type) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Position Type</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this position type? This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>
            <strong>Warning:</strong> Deleting this type may affect existing
            positions using it. Consider marking it as inactive instead.
          </AlertDescription>
        </Alert>

        <div className='space-y-2 rounded-lg border p-4'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Type Value:</span>
            <span className='font-mono text-sm'>{type.type_value}</span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Label:</span>
            <span className='text-sm'>{type.type_label}</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Delete Type
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===== DELETE LEVEL DIALOG =====
interface DeleteLevelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  level: PositionLevelOption | null
  onDelete: (id: string) => Promise<void>
}

function DeleteLevelDialog({
  open,
  onOpenChange,
  level,
  onDelete,
}: DeleteLevelDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!level) return

    try {
      setIsDeleting(true)
      await onDelete(level.id)
      onOpenChange(false)
    } catch (error) {
      logger.error('Error deleting level:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  if (!level) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Position Level</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this position level? This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>
            <strong>Warning:</strong> Deleting this level may affect existing
            positions using it. Consider marking it as inactive instead.
          </AlertDescription>
        </Alert>

        <div className='space-y-2 rounded-lg border p-4'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Level Value:</span>
            <span className='font-mono text-sm'>Level {level.level_value}</span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Label:</span>
            <span className='text-sm'>{level.level_label}</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Delete Level
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===== DELETE AREA TYPE DIALOG =====
interface DeleteAreaTypeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  areaType: AreaTypeOption | null
  onDelete: (id: string) => Promise<void>
}

function DeleteAreaTypeDialog({
  open,
  onOpenChange,
  areaType,
  onDelete,
}: DeleteAreaTypeDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!areaType) return

    try {
      setIsDeleting(true)
      await onDelete(areaType.id)
      onOpenChange(false)
    } catch (error) {
      logger.error('Error deleting area type:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  if (!areaType) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Area Type</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this area type? This action cannot
            be undone.
          </DialogDescription>
        </DialogHeader>

        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>
            <strong>Warning:</strong> Deleting this type may affect existing
            working areas using it. Consider marking it as inactive instead.
          </AlertDescription>
        </Alert>

        <div className='space-y-2 rounded-lg border p-4'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Type Value:</span>
            <span className='font-mono text-sm'>{areaType.type_value}</span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Label:</span>
            <span className='text-sm'>{areaType.type_label}</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Delete Area Type
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===== DELETE DEPARTMENT DIALOG =====
interface DeleteDepartmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  department: DepartmentOption | null
  onDelete: (id: string) => Promise<void>
}

function DeleteDepartmentDialog({
  open,
  onOpenChange,
  department,
  onDelete,
}: DeleteDepartmentDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!department) return

    try {
      setIsDeleting(true)
      await onDelete(department.id)
      onOpenChange(false)
    } catch (error) {
      logger.error('Error deleting department:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  if (!department) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Department</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this department? This action cannot
            be undone.
          </DialogDescription>
        </DialogHeader>

        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>
            <strong>Warning:</strong> Deleting this department may affect
            existing positions using it. Consider marking it as inactive
            instead.
          </AlertDescription>
        </Alert>

        <div className='space-y-2 rounded-lg border p-4'>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Department Value:</span>
            <span className='font-mono text-sm'>
              {department.department_value}
            </span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-sm font-medium'>Label:</span>
            <span className='text-sm'>{department.department_label}</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Delete Department
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
