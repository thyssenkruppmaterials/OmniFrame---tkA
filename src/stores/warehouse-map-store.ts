// Created and developed by Jai Singh
import { create } from 'zustand'
import type {
  CameraMode,
  SceneQuality,
} from '@/components/warehouse-map/scene3d/scene-config'
import type {
  EditMode,
  DataLayer,
  SidebarPanel,
  RouteResponse,
  SceneObjectKind,
} from '@/components/warehouse-map/types'

interface UndoEntry {
  type: string
  payload: unknown
  inverse?: unknown
  timestamp: number
}

interface Viewport {
  x: number
  y: number
  scale: number
}

interface WarehouseMapState {
  selectedMapId: string | null
  selectedWarehouseCode: string | null
  selectedZoneId: string | null
  selectedRackId: string | null
  selectedLocationId: string | null
  selectedLocationIds: string[]
  editMode: EditMode
  activeDataLayer: DataLayer
  viewport: Viewport
  sidebarPanel: SidebarPanel
  searchQuery: string
  highlightedBin: string | null
  routeFromBin: string | null
  activeRoute: RouteResponse | null
  showAssetPositions: boolean
  showAisleGraph: boolean
  currentFloor: number
  isListMode: boolean
  is3DMode: boolean
  // ---- 3D scene engine (isometric scene is the primary experience) ----
  cameraMode: CameraMode
  sceneQuality: SceneQuality
  weatherOverlayEnabled: boolean
  /** Bin/rack/object the camera should ease-focus on (cleared after consumed). */
  focusObjectId: string | null
  /** Primary selected scene object (single-selection → config panel). Derived. */
  selectedObjectId: string | null
  /** Full multi-selection set of scene objects (batch ops / align / nudge). */
  selectedObjectIds: string[]
  /** Catalog kind queued for placement (next floor click drops it), or null. */
  placingKind: SceneObjectKind | null
  isDraftDirty: boolean
  publishConflict: boolean
  showDiagnostics: boolean
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]

  setSelectedMapId: (id: string | null) => void
  setSelectedWarehouseCode: (code: string | null) => void
  setSelectedZoneId: (id: string | null) => void
  setSelectedRackId: (id: string | null) => void
  setSelectedLocationId: (id: string | null) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  toggleSelection: (id: string) => void
  clearSelection: () => void
  selectAll: (ids: string[]) => void
  setEditMode: (mode: EditMode) => void
  setActiveDataLayer: (layer: DataLayer) => void
  setViewport: (viewport: Viewport) => void
  zoomIn: () => void
  zoomOut: () => void
  fitToView: (bounds: {
    x: number
    y: number
    width: number
    height: number
    containerWidth?: number
    containerHeight?: number
  }) => void
  setSidebarPanel: (panel: SidebarPanel) => void
  setSearchQuery: (query: string) => void
  setHighlightedBin: (bin: string | null) => void
  setRouteFromBin: (bin: string | null) => void
  setActiveRoute: (route: RouteResponse | null) => void
  clearRoute: () => void
  setShowAssetPositions: (show: boolean) => void
  setShowAisleGraph: (show: boolean) => void
  setCurrentFloor: (floor: number) => void
  toggleListMode: () => void
  toggle3DMode: () => void
  set3DMode: (on: boolean) => void
  setCameraMode: (mode: CameraMode) => void
  setSceneQuality: (q: SceneQuality) => void
  setWeatherOverlay: (on: boolean) => void
  toggleWeatherOverlay: () => void
  setFocusObjectId: (id: string | null) => void
  setSelectedObjectId: (id: string | null) => void
  setSelectedObjects: (ids: string[]) => void
  toggleObjectSelection: (id: string) => void
  setPlacingKind: (kind: SceneObjectKind | null) => void
  setDraftDirty: (dirty: boolean) => void
  setPublishConflict: (conflict: boolean) => void
  toggleDiagnostics: () => void
  pushUndo: (action: {
    type: string
    payload: unknown
    inverse?: unknown
  }) => void
  popUndo: () => UndoEntry | null
  popRedo: () => UndoEntry | null
  clearUndoHistory: () => void
  reset: () => void
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 }

