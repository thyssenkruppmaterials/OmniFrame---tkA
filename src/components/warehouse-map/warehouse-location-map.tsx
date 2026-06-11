// Created and developed by Jai Singh
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — generated database.types.ts is not yet regenerated for migrations 235-240
/**
 * WarehouseLocationMap — main warehouse map shell.
 *
 * This is the central wiring component that composes:
 *  - MapToolbar (warehouse picker, layers, edit modes, search, publish, more menu)
 *  - MapCanvas (Konva-based world canvas)
 *  - MiniMap, MapLegend, FloorSwitcher, MapExportButton (overlays)
 *  - LocationDetailPanel, RackConfigPanel (sidebars)
 *  - PublishLayoutDialog, BackgroundUploadDialog, DxfImportDialog (modals)
 *  - RoutePanel, RevisionsPanel, DiagnosticsPanel, MapContextMenu (sheets/menu)
 *  - Rack3DViewer (modal triggered from rack details)
 *  - WarehouseMapAccessibleList (when isListMode)
 *  - AssetPositionOverlay, AisleGraphEditor (Konva layers via map-canvas slots)
 *
 * Data flow:
 *  - Settings via WarehouseMapGate -> passed in.
 *  - Map / layout / mappings via React Query.
 *  - Realtime: subscribe to mappings + aisle + asset positions + auto-map runs.
 *  - All UI state (selection, edit mode, route, floor) lives in
 *    `useWarehouseMapStore`.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPinOff } from 'lucide-react'
import { toast } from 'sonner'
import { usePermissionStore } from '@/stores/permissionStore'
import { useWarehouseMapStore } from '@/stores/warehouse-map-store'
import { supabase } from '@/lib/supabase/client'
import { LX03DataService } from '@/lib/supabase/lx03-data.service'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { Button } from '@/components/ui/button'
import { AssetManagerDialog } from './asset-manager-dialog'
import { BackgroundUploadDialog } from './background-upload-dialog'
import { DiagnosticsPanel } from './diagnostics-panel'
import { DxfImportDialog } from './dxf-import-dialog'
import { EditActionBar } from './edit-action-bar'
import { FacilityTemplatesDialog } from './facility-templates-dialog'
import { FloorSwitcher } from './floor-switcher'
import { KeyboardShortcutsDialog } from './keyboard-shortcuts-dialog'
import { LocationDetailPanel } from './location-detail-panel'
import { MapCanvas } from './map-canvas'
import { MapContextMenu } from './map-context-menu'
import { MapExportButton } from './map-export-button'
import { MapLegend } from './map-legend'
import { MapToolbar } from './map-toolbar'
import { MiniMap } from './mini-map'
import { PublishLayoutDialog } from './publish-layout-dialog'
import { Rack3DViewer } from './rack-3d-viewer'
import { RackConfigPanel } from './rack-config-panel'
import { RevisionsPanel } from './revisions-panel'
import { RoutePanel } from './route-panel'
import type {
  AisleEdge,
  AisleNode,
  AssetPositionLatest,
  MapLayoutResponse,
  Point2D,
  WarehouseLocationMapping,
  WarehouseMapSettings,
  WarehouseRack,
} from './types'
import { WarehouseMapAccessibleList } from './warehouse-map-accessible-list'

// Isometric 3D scene engine — lazy-loaded so three.js / fiber / drei form their
// own async chunk (feature-warehouse-3d) and stay out of this shell's chunk.
const WarehouseScene3D = lazy(() =>
  import('./scene3d').then((m) => ({ default: m.WarehouseScene3D }))
)

interface WarehouseLocationMapProps {
  settings: WarehouseMapSettings
  readOnly: boolean
}

const EXPORT_TARGET_ID = 'warehouse-map-export-root'

function WarehouseLocationMap({
  settings,
  readOnly,
}: WarehouseLocationMapProps) {
  const queryClient = useQueryClient()
  const service = useMemo(() => WarehouseMapService.getInstance(), [])

  // ---- Store state ----------------------------------------------------------

  const selectedWarehouseCode = useWarehouseMapStore(
    (s) => s.selectedWarehouseCode
  )
  const setSelectedWarehouseCode = useWarehouseMapStore(
    (s) => s.setSelectedWarehouseCode
  )
  const sidebarPanel = useWarehouseMapStore((s) => s.sidebarPanel)
  const setSidebarPanel = useWarehouseMapStore((s) => s.setSidebarPanel)
  const editMode = useWarehouseMapStore((s) => s.editMode)
  const setEditMode = useWarehouseMapStore((s) => s.setEditMode)
  const selectedLocationId = useWarehouseMapStore((s) => s.selectedLocationId)
  const setSelectedLocationId = useWarehouseMapStore(
    (s) => s.setSelectedLocationId
  )
  const selectedRackId = useWarehouseMapStore((s) => s.selectedRackId)
  const setSelectedRackId = useWarehouseMapStore((s) => s.setSelectedRackId)
  const searchQuery = useWarehouseMapStore((s) => s.searchQuery)
  const setHighlightedBin = useWarehouseMapStore((s) => s.setHighlightedBin)
  const activeRoute = useWarehouseMapStore((s) => s.activeRoute)
  const isListMode = useWarehouseMapStore((s) => s.isListMode)
  const isDraftDirty = useWarehouseMapStore((s) => s.isDraftDirty)
  const setDraftDirty = useWarehouseMapStore((s) => s.setDraftDirty)
  const showAisleGraph = useWarehouseMapStore((s) => s.showAisleGraph)
  const showAssetPositions = useWarehouseMapStore((s) => s.showAssetPositions)
  const currentFloor = useWarehouseMapStore((s) => s.currentFloor)
  const is3DMode = useWarehouseMapStore((s) => s.is3DMode)
  const highlightedBin = useWarehouseMapStore((s) => s.highlightedBin)

  const hasPermission = usePermissionStore((s) => s.hasPermission)

  // ---- Local state ----------------------------------------------------------

  const [publishOpen, setPublishOpen] = useState(false)
  const [uploadBackgroundOpen, setUploadBackgroundOpen] = useState(false)
  const [importDxfOpen, setImportDxfOpen] = useState(false)
  const [show3DViewer, setShow3DViewer] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  // Browser fullscreen on the whole map shell (toolbar stays usable inside).
  const shellRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement != null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const handleToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else if (shellRef.current) {
      void shellRef.current.requestFullscreen().catch(() => {
        // Fullscreen can be denied (iframe permissions, etc.) — non-fatal.
      })
    }
  }, [])
  const [assetMgrOpen, setAssetMgrOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number } | null
    targetType: 'location' | 'rack' | 'zone' | 'empty' | null
    targetId: string | null
  }>({ position: null, targetType: null, targetId: null })

  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
  const undoStack = useWarehouseMapStore((s) => s.undoStack)
  const redoStack = useWarehouseMapStore((s) => s.redoStack)

  // ---- Warehouses query -----------------------------------------------------

  const { data: lx03Warehouses = [] } = useQuery<string[]>({
    queryKey: ['lx03-warehouses'],
    queryFn: () => LX03DataService.getWarehouses(),
    staleTime: 5 * 60_000,
  })

  // Facilities created from layout templates have their own map rows but no
  // LX03 inventory yet — merge their codes in so the picker can reach them.
  const { data: orgMaps = [] } = useQuery({
    queryKey: ['warehouse-maps-list'],
    queryFn: () => service.listMaps(),
    staleTime: 60_000,
  })

  const warehouses = useMemo(
    () =>
      Array.from(
        new Set([...lx03Warehouses, ...orgMaps.map((m) => m.warehouse_code)])
      ).sort(),
    [lx03Warehouses, orgMaps]
  )

  const [facilitiesOpen, setFacilitiesOpen] = useState(false)

  const warehouseCode =
    selectedWarehouseCode ?? settings.default_warehouse_code ?? ''

  useEffect(() => {
    if (!selectedWarehouseCode) {
      const fallback =
        settings.default_warehouse_code ||
        (warehouses.length > 0 ? warehouses[0] : null)
      if (fallback) setSelectedWarehouseCode(fallback)
    }
  }, [
    selectedWarehouseCode,
    settings.default_warehouse_code,
    warehouses,
    setSelectedWarehouseCode,
  ])

  // ---- Map / layout / mappings ----------------------------------------------

  const { data: map, isLoading: isMapLoading } = useQuery({
    queryKey: ['warehouse-map', warehouseCode],
    queryFn: () => service.getMapByWarehouse(warehouseCode),
    enabled: !!warehouseCode,
    staleTime: 60_000,
  })

  const { data: layout } = useQuery<MapLayoutResponse>({
    queryKey: ['warehouse-map-layout', map?.id],
    queryFn: () => service.getMapLayout(map!.id),
    enabled: !!map?.id,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const { data: mappings = [] } = useQuery<WarehouseLocationMapping[]>({
    queryKey: ['warehouse-map-mappings', map?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouse_location_mappings')
        .select('*')
        .eq('map_id', map!.id)
      if (error) throw error
      return data as unknown as WarehouseLocationMapping[]
    },
    enabled: !!map?.id,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const { data: aisleNodes = [] } = useQuery<AisleNode[]>({
    queryKey: ['warehouse-aisle-nodes', map?.id],
    queryFn: () => service.getAisleNodes(map!.id),
    enabled: !!map?.id && (showAisleGraph || editMode === 'edit-aisles'),
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const { data: aisleEdges = [] } = useQuery<AisleEdge[]>({
    queryKey: ['warehouse-aisle-edges', map?.id],
    queryFn: () => service.getAisleEdges(map!.id),
    enabled: !!map?.id && (showAisleGraph || editMode === 'edit-aisles'),
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  const { data: assetPositions = [] } = useQuery<AssetPositionLatest[]>({
    queryKey: ['warehouse-asset-positions', map?.id, currentFloor],
    queryFn: () => service.getLatestPositions(map!.id, currentFloor),
    enabled: !!map?.id && showAssetPositions,
    staleTime: 5_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  // ---- Background image fetch & cache --------------------------------------

  useEffect(() => {
    if (!layout?.active_background?.storage_path) {
      setBgImage(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const url = await service.getBackgroundSignedUrl(
          layout.active_background.storage_path
        )
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        img.src = url
        img.onload = () => {
          if (!cancelled) setBgImage(img)
        }
      } catch {
        // Silent
      }
    })()
    return () => {
      cancelled = true
    }
  }, [layout?.active_background?.storage_path, service])

  // ---- Realtime: mappings + aisle + assets ---------------------------------
  //
  // Realtime callbacks are debounced (~750ms) and never invalidate the heavy
  // layout query (zones/racks/etc. only change via explicit edit mutations).
  // This prevents query storms when many mappings update in quick succession
  // (e.g. an apply_auto_map_run inserting hundreds of rows or rapid status
  // changes during a cycle count). Without this, each event triggered three
  // refetches → React Query default retry × 3 → browser hits its 6-conn limit
  // → ERR_INSUFFICIENT_RESOURCES cascade.

  useEffect(() => {
    if (!map?.id || !settings.live_updates_enabled) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-mappings', map.id],
      })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-stats', map.id],
      })
    }

    const channel = service.subscribeToMappingChanges(map.id, () => {
      if (timer) return
      timer = setTimeout(flush, 750)
    })

    return () => {
      if (timer) clearTimeout(timer)
      service.unsubscribe(channel)
    }
  }, [map?.id, settings.live_updates_enabled, queryClient, service])

  useEffect(() => {
    if (!map?.id || !(showAisleGraph || editMode === 'edit-aisles')) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      queryClient.invalidateQueries({
        queryKey: ['warehouse-aisle-nodes', map.id],
      })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-aisle-edges', map.id],
      })
    }

    const channel = service.subscribeToAisleGraph(map.id, () => {
      if (timer) return
      timer = setTimeout(flush, 750)
    })

    return () => {
      if (timer) clearTimeout(timer)
      service.unsubscribe(channel)
    }
  }, [map?.id, showAisleGraph, editMode, queryClient, service])

  useEffect(() => {
    if (!map?.id || !showAssetPositions) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      queryClient.invalidateQueries({
        queryKey: ['warehouse-asset-positions', map.id],
      })
    }

    const channel = service.subscribeToAssetPositions(map.id, () => {
      if (timer) return
      timer = setTimeout(flush, 500)
    })

    return () => {
      if (timer) clearTimeout(timer)
      service.unsubscribe(channel)
    }
  }, [map?.id, showAssetPositions, queryClient, service])

  // ---- Search → highlight ---------------------------------------------------

  useEffect(() => {
    if (!searchQuery) {
      setHighlightedBin(null)
      return
    }
    const match = mappings.find((m) =>
      m.storage_bin.toLowerCase().includes(searchQuery.toLowerCase())
    )
    setHighlightedBin(match ? match.storage_bin : null)
  }, [searchQuery, mappings, setHighlightedBin])

  // ---- Mutations ------------------------------------------------------------

  const handleWarehouseChange = (code: string) => {
    setSelectedWarehouseCode(code)
  }

  const handleCreateMap = async () => {
    if (!warehouseCode) return
    await service.createMap({
      warehouse_code: warehouseCode,
      name: `${warehouseCode} Map`,
      is_default: true,
    })
    queryClient.invalidateQueries({
      queryKey: ['warehouse-map', warehouseCode],
    })
  }

  const rackMoveMutation = useMutation({
    mutationFn: ({ id, position }: { id: string; position: Point2D }) =>
      service.updateRack(id, {
        position_x: position.x,
        position_y: position.y,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', map?.id],
      })
      setDraftDirty(true)
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to move rack'),
  })

  const aisleNodeMoveMutation = useMutation({
    mutationFn: ({ id, position }: { id: string; position: Point2D }) =>
      service.updateAisleNode(id, { x: position.x, y: position.y }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-aisle-nodes', map?.id],
      })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const aisleAddMutation = useMutation({
    mutationFn: (point: Point2D) =>
      service.createAisleNode({
        map_id: map!.id,
        x: point.x,
        y: point.y,
        floor_level: currentFloor,
        kind: 'aisle',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-aisle-nodes', map?.id],
      })
    },
  })

  const [aisleConnectFrom, setAisleConnectFrom] = useState<string | null>(null)
  const aisleEdgeMutation = useMutation({
    mutationFn: async (toId: string) => {
      if (!aisleConnectFrom || !map) return
      const a = aisleNodes.find((n) => n.id === aisleConnectFrom)
      const b = aisleNodes.find((n) => n.id === toId)
      if (!a || !b) return
      const cost = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      await service.createAisleEdge({
        map_id: map.id,
        from_node_id: aisleConnectFrom,
        to_node_id: toId,
        cost,
      })
      setAisleConnectFrom(null)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-aisle-edges', map?.id],
      })
      toast.success('Edge created')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const bulkStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const { selectedLocationIds } = useWarehouseMapStore.getState()
      await service.bulkUpdateStatus(
        selectedLocationIds,
        status as Parameters<typeof service.bulkUpdateStatus>[1],
        `Bulk ${status} via toolbar`
      )
    },
    onSuccess: () => {
      toast.success('Bulk status updated')
      useWarehouseMapStore.getState().clearSelection()
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-mappings', map?.id],
      })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ---- Canvas event handlers -----------------------------------------------

  const handleCellClick = useCallback(
    (mappingId: string) => {
      setSelectedLocationId(mappingId)
      setSidebarPanel('location-detail')
    },
    [setSelectedLocationId, setSidebarPanel]
  )

  const handleCellRightClick = useCallback(
    (mappingId: string, pointer: { x: number; y: number }) => {
      setContextMenu({
        position: pointer,
        targetType: 'location',
        targetId: mappingId,
      })
    },
    []
  )

  const handleRackClick = useCallback(
    (rackId: string) => {
      if (editMode === 'view') {
        setSelectedRackId(rackId)
        setSidebarPanel('rack-config')
      }
    },
    [editMode, setSelectedRackId, setSidebarPanel]
  )

  const handleRackRightClick = useCallback(
    (rackId: string, pointer: { x: number; y: number }) => {
      setContextMenu({
        position: pointer,
        targetType: 'rack',
        targetId: rackId,
      })
    },
    []
  )

  const handleEmptyRightClick = useCallback(
    (_world: Point2D, pointer: { x: number; y: number }) => {
      setContextMenu({
        position: pointer,
        targetType: 'empty',
        targetId: null,
      })
    },
    []
  )

  const handleRackMove = useCallback(
    (rackId: string, position: Point2D) => {
      rackMoveMutation.mutate({ id: rackId, position })
    },
    [rackMoveMutation]
  )

  const handleAisleNodeClick = useCallback(
    (nodeId: string) => {
      if (editMode !== 'edit-aisles') return
      if (!aisleConnectFrom) {
        setAisleConnectFrom(nodeId)
        toast.info('Click another node to connect, or click again to cancel')
        return
      }
      if (aisleConnectFrom === nodeId) {
        setAisleConnectFrom(null)
        return
      }
      aisleEdgeMutation.mutate(nodeId)
    },
    [editMode, aisleConnectFrom, aisleEdgeMutation]
  )

  const handleAisleNodeMove = useCallback(
    (id: string, position: Point2D) =>
      aisleNodeMoveMutation.mutate({ id, position }),
    [aisleNodeMoveMutation]
  )

  const handleAisleAdd = useCallback(
    (point: Point2D) => aisleAddMutation.mutate(point),
    [aisleAddMutation]
  )

  const zoneCreateMutation = useMutation({
    mutationFn: (points: Point2D[]) =>
      service.createZone({
        map_id: map!.id,
        name: `Zone ${(layout?.zones.length ?? 0) + 1}`,
        zone_type: 'storage',
        polygon: points,
        color: '#3B82F6',
        opacity: 0.3,
        floor_level: currentFloor,
        sort_order: layout?.zones.length ?? 0,
      } as Parameters<typeof service.createZone>[0]),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', map?.id],
      })
      setDraftDirty(true)
      toast.success('Zone created')
      setEditMode('view')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const buildingUpdateMutation = useMutation({
    mutationFn: (points: Point2D[]) =>
      service.updateMap(map!.id, {
        building_outline: points,
      } as Parameters<typeof service.updateMap>[1]),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', map?.id],
      })
      setDraftDirty(true)
      toast.success('Building outline updated')
      setEditMode('view')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const handleZoneCommit = useCallback(
    (pts: Point2D[]) => zoneCreateMutation.mutate(pts),
    [zoneCreateMutation]
  )

  const handleBuildingCommit = useCallback(
    (pts: Point2D[]) => buildingUpdateMutation.mutate(pts),
    [buildingUpdateMutation]
  )

  // ------ Add / delete / duplicate / rotate rack ----------------------------

  const addRackMutation = useMutation({
    mutationFn: () => {
      const orgIdPromise = (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) throw new Error('Not authenticated')
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user.id)
          .maybeSingle()
        return (profile as { organization_id: string } | null)?.organization_id
      })()
      return orgIdPromise.then((orgId) => {
        if (!orgId) throw new Error('No organization for user')
        // Place new rack at the centre of the current viewport in world coords.
        const { viewport } = useWarehouseMapStore.getState()
        const cx = (window.innerWidth / 2 - viewport.x) / viewport.scale
        const cy = (window.innerHeight / 2 - viewport.y) / viewport.scale
        return service.createRack({
          map_id: map!.id,
          organization_id: orgId,
          label: `RACK-${(layout?.racks.length ?? 0) + 1}`,
          rack_type: 'shelving',
          position_x: Math.max(0, cx - 60),
          position_y: Math.max(0, cy - 30),
          rotation: 0,
          width: 120,
          height: 60,
          rows: 4,
          columns: 6,
          aisle: null,
          metadata: {},
          zone_id: null,
        } as Parameters<typeof service.createRack>[0])
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', map?.id],
      })
      setDraftDirty(true)
      toast.success('Rack added')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteRackMutation = useMutation({
    mutationFn: (id: string) => service.deleteRack(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', map?.id],
      })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-mappings', map?.id],
      })
      setDraftDirty(true)
      setSelectedRackId(null)
      toast.success('Rack deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const duplicateRackMutation = useMutation({
    mutationFn: async (id: string) => {
      const src = layout?.racks.find((r) => r.id === id)
      if (!src) throw new Error('Rack not found')
      const orgIdPromise = (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) throw new Error('Not authenticated')
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user.id)
          .maybeSingle()
        return (profile as { organization_id: string } | null)?.organization_id
      })()
      const orgId = await orgIdPromise
      if (!orgId) throw new Error('No organization for user')
      return service.createRack({
        map_id: map!.id,
        organization_id: orgId,
        label: `${src.label}-COPY`,
        rack_type: src.rack_type,
        position_x: src.position_x + 20,
        position_y: src.position_y + 20,
        rotation: src.rotation,
        width: src.width,
        height: src.height,
        rows: src.rows,
        columns: src.columns,
        aisle: src.aisle,
        metadata: src.metadata ?? {},
        zone_id: src.zone_id,
      } as Parameters<typeof service.createRack>[0])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', map?.id],
      })
      setDraftDirty(true)
      toast.success('Rack duplicated')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const rotateRackMutation = useMutation({
    mutationFn: ({ id, delta }: { id: string; delta: number }) => {
      const rack = layout?.racks.find((r) => r.id === id)
      if (!rack) throw new Error('Rack not found')
      const newRotation = ((rack.rotation ?? 0) + delta + 360) % 360
      return service.updateRack(id, { rotation: newRotation })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', map?.id],
      })
      setDraftDirty(true)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteZoneMutation = useMutation({
    mutationFn: (id: string) => service.deleteZone(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-layout', map?.id],
      })
      setDraftDirty(true)
      toast.success('Zone deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ------ Aisle bulk operations ---------------------------------------------

  const autoConnectMutation = useMutation({
    mutationFn: () => service.autoConnectAisleNodes(map!.id, 4),
    onSuccess: (count) => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-aisle-edges', map?.id],
      })
      toast.success(`Created ${count} edges (k=4)`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const seedNodesMutation = useMutation({
    mutationFn: () => service.seedAisleNodesFromRacks(map!.id),
    onSuccess: (count) => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-aisle-nodes', map?.id],
      })
      toast.success(`Seeded ${count} aisle nodes`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const backfillAnchorsMutation = useMutation({
    mutationFn: () => service.backfillMappingNearestNode(map!.id),
    onSuccess: (count) => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-map-mappings', map?.id],
      })
      toast.success(`Anchored ${count} bins to aisle nodes`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const clearAisleGraphMutation = useMutation({
    mutationFn: async () => {
      // Cascade-deletes edges via FK, but fast-path: clear edges then nodes.
      const { error: e1 } = await supabase
        .from('warehouse_aisle_edges')
        .delete()
        .eq('map_id', map!.id)
      if (e1) throw e1
      const { error: e2 } = await supabase
        .from('warehouse_aisle_nodes')
        .delete()
        .eq('map_id', map!.id)
      if (e2) throw e2
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['warehouse-aisle-edges', map?.id],
      })
      queryClient.invalidateQueries({
        queryKey: ['warehouse-aisle-nodes', map?.id],
      })
      toast.success('Aisle graph cleared')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ------ Keyboard shortcuts -------------------------------------------------

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const isTyping =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (isTyping) return

      // Help
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setHelpOpen(true)
        return
      }

      // 3D toggle
      if (e.key === '3' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        useWarehouseMapStore.getState().toggle3DMode()
        return
      }
      if (e.key === '2' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        useWarehouseMapStore.getState().set3DMode(false)
        return
      }

      // Fit to view
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useWarehouseMapStore.getState().setViewport({ x: 0, y: 0, scale: 1 })
        return
      }

      // Zoom
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        useWarehouseMapStore.getState().zoomIn()
        return
      }
      if (e.key === '-') {
        e.preventDefault()
        useWarehouseMapStore.getState().zoomOut()
        return
      }

      // Edit-rack hotkeys
      if (editMode === 'edit-racks' && selectedRackId) {
        if (e.key === 'r' || e.key === 'R') {
          e.preventDefault()
          rotateRackMutation.mutate({ id: selectedRackId, delta: 90 })
          return
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          deleteRackMutation.mutate(selectedRackId)
          return
        }
        if (e.key === 'd' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          duplicateRackMutation.mutate(selectedRackId)
          return
        }
      }

      // Escape exits any edit mode
      if (e.key === 'Escape' && editMode !== 'view') {
        setEditMode('view')
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [
    editMode,
    selectedRackId,
    rotateRackMutation,
    deleteRackMutation,
    duplicateRackMutation,
    setEditMode,
  ])

  // ---- Layout-derived values (must be declared before any early return so
  //      hooks are called unconditionally on every render). --------------------

  const currentRevision = (layout as MapLayoutResponse | undefined)
    ?.current_revision_number

  const selectedRackForViewer: WarehouseRack | null = useMemo(
    () => layout?.racks.find((r) => r.id === show3DViewer) ?? null,
    [layout?.racks, show3DViewer]
  )

  // ---- Empty state ----------------------------------------------------------

  const canCreate = hasPermission('manage', 'warehouse_maps')

  if (!isMapLoading && !map && warehouseCode) {
    return (
      <div className='flex h-[calc(100vh-200px)] flex-col gap-3 p-4'>
        <MapToolbar
          settings={settings}
          readOnly={readOnly}
          warehouses={warehouses}
          mappings={[]}
          onWarehouseChange={handleWarehouseChange}
          onPublish={() => setPublishOpen(true)}
          onUploadBackground={() => setUploadBackgroundOpen(true)}
          onImportDxf={() => setImportDxfOpen(true)}
          onShowRevisions={() => setSidebarPanel('revisions')}
          onShowDiagnostics={() => setSidebarPanel('diagnostics')}
          onShowNavigate={() => setSidebarPanel('route')}
          onShowAssets={() => setAssetMgrOpen(true)}
          onShowHelp={() => setHelpOpen(true)}
          onShowFacilities={() => setFacilitiesOpen(true)}
          onBulkStatusChange={(s) => bulkStatusMutation.mutate(s)}
          isDraftDirty={isDraftDirty}
        />
        <div className='flex flex-1 items-center justify-center'>
          <div className='bg-card flex max-w-md flex-col items-center gap-4 rounded-xl border p-10 text-center shadow-sm'>
            <MapPinOff className='text-muted-foreground h-10 w-10' />
            <h2 className='text-lg font-semibold'>No Map Found</h2>
            <p className='text-muted-foreground text-sm'>
              No warehouse map exists for <strong>{warehouseCode}</strong> yet.
            </p>
            <div className='flex gap-2'>
              {canCreate && (
                <Button onClick={handleCreateMap}>Create Map</Button>
              )}
              <Button variant='outline' onClick={() => setFacilitiesOpen(true)}>
                From template…
              </Button>
            </div>
          </div>
        </div>
        <FacilityTemplatesDialog
          open={facilitiesOpen}
          mapId={null}
          onClose={() => setFacilitiesOpen(false)}
          onFacilityCreated={handleWarehouseChange}
        />
      </div>
    )
  }

  // ---- Layout ---------------------------------------------------------------

  return (
    <div
      ref={shellRef}
      className={`bg-background flex flex-col gap-3 p-4 ${
        isFullscreen ? 'h-screen' : 'h-[calc(100vh-200px)]'
      }`}
      data-warehouse-map-shell
    >
      <MapToolbar
        settings={settings}
        readOnly={readOnly}
        warehouses={warehouses}
        mappings={mappings}
        onWarehouseChange={handleWarehouseChange}
        onPublish={() => setPublishOpen(true)}
        onUploadBackground={() => setUploadBackgroundOpen(true)}
        onImportDxf={() => setImportDxfOpen(true)}
        onShowRevisions={() => setSidebarPanel('revisions')}
        onShowDiagnostics={() => setSidebarPanel('diagnostics')}
        onShowNavigate={() => setSidebarPanel('route')}
        onShowAssets={() => setAssetMgrOpen(true)}
        onShowHelp={() => setHelpOpen(true)}
        onShowFacilities={() => setFacilitiesOpen(true)}
        onBulkStatusChange={(s) => bulkStatusMutation.mutate(s)}
        isDraftDirty={isDraftDirty}
        exportTargetId={EXPORT_TARGET_ID}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
      />

      <EditActionBar
        selectedRackId={selectedRackId}
        selectedZoneId={null}
        selectedAisleNodeId={aisleConnectFrom}
        hasUndo={undoStack.length > 0}
        hasRedo={redoStack.length > 0}
        onUndo={() => useWarehouseMapStore.getState().popUndo()}
        onRedo={() => useWarehouseMapStore.getState().popRedo()}
        onAddRack={() => addRackMutation.mutate()}
        onDeleteRack={(id) => deleteRackMutation.mutate(id)}
        onRotateRack={(id, delta) => rotateRackMutation.mutate({ id, delta })}
        onDuplicateRack={(id) => duplicateRackMutation.mutate(id)}
        onDeleteZone={(id) => deleteZoneMutation.mutate(id)}
        onAutoConnectAisles={() => autoConnectMutation.mutate()}
        onSeedAisleNodes={() => seedNodesMutation.mutate()}
        onBackfillAnchors={() => backfillAnchorsMutation.mutate()}
        onClearAisleGraph={() => clearAisleGraphMutation.mutate()}
        onShowHelp={() => setHelpOpen(true)}
      />

      {/* Map canvas + overlays OR list mode */}
      {isListMode && map ? (
        <div className='flex-1 overflow-auto rounded-lg border p-4'>
          <WarehouseMapAccessibleList
            mapId={map.id}
            settings={settings}
            readOnly={readOnly}
          />
        </div>
      ) : (
        <div
          id={EXPORT_TARGET_ID}
          className='relative flex-1 overflow-hidden rounded-lg border'
        >
          {is3DMode ? (
            <Suspense
              fallback={
                <div className='bg-muted/40 text-muted-foreground flex h-full w-full items-center justify-center rounded-lg text-sm'>
                  Loading 3D warehouse…
                </div>
              }
            >
              <WarehouseScene3D
                layout={layout ?? null}
                mappings={mappings}
                routePolyline={activeRoute?.polyline ?? null}
                assetPositions={assetPositions}
                aisleNodes={aisleNodes}
                aisleEdges={aisleEdges}
                highlightedBin={highlightedBin}
                canEdit={!readOnly}
                onCellClick={handleCellClick}
                onRackClick={handleRackClick}
              />
            </Suspense>
          ) : (
            <MapCanvas
              layout={layout ?? null}
              mappings={mappings}
              readOnly={readOnly}
              routePolyline={activeRoute?.polyline ?? null}
              assetPositions={assetPositions}
              aisleNodes={aisleNodes}
              aisleEdges={aisleEdges}
              backgroundImage={bgImage}
              onCellClick={handleCellClick}
              onCellRightClick={handleCellRightClick}
              onRackClick={handleRackClick}
              onRackRightClick={handleRackRightClick}
              onEmptyRightClick={handleEmptyRightClick}
              onRackMove={handleRackMove}
              onAisleNodeClick={handleAisleNodeClick}
              onAisleNodeMove={handleAisleNodeMove}
              onAisleAdd={handleAisleAdd}
              onZoneCommit={handleZoneCommit}
              onBuildingCommit={handleBuildingCommit}
              gridSnap={
                (
                  layout?.map?.grid_settings as {
                    size?: number
                    snap?: boolean
                  }
                )?.snap
                  ? ((
                      layout?.map?.grid_settings as {
                        size?: number
                      }
                    )?.size ?? 0)
                  : 0
              }
            />
          )}

          {/* Mini-map (only in 2D — viewport state is 2D-only) */}
          {!is3DMode && <MiniMap layout={layout ?? null} />}

          {/* Legend (bottom-left). In 3D the scene HUD's compass/scale cluster
              is shifted to bottom-center so it never sits under this card.
              Hidden entirely while the 3D object editor is open — the
              "Add to layout" library owns the left edge there and the legend
              card was covering its lower categories. */}
          {map?.id && !(is3DMode && editMode === 'edit-objects') ? (
            <MapLegend mapId={map.id} />
          ) : null}

          {/* Floor switcher. In 3D the scene HUD owns the top-right corner
              (insights / weather / edit), so drop the switcher to the
              vertically-centred right edge to avoid overlapping it. */}
          <FloorSwitcher
            layout={layout ?? null}
            className={is3DMode ? 'top-1/2 -translate-y-1/2' : undefined}
          />

          {/* Export button — 2D only. The 3D scene renders its own PNG export
              in the scene HUD (a WebGL canvas can't be captured by the DOM
              html-to-image path this button uses), so showing it in 3D both
              duplicated the action and collided with the camera-mode toggle. */}
          {!is3DMode && (
            <div className='absolute top-4 left-4 z-10'>
              <MapExportButton targetElementId={EXPORT_TARGET_ID} />
            </div>
          )}

          {/* Revision badge + dirty indicator */}
          {currentRevision != null && (
            <div className='bg-card/80 absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-md border px-3 py-1 text-xs shadow-sm backdrop-blur-sm'>
              <span className='text-muted-foreground'>Revision</span>{' '}
              <span className='font-mono font-medium'>v{currentRevision}</span>
              {isDraftDirty && (
                <span className='text-amber-400'> · unsaved changes</span>
              )}
            </div>
          )}

          {/* Edit-mode hint — 2D only. The 3D scene editor ('edit-objects')
              has its own on-canvas affordances + bottom-right nav hint, so this
              Konva-era banner would be a duplicate (and would collide with the
              scene HUD's bottom-centre widgets) in 3D. */}
          {!is3DMode && editMode !== 'view' && (
            <div className='absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs text-amber-300'>
              <span className='capitalize'>{editMode.replace('-', ' ')}</span>
              <span className='ml-2 opacity-70'>
                {editMode === 'edit-racks' && 'Drag racks to move'}
                {editMode === 'edit-aisles' &&
                  (aisleConnectFrom
                    ? 'Click another node to connect, or click same node to cancel'
                    : 'Click empty space to add a node, click two nodes to connect')}
                {editMode === 'edit-zones' && 'Click vertices to draw zones'}
                {editMode === 'edit-building' &&
                  'Click vertices to define the building outline'}
              </span>
              <Button
                variant='ghost'
                size='sm'
                className='ml-3 h-6 px-2'
                onClick={() => setEditMode('view')}
              >
                Done
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---- Sidebars / sheets ---- */}
      {map && selectedLocationId && sidebarPanel === 'location-detail' && (
        <LocationDetailPanel
          mappingId={selectedLocationId}
          mapId={map.id}
          readOnly={readOnly}
          onClose={() => {
            setSelectedLocationId(null)
            setSidebarPanel('none')
          }}
        />
      )}

      {map && selectedRackId && sidebarPanel === 'rack-config' && (
        <RackConfigPanel
          rackId={selectedRackId}
          mapId={map.id}
          onClose={() => {
            setSelectedRackId(null)
            setSidebarPanel('none')
          }}
        />
      )}

      {map && (
        <RoutePanel
          mapId={map.id}
          mappings={mappings}
          open={sidebarPanel === 'route'}
          onClose={() => setSidebarPanel('none')}
        />
      )}

      <RevisionsPanel
        mapId={map?.id ?? null}
        open={sidebarPanel === 'revisions'}
        onClose={() => setSidebarPanel('none')}
      />

      <DiagnosticsPanel
        mapId={map?.id ?? null}
        open={sidebarPanel === 'diagnostics'}
        onClose={() => setSidebarPanel('none')}
      />

      {/* 3D rack viewer */}
      {settings.show_3d_viewer && (
        <Rack3DViewer
          rackId={show3DViewer}
          rack={selectedRackForViewer}
          locations={mappings.filter((m) => m.rack_id === show3DViewer)}
          onClose={() => setShow3DViewer(null)}
        />
      )}

      {/* Modals */}
      {map && (
        <PublishLayoutDialog
          mapId={map.id}
          open={publishOpen}
          expectedRevision={currentRevision}
          onClose={() => setPublishOpen(false)}
          onPublished={() => {
            setPublishOpen(false)
            setDraftDirty(false)
          }}
        />
      )}

      {map && (
        <BackgroundUploadDialog
          mapId={map.id}
          open={uploadBackgroundOpen}
          onClose={() => setUploadBackgroundOpen(false)}
        />
      )}

      {map && (
        <DxfImportDialog
          mapId={map.id}
          open={importDxfOpen}
          onClose={() => setImportDxfOpen(false)}
          onImported={() => {
            queryClient.invalidateQueries({
              queryKey: ['warehouse-map-layout', map.id],
            })
            queryClient.invalidateQueries({
              queryKey: ['warehouse-aisle-nodes', map.id],
            })
            queryClient.invalidateQueries({
              queryKey: ['warehouse-aisle-edges', map.id],
            })
          }}
        />
      )}

      {/* Facilities & layout templates */}
      <FacilityTemplatesDialog
        open={facilitiesOpen}
        mapId={map?.id ?? null}
        currentLabel={map?.name ?? warehouseCode}
        onClose={() => setFacilitiesOpen(false)}
        onFacilityCreated={handleWarehouseChange}
      />

      {/* Help / shortcuts */}
      <KeyboardShortcutsDialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />

      {/* Asset manager */}
      {map && (
        <AssetManagerDialog
          mapId={map.id}
          open={assetMgrOpen}
          onClose={() => setAssetMgrOpen(false)}
        />
      )}

      {/* Context menu */}
      <MapContextMenu
        position={contextMenu.position}
        targetType={contextMenu.targetType}
        targetId={contextMenu.targetId}
        targetBin={
          contextMenu.targetType === 'location' && contextMenu.targetId
            ? (mappings.find((m) => m.id === contextMenu.targetId)
                ?.storage_bin ?? null)
            : null
        }
        onView3D={(rackId) => setShow3DViewer(rackId)}
        onClose={() =>
          setContextMenu({ position: null, targetType: null, targetId: null })
        }
        readOnly={readOnly}
      />
    </div>
  )
}

export default WarehouseLocationMap

// Created and developed by Jai Singh
