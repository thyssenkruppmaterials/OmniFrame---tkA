import React, { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  Loader2,
  MapPin,
  Package,
  RotateCcw,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  locationQueryService,
  type LocationQueryResult,
} from '@/lib/supabase/location-query.service'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScannerInput } from '@/components/ui/scanner-input'

interface RFLocationScannerProps {
  onBack?: () => void
}

const RFLocationScanner: React.FC<RFLocationScannerProps> = ({ onBack }) => {
  const [location, setLocation] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<LocationQueryResult[]>([])
  const [searchedLocation, setSearchedLocation] = useState('')
  const [lx03Count, setLx03Count] = useState(0)
  const [sq01Count, setSq01Count] = useState(0)

  const locationInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus on location input when component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      if (locationInputRef.current) {
        locationInputRef.current.focus()
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [])

  const handleSearch = async () => {
    if (!location.trim()) {
      toast.error('Please enter a location to search')
      return
    }

    setIsSearching(true)

    try {
      const response = await locationQueryService.queryLocation(location.trim())

      if (!response.success) {
        toast.error(response.error || 'Failed to search location')
        setResults([])
        setSearchedLocation('')
        setLx03Count(0)
        setSq01Count(0)
        return
      }

      setResults(response.results)
      setSearchedLocation(response.location)
      setLx03Count(response.lx03Count)
      setSq01Count(response.sq01Count)

      if (response.totalCount === 0) {
        toast.info(`No materials found at location: ${response.location}`)
      } else {
        toast.success(
          `Found ${response.totalCount} material(s) at location: ${response.location}`
        )
      }
    } catch (error: unknown) {
      logger.error('Error searching location:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to search location'
      )
      setResults([])
      setSearchedLocation('')
      setLx03Count(0)
      setSq01Count(0)
    } finally {
      setIsSearching(false)
    }
  }

  const handleClear = () => {
    setLocation('')
    setResults([])
    setSearchedLocation('')
    setLx03Count(0)
    setSq01Count(0)

    // Return focus to input
    setTimeout(() => {
      if (locationInputRef.current) {
        locationInputRef.current.focus()
      }
    }, 50)

    toast.success('Form cleared')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSearch()
    }
  }

  const formatNumber = (num: number | undefined): string => {
    if (num === undefined || num === null) return 'N/A'
    return num.toLocaleString()
  }

  const formatDate = (date: string | undefined): string => {
    if (!date) return 'N/A'
    try {
      return new Date(date).toLocaleDateString()
    } catch {
      return date
    }
  }

  return (
    <div className='mx-auto flex w-full max-w-md flex-1 flex-col space-y-3 p-2'>
      {/* Search Form */}
      <Card className='w-full'>
        <CardHeader className='relative pb-2 text-center'>
          {onBack && (
            <Button
              variant='ghost'
              size='sm'
              onClick={onBack}
              className='absolute top-2 left-2'
            >
              <ChevronLeft className='h-4 w-4' />
              Back
            </Button>
          )}
          <CardTitle className='flex flex-col items-center gap-2 text-sm'>
            <MapPin className='h-8 w-8' />
            Location Scanner
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-3'>
            {/* Location Input */}
            <div className='space-y-1'>
              <Label htmlFor='location' className='text-xs font-medium'>
                Scan or Enter Location *
              </Label>
              <ScannerInput
                ref={locationInputRef}
                id='location'
                type='text'
                placeholder='Scan location barcode...'
                value={location}
                onChange={(e) => setLocation(e.target.value.trim())}
                onKeyDown={handleKeyPress}
                className='h-10 text-center font-mono text-sm'
                disabled={isSearching}
              />
            </div>

            {/* Action Buttons */}
            <div className='flex space-x-2'>
              <Button
                type='button'
                onClick={handleClear}
                variant='outline'
                className='h-10 flex-1'
                disabled={isSearching}
              >
                <RotateCcw className='mr-1 h-3 w-3' />
                Clear
              </Button>

              <Button
                type='button'
                onClick={handleSearch}
                className='h-10 flex-1'
                disabled={!location.trim() || isSearching}
              >
                {isSearching ? (
                  <>
                    <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className='mr-1 h-3 w-3' />
                    Search
                  </>
                )}
              </Button>
            </div>

            {/* Statistics Summary */}
            {searchedLocation && (
              <div className='bg-accent rounded-lg p-2'>
                <div className='space-y-1 text-center text-xs'>
                  <p className='font-semibold'>Location: {searchedLocation}</p>
                  <div className='flex justify-center space-x-4'>
                    <span>
                      <Badge variant='default' className='text-xs'>
                        LX03: {lx03Count}
                      </Badge>
                    </span>
                    <span>
                      <Badge variant='secondary' className='text-xs'>
                        SQ01: {sq01Count}
                      </Badge>
                    </span>
                    <span>
                      <Badge variant='outline' className='text-xs'>
                        Total: {results.length}
                      </Badge>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results Section */}
      {searchedLocation && (
        <div className='flex-1 space-y-2 overflow-y-auto'>
          {results.length === 0 ? (
            <Card className='p-4'>
              <div className='text-muted-foreground text-center'>
                <Package className='mx-auto mb-2 h-12 w-12 opacity-50' />
                <p className='text-sm'>No materials found at this location</p>
              </div>
            </Card>
          ) : (
            results.map((result, index) => (
              <Card
                key={`${result.source}-${result.material}-${index}`}
                className='p-3'
              >
                <div className='space-y-2'>
                  {/* Header with Source Badge */}
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='mb-1 flex items-center space-x-2'>
                        <Badge
                          variant={
                            result.source === 'lx03' ? 'default' : 'secondary'
                          }
                          className='text-xs'
                        >
                          {result.source.toUpperCase()}
                        </Badge>
                        <h4 className='text-sm font-semibold'>
                          {result.material}
                        </h4>
                      </div>
                      {result.material_description && (
                        <p className='text-muted-foreground text-xs'>
                          {result.material_description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className='grid grid-cols-2 gap-x-3 gap-y-1 text-xs'>
                    <div>
                      <span className='text-muted-foreground'>Plant:</span>
                      <span className='ml-1 font-medium'>
                        {result.plant || 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className='text-muted-foreground'>Location:</span>
                      <span className='ml-1 font-medium'>
                        {result.location || 'N/A'}
                      </span>
                    </div>

                    {result.batch && (
                      <div className='col-span-2'>
                        <span className='text-muted-foreground'>Batch:</span>
                        <span className='ml-1 font-medium'>{result.batch}</span>
                      </div>
                    )}

                    {/* LX03 Specific Fields */}
                    {result.source === 'lx03' && (
                      <>
                        {result.storage_type && (
                          <div>
                            <span className='text-muted-foreground'>
                              Storage Type:
                            </span>
                            <span className='ml-1 font-medium'>
                              {result.storage_type}
                            </span>
                          </div>
                        )}
                        {result.storage_location && (
                          <div>
                            <span className='text-muted-foreground'>
                              Storage Loc:
                            </span>
                            <span className='ml-1 font-medium'>
                              {result.storage_location}
                            </span>
                          </div>
                        )}
                        <div>
                          <span className='text-muted-foreground'>
                            Total Stock:
                          </span>
                          <span className='ml-1 font-medium'>
                            {formatNumber(result.total_stock)}
                          </span>
                        </div>
                        <div>
                          <span className='text-muted-foreground'>
                            Available:
                          </span>
                          <span className='ml-1 font-medium'>
                            {formatNumber(result.available_stock)}
                          </span>
                        </div>
                        {result.stock_category && (
                          <div className='col-span-2'>
                            <span className='text-muted-foreground'>
                              Stock Category:
                            </span>
                            <span className='ml-1 font-medium'>
                              {result.stock_category}
                            </span>
                          </div>
                        )}
                        {result.last_movement && (
                          <div className='col-span-2'>
                            <span className='text-muted-foreground'>
                              Last Movement:
                            </span>
                            <span className='ml-1 font-medium'>
                              {formatDate(result.last_movement)}
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    {/* SQ01 Specific Fields */}
                    {result.source === 'sq01' && (
                      <>
                        <div>
                          <span className='text-muted-foreground'>
                            Unrestricted:
                          </span>
                          <span className='ml-1 font-medium'>
                            {formatNumber(result.unrestricted)}
                          </span>
                        </div>
                        <div>
                          <span className='text-muted-foreground'>
                            Blocked:
                          </span>
                          <span className='ml-1 font-medium'>
                            {formatNumber(result.blocked)}
                          </span>
                        </div>
                        {result.in_qual_insp !== undefined && (
                          <div>
                            <span className='text-muted-foreground'>
                              In Qual Insp:
                            </span>
                            <span className='ml-1 font-medium'>
                              {formatNumber(result.in_qual_insp)}
                            </span>
                          </div>
                        )}
                        {result.last_gr && (
                          <div>
                            <span className='text-muted-foreground'>
                              Last GR:
                            </span>
                            <span className='ml-1 font-medium'>
                              {formatDate(result.last_gr)}
                            </span>
                          </div>
                        )}
                        {result.created_on && (
                          <div className='col-span-2'>
                            <span className='text-muted-foreground'>
                              Created:
                            </span>
                            <span className='ml-1 font-medium'>
                              {formatDate(result.created_on)}
                            </span>
                          </div>
                        )}
                        {result.shelf_life_exp_date && (
                          <div className='col-span-2'>
                            <span className='text-muted-foreground'>
                              Shelf Life Exp:
                            </span>
                            <span className='ml-1 font-medium'>
                              {formatDate(result.shelf_life_exp_date)}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default RFLocationScanner