const INITIAL_STATE = {
  selectedMapId: null as string | null,
  selectedWarehouseCode: null as string | null,
  selectedZoneId: null as string | null,
  selectedRackId: null as string | null,
  selectedLocationId: null as string | null,
  selectedLocationIds: [] as string[],
  editMode: 'view' as EditMode,
  activeDataLayer: 'status' as DataLayer,
  viewport: DEFAULT_VIEWPORT,
  sidebarPanel: 'none' as SidebarPanel,
  searchQuery: '',
  highlightedBin: null as string | null,
  routeFromBin: null as string | null,
  activeRoute: null as RouteResponse | null,
  showAssetPositions: false,
  showAisleGraph: false,
  currentFloor: 0,
  isListMode: false,
  // 3D isometric scene is the DEFAULT experience (the overhaul); the Konva 2D
  // schematic is now an opt-in toggle. setEditMode still drops to 2D for the
  // legacy Konva editor until 3D editing lands (Phase 4).
  is3DMode: true,
  cameraMode: 'iso' as CameraMode,
  sceneQuality: 'high' as SceneQuality,
  weatherOverlayEnabled: true,
  focusObjectId: null as string | null,
  selectedObjectId: null as string | null,
  selectedObjectIds: [] as string[],
  placingKind: null as SceneObjectKind | null,
  isDraftDirty: false,
  publishConflict: false,
  showDiagnostics: false,
  undoStack: [] as UndoEntry[],
  redoStack: [] as UndoEntry[],
}

