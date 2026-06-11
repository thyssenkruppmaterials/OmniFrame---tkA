// Created and developed by Jai Singh
/**
 * Drone Scans Page
 *
 * Main page for viewing and searching drone scan records with AI analysis.
 */
import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Search,
  SlidersHorizontal,
  RefreshCw,
  Camera,
  BarChart3,
  ChevronLeft,
} from 'lucide-react'
import { useDroneScans } from '@/hooks/use-drone-scans'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScanDetailModal } from './components/scan-detail-modal'
import { ScanResultsGrid, type DroneScan } from './components/scan-results-grid'
import { ScanSearchBar } from './components/scan-search-bar'

export default function DroneScannerPage() {
  const navigate = useNavigate()

  // State
  const [searchQuery, setSearchQuery] = useState('')
  const [warehouseZone, setWarehouseZone] = useState<string | undefined>()
  const [aisle, setAisle] = useState<string | undefined>()
  const [selectedScan, setSelectedScan] = useState<DroneScan | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  // Data fetching
  const { scans, statistics, isLoading, isSearching, search, refresh, zones } =
    useDroneScans({
      warehouseZone,
      aisle,
    })

  // Handlers
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query)
      if (query) {
        search(query, warehouseZone, aisle)
      } else {
        refresh()
      }
    },
    [search, refresh, warehouseZone, aisle]
  )

  const handleFilterChange = useCallback(() => {
    if (searchQuery) {
      search(searchQuery, warehouseZone, aisle)
    } else {
      refresh()
    }
  }, [searchQuery, search, refresh, warehouseZone, aisle])

  const handleScanClick = useCallback((scan: DroneScan) => {
    setSelectedScan(scan)
  }, [])

  const handleGoToDroneControl = useCallback(() => {
    navigate({ to: '/rf-interface' })
  }, [navigate])

  return (
    <div className='container mx-auto space-y-6 py-6'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-4'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => navigate({ to: '/' })}
          >
            <ChevronLeft className='mr-1 h-4 w-4' />
            Back
          </Button>
          <div>
            <h1 className='text-2xl font-bold'>Drone Scanner</h1>
            <p className='text-muted-foreground'>
              Search and view AI-analyzed warehouse scans
            </p>
          </div>
        </div>
        <Button onClick={handleGoToDroneControl}>
          <Camera className='mr-2 h-4 w-4' />
          Drone Control
        </Button>
      </div>

      {/* Stats Cards */}
      {statistics && (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardContent className='pt-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-muted-foreground text-sm'>Total Scans</p>
                  <p className='text-2xl font-bold'>
                    {statistics.reduce(
                      (acc, s) => acc + Number(s.total_scans),
                      0
                    )}
                  </p>
                </div>
                <Camera className='text-muted-foreground h-8 w-8' />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className='pt-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-muted-foreground text-sm'>Analyzed</p>
                  <p className='text-2xl font-bold text-green-600'>
                    {statistics.reduce(
                      (acc, s) => acc + Number(s.completed_analyses),
                      0
                    )}
                  </p>
                </div>
                <BarChart3 className='h-8 w-8 text-green-500' />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className='pt-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-muted-foreground text-sm'>
                    Items Detected
                  </p>
                  <p className='text-2xl font-bold'>
                    {statistics.reduce(
                      (acc, s) => acc + Number(s.items_detected || 0),
                      0
                    )}
                  </p>
                </div>
                <Search className='text-muted-foreground h-8 w-8' />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className='pt-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-muted-foreground text-sm'>Zones Covered</p>
                  <p className='text-2xl font-bold'>{zones.length}</p>
                </div>
                <Badge variant='secondary'>{zones.length} active</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Filters */}
      <Card>
        <CardContent className='space-y-4 pt-4'>
          <ScanSearchBar onSearch={handleSearch} isSearching={isSearching} />

          <div className='flex items-center justify-between'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal className='mr-2 h-4 w-4' />
              Filters
              {(warehouseZone || aisle) && (
                <Badge variant='secondary' className='ml-2'>
                  {[warehouseZone, aisle].filter(Boolean).length}
                </Badge>
              )}
            </Button>

            <Button
              variant='ghost'
              size='sm'
              onClick={() => refresh()}
              disabled={isLoading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className='bg-muted/50 grid grid-cols-1 gap-4 rounded-lg p-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <label className='text-sm font-medium'>Warehouse Zone</label>
                <Select
                  value={warehouseZone || 'all'}
                  onValueChange={(v) => {
                    setWarehouseZone(v === 'all' ? undefined : v)
                    setTimeout(handleFilterChange, 100)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='All zones' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>All zones</SelectItem>
                    {zones.map((zone) => (
                      <SelectItem key={zone} value={zone}>
                        {zone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-2'>
                <label className='text-sm font-medium'>Aisle</label>
                <Select
                  value={aisle || 'all'}
                  onValueChange={(v) => {
                    setAisle(v === 'all' ? undefined : v)
                    setTimeout(handleFilterChange, 100)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='All aisles' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>All aisles</SelectItem>
                    {/* Aisles would be populated from data */}
                    <SelectItem value='A1'>A1</SelectItem>
                    <SelectItem value='A2'>A2</SelectItem>
                    <SelectItem value='B1'>B1</SelectItem>
                    <SelectItem value='B2'>B2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      <div>
        {searchQuery && (
          <div className='mb-4 flex items-center gap-2'>
            <Badge variant='secondary'>
              Search results for: "{searchQuery}"
            </Badge>
            <Button variant='ghost' size='sm' onClick={() => handleSearch('')}>
              Clear
            </Button>
          </div>
        )}

        <ScanResultsGrid
          scans={scans}
          isLoading={isLoading || isSearching}
          onScanClick={handleScanClick}
        />
      </div>

      {/* Scan Detail Modal */}
      <ScanDetailModal
        scan={selectedScan}
        open={!!selectedScan}
        onOpenChange={(open) => !open && setSelectedScan(null)}
      />
    </div>
  )
}

// Created and developed by Jai Singh
