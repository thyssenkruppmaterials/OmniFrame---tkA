// Created and developed by Jai Singh
/**
 * MapToolbar — primary toolbar for the warehouse map shell.
 * Hosts warehouse picker, layer selector, search box (autocomplete), edit
 * mode segmented control, list/map toggle, zoom controls, publish/upload/
 * import/export, and panel triggers (revisions, diagnostics, navigate,
 * asset manager, help). Mode-specific edit actions live in the secondary
 * EditActionBar component.
 */
import { useCallback } from 'react'
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Expand,
  Shrink,
  LayoutList,
  Map as MapIcon,
  Save,
  History,
  AlertTriangle,
  Navigation,
  Upload,
  FileUp,
  Activity,
  Building2,
  GitFork,
  Truck,
  HelpCircle,
  Box,
  Layers,
} from 'lucide-react'
import { usePermissionStore } from '@/stores/permissionStore'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { BinSearchAutocomplete } from './bin-search-autocomplete'
import { ModeSegmented } from './edit-action-bar'
// Tiny zustand bridge (no three.js imports — safe outside the lazy 3D chunk).
import { useCameraFocus } from './scene3d/camera-focus.store'
import type {
  DataLayer,
  WarehouseLocationMapping,
  WarehouseMapSettings,
} from './types'

const DATA_LAYER_OPTIONS: { value: DataLayer; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'stock', label: 'Stock' },
  { value: 'utilization', label: 'Utilization' },
  { value: 'activity', label: 'Activity' },
]

interface MapToolbarProps {
  settings: WarehouseMapSettings
  readOnly: boolean
  warehouses: string[]
  mappings: WarehouseLocationMapping[]
  onWarehouseChange: (code: string) => void
  onPublish: () => void
  onUploadBackground: () => void
  onImportDxf: () => void
  onShowRevisions: () => void
  onShowDiagnostics: () => void
  onShowNavigate: () => void
  onShowAssets: () => void
  onShowHelp: () => void
  /** Open the facilities & layout-templates dialog. */
  onShowFacilities?: () => void
  onBulkStatusChange: (status: string) => void
  exportTargetId?: string
  isDraftDirty?: boolean
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
}

