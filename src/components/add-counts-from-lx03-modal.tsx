// Created and developed by Jai Singh
import React, { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Loader2,
  Package,
  Plus,
  Search,
  User,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { AggregatedLX03Data } from '@/lib/supabase/lx03-data.service'
import { LX03DataService } from '@/lib/supabase/lx03-data.service'
import { logger } from '@/lib/utils/logger'
import { useCountTypeOptions } from '@/hooks/use-count-type-options'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox as CheckboxUI } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUserManagement } from '@/features/user-management/hooks/use-user-management'

interface AddCountsFromLX03ModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (
    counts: Array<{
      material_number: string
      location: string
      warehouse: string | null
      system_quantity: number
      count_type: string
      priority: string
      assigned_to?: string | null
    }>
  ) => Promise<void>
}

type SelectionMode = 'locations' | 'range' | 'parts' | 'empty_bins'

export const AddCountsFromLX03Modal: React.FC<AddCountsFromLX03ModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const { options: countTypeOptions } = useCountTypeOptions()
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('locations')
  const [countType, setCountType] = useState('quantity_check')
  const [priority, setPriority] = useState('normal')
  const [assignedUserId, setAssignedUserId] = useState<string>('')

  // Load users for assignment
  const { users, loading: usersLoading } = useUserManagement()

  // Filter to only active users who can perform counts
  const availableUsers = useMemo(
    () =>
      users.filter(
        (user) => user.status === 'active' && user.role !== 'viewer' // Viewers typically can't perform counts
      ),
    [users]
  )

  // Location selection state
  const [locationInput, setLocationInput] = useState('')
  const [selectedLocations, setSelectedLocations] = useState<string[]>([])
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([])
  const [isSearchingLocations, setIsSearchingLocations] = useState(false)

  // Range selection state
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')

  // Part number selection state
  const [partInput, setPartInput] = useState('')
  const [selectedParts, setSelectedParts] = useState<string[]>([])
  const [partSuggestions, setPartSuggestions] = useState<string[]>([])
  const [isSearchingParts, setIsSearchingParts] = useState(false)

  // Empty bins selection state
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('')
  const [selectedStorageType, setSelectedStorageType] = useState<string>('')
  const [selectedStorageArea, setSelectedStorageArea] = useState<string>('')
  const [availableWarehouses, setAvailableWarehouses] = useState<string[]>([])
  const [availableStorageTypes, setAvailableStorageTypes] = useState<string[]>(
    []
  )
  const [isLoadingFilters, setIsLoadingFilters] = useState(false)

  // Preview state
  const [previewData, setPreviewData] = useState<AggregatedLX03Data[]>([])
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Selection state for preview items
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [selectAll, setSelectAll] = useState(false)

  // Search locations
  const handleLocationSearch = useCallback(async (query: string) => {
    setLocationInput(query)
    if (query.length < 2) {
      setLocationSuggestions([])
      return
    }

    setIsSearchingLocations(true)
    try {
      const suggestions = await LX03DataService.searchStorageBins(query, 50)
      setLocationSuggestions(suggestions)
    } catch (error) {
      logger.error('Error searching locations:', error)
    } finally {
      setIsSearchingLocations(false)
    }
  }, [])

  // Add location to selection
  const handleAddLocation = useCallback(
    (location: string) => {
      if (!selectedLocations.includes(location)) {
        setSelectedLocations([...selectedLocations, location])
      }
      setLocationInput('')
      setLocationSuggestions([])
    },
    [selectedLocations]
  )

  // Remove location from selection
  const handleRemoveLocation = useCallback(
    (location: string) => {
      setSelectedLocations(selectedLocations.filter((loc) => loc !== location))
    },
    [selectedLocations]
  )

  // Search part numbers
  const handlePartSearch = useCallback(async (query: string) => {
    setPartInput(query)
    if (query.length < 2) {
      setPartSuggestions([])
      return
    }

    setIsSearchingParts(true)
    try {
      const suggestions = await LX03DataService.searchPartNumbers(query, 50)
      setPartSuggestions(suggestions)
    } catch (error) {
      logger.error('Error searching parts:', error)
    } finally {
      setIsSearchingParts(false)
    }
  }, [])

  // Add part to selection
  const handleAddPart = useCallback(
    (part: string) => {
      if (!selectedParts.includes(part)) {
        setSelectedParts([...selectedParts, part])
      }
      setPartInput('')
      setPartSuggestions([])
    },
    [selectedParts]
  )

  // Remove part from selection
  const handleRemovePart = useCallback(
    (part: string) => {
      setSelectedParts(selectedParts.filter((p) => p !== part))
    },
    [selectedParts]
  )

  // Load filter options (warehouses and storage types) when empty bins tab is selected
  const handleLoadEmptyBinsFilters = useCallback(async () => {
    setIsLoadingFilters(true)
    try {
      const [warehouses, storageTypes] = await Promise.all([
        LX03DataService.getWarehouses(),
        LX03DataService.getStorageTypes(),
      ])
      setAvailableWarehouses(warehouses)
      setAvailableStorageTypes(storageTypes)
    } catch (error) {
      logger.error('Error loading filter options:', error)
      toast.error('Failed to load filter options')
    } finally {
      setIsLoadingFilters(false)
    }
  }, [])

  // Load preview data
  const handleLoadPreview = useCallback(async () => {
    setIsLoadingPreview(true)
    setPreviewData([])

    try {
      let result: { data: AggregatedLX03Data[]; error: Error | null }

      switch (selectionMode) {
        case 'locations':
          if (selectedLocations.length === 0) {
            toast.error('Please select at least one location')
            return
          }
          result =
            await LX03DataService.getInventoryByLocations(selectedLocations)
          break

        case 'range':
          if (!rangeStart || !rangeEnd) {
            toast.error('Please enter both start and end storage bins')
            return
          }
          result = await LX03DataService.getInventoryByRange(
            rangeStart,
            rangeEnd
          )
          break

        case 'parts':
          if (selectedParts.length === 0) {
            toast.error('Please select at least one part number')
            return
          }
          result =
            await LX03DataService.getInventoryByPartNumbers(selectedParts)
          break

        case 'empty_bins':
          // At least one filter must be selected
          if (
            !selectedWarehouse &&
            !selectedStorageType &&
            !selectedStorageArea
          ) {
            toast.error(
              'Please select at least one filter (Warehouse, Storage Type, or Storage Area)'
            )
            return
          }
          result = await LX03DataService.getEmptyBinsByFilters(
            selectedWarehouse || null,
            selectedStorageType || null,
            selectedStorageArea || null
          )
          break

        default:
          toast.error('Invalid selection mode')
          return
      }

      if (result.error) {
        toast.error('Failed to load inventory data')
        logger.error(result.error)
        return
      }

      setPreviewData(result.data)

      // Auto-select all items when preview loads
      if (result.data.length > 0) {
        const allIndices = new Set(result.data.map((_, index) => index))
        setSelectedIndices(allIndices)
        setSelectAll(true)
        toast.success(`Found ${result.data.length} items to count`)
      } else {
        setSelectedIndices(new Set())
        setSelectAll(false)
        toast.warning('No inventory found for the selected criteria')
      }
    } catch (error) {
      logger.error('Error loading preview:', error)
      toast.error('Failed to load preview')
    } finally {
      setIsLoadingPreview(false)
    }
  }, [
    selectionMode,
    selectedLocations,
    rangeStart,
    rangeEnd,
    selectedParts,
    selectedWarehouse,
    selectedStorageType,
    selectedStorageArea,
  ])

  // Handle select all toggle
  const handleSelectAll = useCallback(() => {
    if (selectAll) {
      // Deselect all
      setSelectedIndices(new Set())
      setSelectAll(false)
    } else {
      // Select all
      const allIndices = new Set(previewData.map((_, index) => index))
      setSelectedIndices(allIndices)
      setSelectAll(true)
    }
  }, [selectAll, previewData])

  // Handle individual row selection
  const handleRowToggle = useCallback(
    (index: number) => {
      setSelectedIndices((prev) => {
        const newSet = new Set(prev)
        if (newSet.has(index)) {
          newSet.delete(index)
        } else {
          newSet.add(index)
        }
        // Update selectAll state
        setSelectAll(newSet.size === previewData.length)
        return newSet
      })
    },
    [previewData.length]
  )

  // Get selected items for submission
  const selectedItems = useMemo(() => {
    return previewData.filter((_, index) => selectedIndices.has(index))
  }, [previewData, selectedIndices])

  // Submit counts
  const handleSubmit = useCallback(async () => {
    if (selectedItems.length === 0) {
      toast.error(
        'No items selected. Please select at least one item to create counts.'
      )
      return
    }

    setIsSubmitting(true)
    try {
      const counts = selectedItems.map((item) => ({
        material_number: item.material,
        location: item.storage_bin,
        warehouse: item.warehouse || item.storage_location,
        system_quantity: Number(item.total_stock),
        count_type: countType,
        priority: priority,
        assigned_to: assignedUserId || null,
      }))

      await onSubmit(counts)

      // Reset form
      setSelectedLocations([])
      setSelectedParts([])
      setRangeStart('')
      setRangeEnd('')
      setPreviewData([])
      setLocationInput('')
      setPartInput('')
      setAssignedUserId('')
      setSelectedIndices(new Set())
      setSelectAll(false)

      onClose()

      const assignedUserName = availableUsers.find(
        (u) => u.id === assignedUserId
      )?.full_name
      const successMessage = assignedUserId
        ? `Successfully created ${counts.length} cycle counts and assigned to ${assignedUserName}`
        : `Successfully created ${counts.length} cycle counts`
      toast.success(successMessage)
    } catch (error) {
      logger.error('Error creating counts:', error)
      toast.error('Failed to create counts')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    selectedItems,
    countType,
    priority,
    assignedUserId,
    availableUsers,
    onSubmit,
    onClose,
  ])

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={() => onClose()} size='xl'>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle className='flex items-center gap-2'>
          <Package className='h-5 w-5' />
          Add Counts from LX03 Inventory Data
        </ResponsiveDialogTitle>
      </ResponsiveDialogHeader>

      <ResponsiveDialogBody className='space-y-6'>
        {/* Count Settings */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm font-semibold'>
              Count Settings
            </CardTitle>
          </CardHeader>
          <CardContent className='grid grid-cols-1 gap-4 md:grid-cols-3'>
            <div>
              <Label htmlFor='count_type'>Count Type *</Label>
              <Select value={countType} onValueChange={setCountType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {countTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor='priority'>Priority Level</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='critical'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-red-500'></div>
                      Critical
                    </div>
                  </SelectItem>
                  <SelectItem value='hot'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-orange-500'></div>
                      Hot
                    </div>
                  </SelectItem>
                  <SelectItem value='normal'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-blue-500'></div>
                      Normal
                    </div>
                  </SelectItem>
                  <SelectItem value='low'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 rounded-full bg-gray-500'></div>
                      Low
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor='assigned_user'>Assign To (Optional)</Label>
              <Select
                value={assignedUserId || 'unassigned'}
                onValueChange={(value) =>
                  setAssignedUserId(value === 'unassigned' ? '' : value)
                }
                disabled={usersLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      usersLoading ? 'Loading users...' : 'Select user...'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='unassigned'>
                    <div className='flex items-center gap-2'>
                      <User className='text-muted-foreground h-4 w-4' />
                      Unassigned
                    </div>
                  </SelectItem>
                  {availableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      <div className='flex items-center gap-2'>
                        <User className='h-4 w-4 text-blue-600' />
                        <span>{user.full_name}</span>
                        <Badge variant='secondary' className='text-xs'>
                          {user.role}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Selection Mode Tabs */}
        <Tabs
          value={selectionMode}
          onValueChange={(value) => {
            setSelectionMode(value as SelectionMode)
            // Load filter options when switching to empty bins tab
            if (value === 'empty_bins' && availableWarehouses.length === 0) {
              handleLoadEmptyBinsFilters()
            }
          }}
        >
          <TabsList className='grid w-full grid-cols-4'>
            <TabsTrigger value='locations'>By Location(s)</TabsTrigger>
            <TabsTrigger value='range'>By Range</TabsTrigger>
            <TabsTrigger value='parts'>By Part Number(s)</TabsTrigger>
            <TabsTrigger value='empty_bins'>Empty Bins</TabsTrigger>
          </TabsList>

          {/* By Locations Tab */}
          <TabsContent value='locations' className='space-y-4'>
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm font-semibold'>
                  Select Storage Bins
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='relative'>
                  <Label htmlFor='location_search'>Search Storage Bin</Label>
                  <div className='relative'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                    <Input
                      id='location_search'
                      placeholder='Type to search locations (e.g., RK-36-C-02)...'
                      value={locationInput}
                      onChange={(e) => handleLocationSearch(e.target.value)}
                      className='pl-10'
                    />
                    {isSearchingLocations && (
                      <Loader2 className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin' />
                    )}
                  </div>

                  {/* Suggestions dropdown */}
                  {locationSuggestions.length > 0 && (
                    <div className='bg-background absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border shadow-lg'>
                      {locationSuggestions.map((suggestion) => (
                        <div
                          key={suggestion}
                          className='hover:bg-accent flex cursor-pointer items-center justify-between px-4 py-2'
                          onClick={() => handleAddLocation(suggestion)}
                        >
                          <span>{suggestion}</span>
                          <Plus className='text-muted-foreground h-4 w-4' />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected Locations */}
                {selectedLocations.length > 0 && (
                  <div className='space-y-2'>
                    <Label>
                      Selected Locations ({selectedLocations.length})
                    </Label>
                    <div className='flex flex-wrap gap-2'>
                      {selectedLocations.map((location) => (
                        <Badge
                          key={location}
                          variant='secondary'
                          className='gap-1'
                        >
                          {location}
                          <X
                            className='hover:text-destructive h-3 w-3 cursor-pointer'
                            onClick={() => handleRemoveLocation(location)}
                          />
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleLoadPreview}
                  disabled={selectedLocations.length === 0 || isLoadingPreview}
                  className='w-full'
                >
                  {isLoadingPreview ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Loading Preview...
                    </>
                  ) : (
                    <>
                      <Search className='mr-2 h-4 w-4' />
                      Load Preview ({selectedLocations.length} location
                      {selectedLocations.length !== 1 ? 's' : ''})
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* By Range Tab */}
          <TabsContent value='range' className='space-y-4'>
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm font-semibold'>
                  Select Storage Bin Range
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='grid grid-cols-2 gap-4'>
                  <div>
                    <Label htmlFor='range_start'>Start Storage Bin *</Label>
                    <Input
                      id='range_start'
                      placeholder='e.g., RK-35-A-01'
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor='range_end'>End Storage Bin *</Label>
                    <Input
                      id='range_end'
                      placeholder='e.g., RK-36-C-03'
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                    />
                  </div>
                </div>

                <div className='rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20'>
                  <p className='text-sm text-blue-800 dark:text-blue-200'>
                    <AlertTriangle className='mr-2 inline h-4 w-4' />
                    Range is inclusive and uses alphabetical sorting. All
                    storage bins between start and end will be included.
                  </p>
                </div>

                <Button
                  onClick={handleLoadPreview}
                  disabled={!rangeStart || !rangeEnd || isLoadingPreview}
                  className='w-full'
                >
                  {isLoadingPreview ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Loading Preview...
                    </>
                  ) : (
                    <>
                      <Search className='mr-2 h-4 w-4' />
                      Load Preview (Range: {rangeStart || '...'} to{' '}
                      {rangeEnd || '...'})
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* By Part Numbers Tab */}
          <TabsContent value='parts' className='space-y-4'>
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm font-semibold'>
                  Select Part Numbers
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='relative'>
                  <Label htmlFor='part_search'>Search Part Number</Label>
                  <div className='relative'>
                    <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                    <Input
                      id='part_search'
                      placeholder='Type to search part numbers (e.g., M250-10617)...'
                      value={partInput}
                      onChange={(e) => handlePartSearch(e.target.value)}
                      className='pl-10'
                    />
                    {isSearchingParts && (
                      <Loader2 className='absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin' />
                    )}
                  </div>

                  {/* Suggestions dropdown */}
                  {partSuggestions.length > 0 && (
                    <div className='bg-background absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border shadow-lg'>
                      {partSuggestions.map((suggestion) => (
                        <div
                          key={suggestion}
                          className='hover:bg-accent flex cursor-pointer items-center justify-between px-4 py-2'
                          onClick={() => handleAddPart(suggestion)}
                        >
                          <span>{suggestion}</span>
                          <Plus className='text-muted-foreground h-4 w-4' />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected Parts */}
                {selectedParts.length > 0 && (
                  <div className='space-y-2'>
                    <Label>
                      Selected Part Numbers ({selectedParts.length})
                    </Label>
                    <div className='flex flex-wrap gap-2'>
                      {selectedParts.map((part) => (
                        <Badge key={part} variant='secondary' className='gap-1'>
                          {part}
                          <X
                            className='hover:text-destructive h-3 w-3 cursor-pointer'
                            onClick={() => handleRemovePart(part)}
                          />
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleLoadPreview}
                  disabled={selectedParts.length === 0 || isLoadingPreview}
                  className='w-full'
                >
                  {isLoadingPreview ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Loading Preview...
                    </>
                  ) : (
                    <>
                      <Search className='mr-2 h-4 w-4' />
                      Load Preview ({selectedParts.length} part
                      {selectedParts.length !== 1 ? 's' : ''})
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* By Empty Bins Tab */}
          <TabsContent value='empty_bins' className='space-y-4'>
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm font-semibold'>
                  Filter Empty Bins
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                {isLoadingFilters ? (
                  <div className='flex items-center justify-center py-8'>
                    <Loader2 className='text-primary h-6 w-6 animate-spin' />
                    <span className='ml-2'>Loading filter options...</span>
                  </div>
                ) : (
                  <>
                    <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
                      {/* Warehouse Filter */}
                      <div>
                        <Label htmlFor='warehouse_filter'>Warehouse</Label>
                        <Select
                          value={selectedWarehouse || 'all_warehouses'}
                          onValueChange={(value) =>
                            setSelectedWarehouse(
                              value === 'all_warehouses' ? '' : value
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder='Select warehouse...' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='all_warehouses'>
                              All Warehouses
                            </SelectItem>
                            {availableWarehouses.map((warehouse) => (
                              <SelectItem key={warehouse} value={warehouse}>
                                {warehouse}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Storage Type Filter */}
                      <div>
                        <Label htmlFor='storage_type_filter'>
                          Storage Type
                        </Label>
                        <Select
                          value={selectedStorageType || 'all_storage_types'}
                          onValueChange={(value) =>
                            setSelectedStorageType(
                              value === 'all_storage_types' ? '' : value
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder='Select storage type...' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='all_storage_types'>
                              All Storage Types
                            </SelectItem>
                            {availableStorageTypes.map((storageType) => (
                              <SelectItem key={storageType} value={storageType}>
                                {storageType}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Storage Area Filter */}
                      <div>
                        <Label htmlFor='storage_area_filter'>
                          Storage Area
                        </Label>
                        <Select
                          value={selectedStorageArea || 'all_storage_areas'}
                          onValueChange={(value) =>
                            setSelectedStorageArea(
                              value === 'all_storage_areas' ? '' : value
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder='Select storage area...' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='all_storage_areas'>
                              All Storage Areas
                            </SelectItem>
                            <SelectItem value='Racks'>
                              Racks (RA-, RB-, ..., RZ-)
                            </SelectItem>
                            <SelectItem value='Shelves'>
                              Shelves (SA-, SB-, ..., TG-)
                            </SelectItem>
                            <SelectItem value='Kardex'>
                              Kardex (K1-, K2-, K3-, K4-)
                            </SelectItem>
                            <SelectItem value='Other'>Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className='rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20'>
                      <p className='text-sm text-blue-800 dark:text-blue-200'>
                        <AlertTriangle className='mr-2 inline h-4 w-4' />
                        Select at least one filter to find empty bins. Empty
                        bins are locations with material marked as
                        &lt;&lt;empty&gt;&gt;.
                      </p>
                    </div>

                    {/* Selected Filters Summary */}
                    {(selectedWarehouse ||
                      selectedStorageType ||
                      selectedStorageArea) && (
                      <div className='space-y-2'>
                        <Label>Active Filters:</Label>
                        <div className='flex flex-wrap gap-2'>
                          {selectedWarehouse && (
                            <Badge variant='secondary' className='gap-1'>
                              Warehouse: {selectedWarehouse}
                              <X
                                className='hover:text-destructive h-3 w-3 cursor-pointer'
                                onClick={() => setSelectedWarehouse('')}
                              />
                            </Badge>
                          )}
                          {selectedStorageType && (
                            <Badge variant='secondary' className='gap-1'>
                              Storage Type: {selectedStorageType}
                              <X
                                className='hover:text-destructive h-3 w-3 cursor-pointer'
                                onClick={() => setSelectedStorageType('')}
                              />
                            </Badge>
                          )}
                          {selectedStorageArea && (
                            <Badge variant='secondary' className='gap-1'>
                              Storage Area: {selectedStorageArea}
                              <X
                                className='hover:text-destructive h-3 w-3 cursor-pointer'
                                onClick={() => setSelectedStorageArea('')}
                              />
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    <Button
                      onClick={handleLoadPreview}
                      disabled={
                        (!selectedWarehouse &&
                          !selectedStorageType &&
                          !selectedStorageArea) ||
                        isLoadingPreview
                      }
                      className='w-full'
                    >
                      {isLoadingPreview ? (
                        <>
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          Loading Empty Bins...
                        </>
                      ) : (
                        <>
                          <Search className='mr-2 h-4 w-4' />
                          Find Empty Bins
                        </>
                      )}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Preview Section */}
        {previewData.length > 0 && (
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='flex items-center justify-between text-sm font-semibold'>
                <span>
                  Preview: {selectedIndices.size} of {previewData.length}{' '}
                  Selected
                </span>
                <Badge variant='outline'>
                  {countType.replace('_', ' ').toUpperCase()}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className='max-h-96 overflow-auto rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-12'>
                        <CheckboxUI
                          checked={selectAll}
                          onCheckedChange={handleSelectAll}
                          aria-label='Select all items'
                        />
                      </TableHead>
                      <TableHead>Storage Bin</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead className='text-right'>System Qty</TableHead>
                      <TableHead>Warehouse</TableHead>
                      {selectionMode === 'empty_bins' && (
                        <TableHead>Storage Area</TableHead>
                      )}
                      <TableHead className='text-right'>Records</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.map((item, index) => (
                      <TableRow
                        key={index}
                        className={
                          selectedIndices.has(index)
                            ? 'bg-blue-50 dark:bg-blue-950/20'
                            : ''
                        }
                      >
                        <TableCell>
                          <CheckboxUI
                            checked={selectedIndices.has(index)}
                            onCheckedChange={() => handleRowToggle(index)}
                            aria-label={`Select ${item.storage_bin}`}
                          />
                        </TableCell>
                        <TableCell className='font-medium'>
                          {item.storage_bin}
                        </TableCell>
                        <TableCell>{item.material || '<<empty>>'}</TableCell>
                        <TableCell className='text-right'>
                          {item.total_stock} EA
                        </TableCell>
                        <TableCell>
                          {item.warehouse || item.storage_location || 'N/A'}
                        </TableCell>
                        {selectionMode === 'empty_bins' && (
                          <TableCell>
                            <Badge variant='outline'>
                              {item.storage_area || 'Unknown'}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell className='text-right'>
                          {item.record_count}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className='mt-4 rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/20'>
                <div className='flex items-start gap-2'>
                  <Check className='mt-0.5 h-5 w-5 text-green-600' />
                  <div className='text-sm text-green-800 dark:text-green-200'>
                    <strong>
                      {selectedIndices.size} of {previewData.length} cycle
                      counts
                    </strong>{' '}
                    will be created with:
                    <ul className='mt-1 list-inside list-disc space-y-0.5'>
                      <li>
                        Count Type:{' '}
                        <strong>
                          {countTypeOptions.find((o) => o.value === countType)
                            ?.label ?? countType}
                        </strong>
                      </li>
                      <li>
                        Priority:{' '}
                        <strong>
                          {priority.charAt(0).toUpperCase() + priority.slice(1)}
                        </strong>
                      </li>
                      {assignedUserId && (
                        <li>
                          Assigned To:{' '}
                          <strong>
                            {availableUsers.find((u) => u.id === assignedUserId)
                              ?.full_name || 'User'}
                          </strong>
                        </li>
                      )}
                      {!assignedUserId && (
                        <li>
                          Assignment:{' '}
                          <strong>Unassigned (can be assigned later)</strong>
                        </li>
                      )}
                      <li>
                        System quantities from LX03 data (aggregated by location
                        + material)
                      </li>
                    </ul>
                    {selectedIndices.size < previewData.length && (
                      <p className='mt-2 text-orange-700 dark:text-orange-300'>
                        <AlertTriangle className='mr-1 inline h-4 w-4' />
                        {previewData.length - selectedIndices.size} item(s) will
                        NOT be created (unselected)
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter className='items-center justify-between gap-4 sm:justify-between'>
        <Button variant='outline' onClick={onClose}>
          Cancel
        </Button>

        <div className='flex gap-2'>
          {previewData.length > 0 && (
            <>
              <Button
                variant='outline'
                onClick={() => {
                  setPreviewData([])
                  setSelectedIndices(new Set())
                  setSelectAll(false)
                }}
              >
                Clear Preview
              </Button>
              {selectedIndices.size < previewData.length && (
                <Button variant='outline' onClick={handleSelectAll}>
                  {selectAll ? 'Deselect All' : 'Select All'}
                </Button>
              )}
            </>
          )}
          <Button
            onClick={handleSubmit}
            disabled={selectedIndices.size === 0 || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Creating {selectedIndices.size} Counts...
              </>
            ) : (
              <>
                <Plus className='mr-2 h-4 w-4' />
                Create {selectedIndices.size} Cycle Count
                {selectedIndices.size !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </div>
      </ResponsiveDialogFooter>
    </ResponsiveDialog>
  )
}

// Created and developed by Jai Singh
