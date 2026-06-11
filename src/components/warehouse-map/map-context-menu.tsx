// Created and developed by Jai Singh
/**
 * MapContextMenu — right-click menu for cells, racks, zones, and empty space.
 * Driven by parent props; uses the warehouse-map store for navigation.
 */
import { useEffect, useRef } from 'react'
import {
  Eye,
  Copy,
  Wrench,
  PowerOff,
  Settings2,
  MousePointerSquareDashed,
  RefreshCcw,
  PlusCircle,
  Box,
  Navigation,
  ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { usePermissionStore } from '@/stores/permissionStore'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'

type TargetType = 'location' | 'rack' | 'zone' | 'empty' | null

interface MapContextMenuProps {
  position: { x: number; y: number } | null
  targetType: TargetType
  targetId: string | null
  /** Optional bin label for "Navigate from here" or "Copy Bin ID" actions. */
  targetBin?: string | null
  onClose: () => void
  readOnly: boolean
  /** Open the 3D viewer for the targeted rack. */
  onView3D?: (rackId: string) => void
}

export function MapContextMenu({
  position,
  targetType,
  targetId,
  targetBin,
  onClose,
  readOnly,
  onView3D,
}: MapContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  const hasPermission = usePermissionStore((s) => s.hasPermission)
  const canManage = hasPermission('manage', 'warehouse_maps')
  const canEdit = hasPermission('update', 'warehouse_maps')

  const setSelectedLocationId = useWarehouseMapStore(
    (s) => s.setSelectedLocationId
  )
  const setSelectedRackId = useWarehouseMapStore((s) => s.setSelectedRackId)
  const setSidebarPanel = useWarehouseMapStore((s) => s.setSidebarPanel)
  const setRouteFromBin = useWarehouseMapStore((s) => s.setRouteFromBin)
  const editMode = useWarehouseMapStore((s) => s.editMode)

  const isEditMode = editMode !== 'view'
  const isOpen = !!position && !!targetType

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  if (!isOpen || !position) return null

  const handleViewDetails = () => {
    if (targetId) {
      setSelectedLocationId(targetId)
      setSidebarPanel('location-detail')
    }
    onClose()
  }

  const handleCopyBinId = () => {
    if (targetBin) {
      void navigator.clipboard.writeText(targetBin)
      toast.success('Bin ID copied')
    }
    onClose()
  }

  const handleNavigateFrom = () => {
    if (targetBin) {
      setRouteFromBin(targetBin)
      setSidebarPanel('route')
    }
    onClose()
  }

  const handleStatusAction = (_action: 'maintenance' | 'shutdown') => {
    if (targetId) {
      setSelectedLocationId(targetId)
      setSidebarPanel('location-detail')
    }
    onClose()
  }

  const handleConfigureRack = () => {
    if (targetId) {
      setSelectedRackId(targetId)
      setSidebarPanel('rack-config')
    }
    onClose()
  }

  const handleView3D = () => {
    if (targetId && onView3D) onView3D(targetId)
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className='fixed z-50'
      style={{ top: position.y, left: position.x }}
    >
      <DropdownMenu
        open
        modal={false}
        onOpenChange={(open) => !open && onClose()}
      >
        <DropdownMenuContent align='start' sideOffset={0} className='w-56'>
          {targetType === 'location' && (
            <>
              <DropdownMenuLabel className='text-xs'>
                {targetBin ?? 'Location'}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={handleViewDetails}>
                <Eye className='mr-2 h-3.5 w-3.5' />
                View details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyBinId}>
                <Copy className='mr-2 h-3.5 w-3.5' />
                Copy bin ID
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleNavigateFrom}>
                <Navigation className='mr-2 h-3.5 w-3.5' />
                Navigate from here
              </DropdownMenuItem>
              {!readOnly && canManage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleStatusAction('maintenance')}
                  >
                    <Wrench className='mr-2 h-3.5 w-3.5' />
                    Send to maintenance
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleStatusAction('shutdown')}
                    className='text-destructive focus:text-destructive'
                  >
                    <PowerOff className='mr-2 h-3.5 w-3.5' />
                    Shut down
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}

          {targetType === 'rack' && (
            <>
              <DropdownMenuLabel className='text-xs'>Rack</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleConfigureRack}>
                <Settings2 className='mr-2 h-3.5 w-3.5' />
                Configure rack
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleView3D}>
                <Box className='mr-2 h-3.5 w-3.5' />
                View in 3D
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleConfigureRack}>
                <MousePointerSquareDashed className='mr-2 h-3.5 w-3.5' />
                Select all locations
              </DropdownMenuItem>
              {!readOnly && canManage && (
                <DropdownMenuItem onClick={handleConfigureRack}>
                  <RefreshCcw className='mr-2 h-3.5 w-3.5' />
                  Bulk status change
                </DropdownMenuItem>
              )}
            </>
          )}

          {targetType === 'zone' && (
            <>
              <DropdownMenuLabel className='text-xs'>Zone</DropdownMenuLabel>
              <DropdownMenuItem onClick={onClose}>
                <MousePointerSquareDashed className='mr-2 h-3.5 w-3.5' />
                Select all racks
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onClose}>
                <ArrowRight className='mr-2 h-3.5 w-3.5' />
                Open zone settings
              </DropdownMenuItem>
            </>
          )}

          {targetType === 'empty' && isEditMode && !readOnly && canEdit && (
            <>
              <DropdownMenuLabel className='text-xs'>Canvas</DropdownMenuLabel>
              <DropdownMenuItem onClick={onClose}>
                <PlusCircle className='mr-2 h-3.5 w-3.5' />
                Add rack here
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// Created and developed by Jai Singh