export const useWarehouseMapStore = create<WarehouseMapState>((set, get) => ({
  ...INITIAL_STATE,

  setSelectedMapId: (id) => set({ selectedMapId: id }),
  setSelectedWarehouseCode: (code) => set({ selectedWarehouseCode: code }),
  setSelectedZoneId: (id) => set({ selectedZoneId: id }),
  setSelectedRackId: (id) => set({ selectedRackId: id }),
  setSelectedLocationId: (id) => set({ selectedLocationId: id }),

  addToSelection: (id) =>
    set((state) => ({
      selectedLocationIds: state.selectedLocationIds.includes(id)
        ? state.selectedLocationIds
        : [...state.selectedLocationIds, id],
    })),
  removeFromSelection: (id) =>
    set((state) => ({
      selectedLocationIds: state.selectedLocationIds.filter((i) => i !== id),
    })),
  toggleSelection: (id) =>
    set((state) => ({
      selectedLocationIds: state.selectedLocationIds.includes(id)
        ? state.selectedLocationIds.filter((i) => i !== id)
        : [...state.selectedLocationIds, id],
    })),
  clearSelection: () => set({ selectedLocationIds: [] }),
  selectAll: (ids) => set({ selectedLocationIds: ids }),

  setEditMode: (mode) =>
    set((state) => ({
      editMode: mode,
      selectedLocationIds: [],
      sidebarPanel: 'none',
      selectedObjectId: null,
      placingKind: null,
      // The legacy edit modes (building/zones/racks/aisles) are Konva-based 2D
      // interactions → auto-switch out of 3D. The new 'edit-objects' mode IS the
      // 3D scene editor, so it stays in 3D.
      is3DMode:
        mode === 'view' || mode === 'edit-objects' ? state.is3DMode : false,
    })),

  setActiveDataLayer: (layer) => set({ activeDataLayer: layer }),
  setViewport: (viewport) => set({ viewport }),

  zoomIn: () =>
    set((state) => ({
      viewport: {
        ...state.viewport,
        scale: Math.min(state.viewport.scale * 1.2, 5),
      },
    })),
  zoomOut: () =>
    set((state) => ({
      viewport: {
        ...state.viewport,
        scale: Math.max(state.viewport.scale * 0.8, 0.1),
      },
    })),
  fitToView: (bounds) =>
    set(() => {
      const containerWidth = bounds.containerWidth ?? window.innerWidth - 200
      const containerHeight = bounds.containerHeight ?? window.innerHeight - 300
      if (bounds.width <= 0 || bounds.height <= 0) {
        return { viewport: DEFAULT_VIEWPORT }
      }
      const scaleX = containerWidth / bounds.width
      const scaleY = containerHeight / bounds.height
      const scale = Math.min(Math.max(Math.min(scaleX, scaleY) * 0.9, 0.1), 5)
      const offsetX = containerWidth / 2 - (bounds.x + bounds.width / 2) * scale
      const offsetY =
        containerHeight / 2 - (bounds.y + bounds.height / 2) * scale
      return {
        viewport: { x: offsetX, y: offsetY, scale },
      }
    }),

  setSidebarPanel: (panel) => set({ sidebarPanel: panel }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setHighlightedBin: (bin) => set({ highlightedBin: bin }),
  setRouteFromBin: (bin) => set({ routeFromBin: bin }),
  setActiveRoute: (route) =>
    set({ activeRoute: route, sidebarPanel: route ? 'route' : 'none' }),
  clearRoute: () =>
    set({ activeRoute: null, routeFromBin: null, sidebarPanel: 'none' }),
  setShowAssetPositions: (show) => set({ showAssetPositions: show }),
  setShowAisleGraph: (show) => set({ showAisleGraph: show }),
  setCurrentFloor: (floor) => set({ currentFloor: floor }),
  toggleListMode: () => set((state) => ({ isListMode: !state.isListMode })),
  // Entering 3D drops any active (Konva-only) edit mode so edit chrome never
  // floats over the non-editable 3D scene. Mirrors setEditMode's "editing ⇒ 2D"
  // guard in the inverse direction. (Remove the editMode reset once Phase 4
  // brings in-scene 3D editing.)
  toggle3DMode: () =>
    set((state) => {
      const next = !state.is3DMode
      return next
        ? { is3DMode: true, editMode: 'view', sidebarPanel: 'none' }
        : { is3DMode: false }
    }),
  set3DMode: (on) =>
    set(
      on
        ? { is3DMode: true, editMode: 'view', sidebarPanel: 'none' }
        : { is3DMode: false }
    ),
  setCameraMode: (mode) => set({ cameraMode: mode }),
  setSceneQuality: (q) => set({ sceneQuality: q }),
  setWeatherOverlay: (on) => set({ weatherOverlayEnabled: on }),
  toggleWeatherOverlay: () =>
    set((state) => ({ weatherOverlayEnabled: !state.weatherOverlayEnabled })),
  setFocusObjectId: (id) => set({ focusObjectId: id }),
  setSelectedObjectId: (id) =>
    set({
      selectedObjectId: id,
      selectedObjectIds: id ? [id] : [],
      sidebarPanel: id ? 'object-config' : 'none',
    }),
  setSelectedObjects: (ids) =>
    set({
      selectedObjectIds: ids,
      selectedObjectId: ids.length === 1 ? ids[0] : null,
      sidebarPanel: ids.length === 1 ? 'object-config' : 'none',
    }),
  toggleObjectSelection: (id) =>
    set((state) => {
      const has = state.selectedObjectIds.includes(id)
      const ids = has
        ? state.selectedObjectIds.filter((x) => x !== id)
        : [...state.selectedObjectIds, id]
      return {
        selectedObjectIds: ids,
        selectedObjectId: ids.length === 1 ? ids[0] : null,
        sidebarPanel: ids.length === 1 ? 'object-config' : 'none',
      }
    }),
  setPlacingKind: (kind) => set({ placingKind: kind }),
  setDraftDirty: (dirty) => set({ isDraftDirty: dirty }),
  setPublishConflict: (conflict) => set({ publishConflict: conflict }),
  toggleDiagnostics: () =>
    set((state) => ({ showDiagnostics: !state.showDiagnostics })),

  pushUndo: (action) =>
    set((state) => ({
      undoStack: [...state.undoStack, { ...action, timestamp: Date.now() }],
      redoStack: [],
    })),
  popUndo: () => {
    const { undoStack, redoStack } = get()
    if (undoStack.length === 0) return null
    const entry = undoStack[undoStack.length - 1]
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, entry],
    })
    return entry
  },
  popRedo: () => {
    const { undoStack, redoStack } = get()
    if (redoStack.length === 0) return null
    const entry = redoStack[redoStack.length - 1]
    set({
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, entry],
    })
    return entry
  },
  clearUndoHistory: () => set({ undoStack: [], redoStack: [] }),

  reset: () => set(INITIAL_STATE),
}))

// Created and developed by Jai Singh