export function MapToolbar({
  settings,
  readOnly,
  warehouses,
  mappings,
  onWarehouseChange,
  onPublish,
  onUploadBackground,
  onImportDxf,
  onShowRevisions,
  onShowDiagnostics,
  onShowNavigate,
  onShowAssets,
  onShowHelp,
  onShowFacilities,
  onBulkStatusChange,
  isDraftDirty = false,
  isFullscreen = false,
  onToggleFullscreen,
}: MapToolbarProps) {
  const activeDataLayer = useWarehouseMapStore((s) => s.activeDataLayer)
  const setActiveDataLayer = useWarehouseMapStore((s) => s.setActiveDataLayer)
  const setRouteFromBin = useWarehouseMapStore((s) => s.setRouteFromBin)
  const setSidebarPanel = useWarehouseMapStore((s) => s.setSidebarPanel)
  const selectedWarehouseCode = useWarehouseMapStore(
    (s) => s.selectedWarehouseCode
  )
  const isListMode = useWarehouseMapStore((s) => s.isListMode)
  const toggleListMode = useWarehouseMapStore((s) => s.toggleListMode)
  const is3DMode = useWarehouseMapStore((s) => s.is3DMode)
  const toggle3DMode = useWarehouseMapStore((s) => s.toggle3DMode)
  const selectedLocationIds = useWarehouseMapStore((s) => s.selectedLocationIds)
  const zoomIn = useWarehouseMapStore((s) => s.zoomIn)
  const zoomOut = useWarehouseMapStore((s) => s.zoomOut)
  const setViewport = useWarehouseMapStore((s) => s.setViewport)
  const showAisleGraph = useWarehouseMapStore((s) => s.showAisleGraph)
  const setShowAisleGraph = useWarehouseMapStore((s) => s.setShowAisleGraph)
  const showAssetPositions = useWarehouseMapStore((s) => s.showAssetPositions)
  const setShowAssetPositions = useWarehouseMapStore(
    (s) => s.setShowAssetPositions
  )

  const hasPermission = usePermissionStore((s) => s.hasPermission)
  const canManage = hasPermission('manage', 'warehouse_maps')

  const requestZoom = useCameraFocus((s) => s.requestZoom)
  const requestFrameAll = useCameraFocus((s) => s.requestFrameAll)

  // Zoom / fit are mode-aware: the store viewport only drives the 2D Konva
  // canvas — in 3D they route to the scene camera via the focus bridge.
  const handleZoomIn = useCallback(() => {
    if (is3DMode) requestZoom(1.3)
    else zoomIn()
  }, [is3DMode, requestZoom, zoomIn])

  const handleZoomOut = useCallback(() => {
    if (is3DMode) requestZoom(1 / 1.3)
    else zoomOut()
  }, [is3DMode, requestZoom, zoomOut])

  const handleFitToView = useCallback(() => {
    if (is3DMode) requestFrameAll()
    else setViewport({ x: 0, y: 0, scale: 1 })
  }, [is3DMode, requestFrameAll, setViewport])

  const handleNavigateFrom = useCallback(
    (bin: string) => {
      setRouteFromBin(bin)
      setSidebarPanel('route')
    },
    [setRouteFromBin, setSidebarPanel]
  )

  const currentWarehouse =
    selectedWarehouseCode ?? settings.default_warehouse_code ?? ''

  return (
    <TooltipProvider delayDuration={150}>
      <div className='bg-card flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 shadow-sm'>
        {/* Warehouse selector */}
        <Select value={currentWarehouse} onValueChange={onWarehouseChange}>
          <SelectTrigger className='w-[140px]' aria-label='Warehouse'>
            <SelectValue placeholder='Warehouse' />
          </SelectTrigger>
          <SelectContent>
            {warehouses.map((wh) => (
              <SelectItem key={wh} value={wh}>
                {wh}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Data layer */}
        <Select
          value={activeDataLayer}
          onValueChange={(v) => setActiveDataLayer(v as DataLayer)}
        >
          <SelectTrigger className='w-[120px]' aria-label='Data layer'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATA_LAYER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Bin search with autocomplete */}
        <BinSearchAutocomplete
          mappings={mappings}
          onNavigateFrom={handleNavigateFrom}
        />

        <div className='bg-border mx-1 h-6 w-px' />

        {/* Mode segmented (replaces the old Edit dropdown) */}
        <ModeSegmented readOnly={readOnly || !canManage} />

        {/* Publish (always visible if user can manage) */}
        {canManage && !readOnly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size='sm'
                variant={isDraftDirty ? 'default' : 'outline'}
                onClick={onPublish}
              >
                <Save className='mr-1 h-3.5 w-3.5' />
                Publish
                {isDraftDirty && (
                  <span className='ml-1 inline-block h-2 w-2 rounded-full bg-amber-300' />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Snapshot current layout as new revision
            </TooltipContent>
          </Tooltip>
        )}

        <div className='bg-border mx-1 h-6 w-px' />

        {/* Layer overlays */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showAisleGraph ? 'secondary' : 'ghost'}
              size='icon'
              onClick={() => setShowAisleGraph(!showAisleGraph)}
              aria-label='Toggle aisle graph'
            >
              <GitFork className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Aisle graph</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showAssetPositions ? 'secondary' : 'ghost'}
              size='icon'
              onClick={() => setShowAssetPositions(!showAssetPositions)}
              aria-label='Toggle asset positions'
            >
              <Truck className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Live forklifts &amp; operators</TooltipContent>
        </Tooltip>

        {/* 2D / 3D toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={is3DMode ? 'secondary' : 'ghost'}
              size='sm'
              onClick={toggle3DMode}
              aria-pressed={is3DMode}
              aria-label='Toggle 3D view'
              className='gap-1'
            >
              {is3DMode ? (
                <Layers className='h-3.5 w-3.5' />
              ) : (
                <Box className='h-3.5 w-3.5' />
              )}
              <span className='text-xs font-medium'>
                {is3DMode ? '2D' : '3D'}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {is3DMode ? 'Switch to 2D map' : 'Switch to 3D view'}
          </TooltipContent>
        </Tooltip>

        {/* List / Map toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={toggleListMode}
              aria-label={isListMode ? 'Show map' : 'Show list'}
            >
              {isListMode ? (
                <MapIcon className='h-4 w-4' />
              ) : (
                <LayoutList className='h-4 w-4' />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isListMode ? 'Map view' : 'List view'}
          </TooltipContent>
        </Tooltip>

        {/* Zoom */}
        <div className='flex items-center gap-0.5'>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleZoomIn}
            aria-label='Zoom in'
          >
            <ZoomIn className='h-4 w-4' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleZoomOut}
            aria-label='Zoom out'
          >
            <ZoomOut className='h-4 w-4' />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                onClick={handleFitToView}
                aria-label='Fit to view'
              >
                <Maximize className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to view</TooltipContent>
          </Tooltip>
          {onToggleFullscreen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={onToggleFullscreen}
                  aria-label={
                    isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
                  }
                  aria-pressed={isFullscreen}
                >
                  {isFullscreen ? (
                    <Shrink className='h-4 w-4' />
                  ) : (
                    <Expand className='h-4 w-4' />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className='bg-border mx-1 h-6 w-px' />

        {/* Quick actions: Navigate, Help */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant='ghost' size='icon' onClick={onShowNavigate}>
              <Navigation className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Navigate (find a route)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant='ghost' size='icon' onClick={onShowHelp}>
              <HelpCircle className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
        </Tooltip>

        {/* More menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='sm'>
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-56'>
            <DropdownMenuLabel>Layout</DropdownMenuLabel>
            {onShowFacilities && (
              <DropdownMenuItem onClick={onShowFacilities}>
                <Building2 className='mr-2 h-3.5 w-3.5' />
                Facilities &amp; templates
              </DropdownMenuItem>
            )}
            {canManage && (
              <DropdownMenuItem onClick={onUploadBackground}>
                <Upload className='mr-2 h-3.5 w-3.5' />
                Upload floor plan
              </DropdownMenuItem>
            )}
            {canManage && (
              <DropdownMenuItem onClick={onImportDxf}>
                <FileUp className='mr-2 h-3.5 w-3.5' />
                Import DXF
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onShowRevisions}>
              <History className='mr-2 h-3.5 w-3.5' />
              Revisions
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Health</DropdownMenuLabel>
            <DropdownMenuItem onClick={onShowDiagnostics}>
              <AlertTriangle className='mr-2 h-3.5 w-3.5' />
              Diagnostics
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onShowAssets}>
              <Truck className='mr-2 h-3.5 w-3.5' />
              Asset manager
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowAssetPositions(!showAssetPositions)}
            >
              <Activity className='mr-2 h-3.5 w-3.5' />
              {showAssetPositions ? 'Hide' : 'Show'} live positions
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Bulk selection bar */}
        {selectedLocationIds.length > 0 && (
          <>
            <div className='bg-border mx-1 h-6 w-px' />
            <span className='text-muted-foreground text-sm font-medium'>
              {selectedLocationIds.length} selected
            </span>
            <Select onValueChange={onBulkStatusChange}>
              <SelectTrigger className='w-[130px]' aria-label='Bulk status'>
                <SelectValue placeholder='Bulk Status' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='active'>Active</SelectItem>
                <SelectItem value='maintenance'>Maintenance</SelectItem>
                <SelectItem value='shutdown'>Shutdown</SelectItem>
                <SelectItem value='reserved'>Reserved</SelectItem>
                <SelectItem value='blocked'>Blocked</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
      </div>
    </TooltipProvider>
  )
}

// Created and developed by Jai Singh
