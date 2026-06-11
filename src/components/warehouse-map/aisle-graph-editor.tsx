// Created and developed by Jai Singh
/* eslint-disable @typescript-eslint/no-explicit-any */
// ---------------------------------------------------------------------------
// Aisle Graph Editor
// ---------------------------------------------------------------------------
// A Konva editor layer that lets users place / move / connect aisle waypoints
// on the warehouse map. Mounted inside a parent `react-konva` <Stage> as a
// <Layer> when the parent's editMode === 'edit-aisles'.
//
// The component returns a Fragment whose first child is the Konva <Layer>
// (consumed by the parent Stage) and whose second child is an HTML overlay
// rendered through a portal to document.body — keeping the overlay floating
// above the canvas without polluting the Stage child tree.
//
// The parent Stage owns pan/zoom transforms; this editor exposes a
// `handleStageClick(point)` method via `ref` so the parent can forward
// stage-local coordinates from its own `onClick` handler.
// ---------------------------------------------------------------------------
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { KonvaEventObject } from 'konva/lib/Node'
import { createPortal } from 'react-dom'
import { Layer, Group, Circle, Line, Text, Rect } from 'react-konva'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AisleNodeKind =
  | 'aisle'
  | 'doorway'
  | 'pickup'
  | 'dock'
  | 'stair'
  | 'elevator'
  | 'manual'

export interface AisleNode {
  id: string
  map_id: string
  organization_id: string
  label: string | null
  x: number
  y: number
  floor_level: number
  kind: AisleNodeKind
  metadata: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
}

export interface AisleEdge {
  id: string
  map_id: string
  organization_id: string
  from_node_id: string
  to_node_id: string
  cost: number
  one_way: boolean
  is_stair?: boolean
  is_elevator?: boolean
  metadata?: Record<string, unknown> | null
}

export interface AisleGraphEditorProps {
  mapId: string
  floorLevel: number
  /** When false, render nodes/edges read-only (no creation/drag/menu). */
  active: boolean
  onClose?: () => void
}

/** Imperative handle exposed via ref so the parent Stage can forward clicks. */
export interface AisleGraphEditorHandle {
  handleStageClick(point: { x: number; y: number }): void
}

/**
 * Shape of the aisle-graph methods that will be added to WarehouseMapService
 * by the parallel migration-238 service task. We type-narrow with this
 * structural cast so the editor compiles before those methods land.
 */
interface AisleServiceShape {
  createAisleNode(input: {
    map_id: string
    x: number
    y: number
    floor_level: number
    kind: AisleNodeKind
    label?: string | null
  }): Promise<AisleNode>
  updateAisleNode(id: string, patch: Partial<AisleNode>): Promise<AisleNode>
  deleteAisleNode(id: string): Promise<void>
  createAisleEdge(input: {
    map_id: string
    from_node_id: string
    to_node_id: string
    cost: number
    one_way?: boolean
  }): Promise<AisleEdge>
  deleteAisleEdge(id: string): Promise<void>
  autoConnectAisleNodes(mapId: string, k: number): Promise<number>
  seedAisleNodesFromRacks(mapId: string): Promise<number>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_COLORS: Record<AisleNodeKind, string> = {
  aisle: '#10b981',
  doorway: '#facc15',
  pickup: '#3b82f6',
  dock: '#a855f7',
  stair: '#f97316',
  elevator: '#06b6d4',
  manual: '#94a3b8',
}

const KIND_OPTIONS: AisleNodeKind[] = [
  'aisle',
  'doorway',
  'pickup',
  'dock',
  'stair',
  'elevator',
  'manual',
]

const AISLE_NODES_KEY = 'warehouse-aisle-nodes'
const AISLE_EDGES_KEY = 'warehouse-aisle-edges'

// ---------------------------------------------------------------------------
// Local UI state shapes
// ---------------------------------------------------------------------------

interface ContextMenuState {
  nodeId: string
  screenX: number
  screenY: number
}

interface LabelDialogState {
  nodeId: string
  current: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AisleGraphEditor = forwardRef<
  AisleGraphEditorHandle,
  AisleGraphEditorProps
>(function AisleGraphEditor({ mapId, floorLevel, active, onClose }, ref) {
  const queryClient = useQueryClient()

  // Cast at construction — the new methods will exist by integration time.
  const service = useMemo(
    () =>
      WarehouseMapService.getInstance() as unknown as WarehouseMapService &
        AisleServiceShape,
    []
  )

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [labelDialog, setLabelDialog] = useState<LabelDialogState | null>(null)

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  const { data: nodes = [] } = useQuery<AisleNode[]>({
    queryKey: [AISLE_NODES_KEY, mapId, floorLevel],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouse_aisle_nodes' as any)
        .select('*')
        .eq('map_id', mapId)
        .eq('floor_level', floorLevel)
      if (error) throw error
      return (data ?? []) as unknown as AisleNode[]
    },
    enabled: !!mapId,
    staleTime: 30 * 1000,
  })

  const { data: edges = [] } = useQuery<AisleEdge[]>({
    queryKey: [AISLE_EDGES_KEY, mapId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouse_aisle_edges' as any)
        .select('*')
        .eq('map_id', mapId)
      if (error) throw error
      return (data ?? []) as unknown as AisleEdge[]
    },
    enabled: !!mapId,
    staleTime: 30 * 1000,
  })

  const nodesById = useMemo(() => {
    const m = new Map<string, AisleNode>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  const visibleNodes = useMemo(
    () => nodes.filter((n) => n.floor_level === floorLevel),
    [nodes, floorLevel]
  )

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) : null

  // -------------------------------------------------------------------------
  // Realtime subscription
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!mapId) return
    const channel = supabase
      .channel(`aisle-graph-${mapId}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'warehouse_aisle_nodes',
          filter: `map_id=eq.${mapId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: [AISLE_NODES_KEY, mapId] })
        }
      )
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'warehouse_aisle_edges',
          filter: `map_id=eq.${mapId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: [AISLE_EDGES_KEY, mapId] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [mapId, queryClient])

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const invalidateNodes = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [AISLE_NODES_KEY, mapId] }),
    [queryClient, mapId]
  )
  const invalidateEdges = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [AISLE_EDGES_KEY, mapId] }),
    [queryClient, mapId]
  )

  const createNode = useMutation({
    mutationFn: (input: Parameters<AisleServiceShape['createAisleNode']>[0]) =>
      service.createAisleNode(input),
    onSuccess: () => {
      invalidateNodes()
      toast.success('Aisle node added')
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to add node'),
  })

  const updateNode = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AisleNode> }) =>
      service.updateAisleNode(id, patch),
    onSuccess: () => invalidateNodes(),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to update node'),
  })

  const deleteNode = useMutation({
    mutationFn: (id: string) => service.deleteAisleNode(id),
    onSuccess: () => {
      invalidateNodes()
      invalidateEdges()
      toast.success('Aisle node deleted')
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to delete node'),
  })

  const createEdge = useMutation({
    mutationFn: (input: Parameters<AisleServiceShape['createAisleEdge']>[0]) =>
      service.createAisleEdge(input),
    onSuccess: () => {
      invalidateEdges()
      toast.success('Aisle edge created')
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to create edge'),
  })

  const autoConnect = useMutation({
    mutationFn: (k: number) => service.autoConnectAisleNodes(mapId, k),
    onSuccess: (n) => {
      invalidateEdges()
      toast.success(`Auto-connected (${n} edges created)`)
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Auto-connect failed'),
  })

  const seedFromRacks = useMutation({
    mutationFn: () => service.seedAisleNodesFromRacks(mapId),
    onSuccess: (n) => {
      invalidateNodes()
      toast.success(`Seeded ${n} nodes from racks`)
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Seed failed'),
  })

  // -------------------------------------------------------------------------
  // Imperative handle for parent Stage
  // -------------------------------------------------------------------------

  const handleStageClick = useCallback(
    (point: { x: number; y: number }) => {
      if (!active) return
      // If a node was tentatively selected for connection, an empty-space
      // click cancels the selection (rather than creating a node) so the
      // user can recover from misclicks. A second empty-space click then
      // creates the node.
      if (selectedNodeId) {
        setSelectedNodeId(null)
        return
      }
      createNode.mutate({
        map_id: mapId,
        x: Math.round(point.x),
        y: Math.round(point.y),
        floor_level: floorLevel,
        kind: 'aisle',
      })
    },
    [active, selectedNodeId, createNode, mapId, floorLevel]
  )

  useImperativeHandle(ref, () => ({ handleStageClick }), [handleStageClick])

  // -------------------------------------------------------------------------
  // Konva event handlers
  // -------------------------------------------------------------------------

  const handleCircleClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>, nodeId: string) => {
      e.cancelBubble = true
      if (!active) return
      if (!selectedNodeId) {
        setSelectedNodeId(nodeId)
        return
      }
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null)
        return
      }
      const a = nodesById.get(selectedNodeId)
      const b = nodesById.get(nodeId)
      if (!a || !b) {
        setSelectedNodeId(null)
        return
      }
      const cost = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) // Manhattan
      createEdge.mutate({
        map_id: mapId,
        from_node_id: a.id,
        to_node_id: b.id,
        cost,
      })
      setSelectedNodeId(null)
    },
    [active, selectedNodeId, nodesById, createEdge, mapId]
  )

  const handleDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>, nodeId: string) => {
      if (!active) return
      const newX = Math.round(e.target.x())
      const newY = Math.round(e.target.y())
      updateNode.mutate({ id: nodeId, patch: { x: newX, y: newY } })
    },
    [active, updateNode]
  )

  const handleContextMenu = useCallback(
    (e: KonvaEventObject<PointerEvent>, nodeId: string) => {
      e.evt.preventDefault()
      e.cancelBubble = true
      if (!active) return
      setContextMenu({
        nodeId,
        screenX: e.evt.clientX,
        screenY: e.evt.clientY,
      })
    },
    [active]
  )

  // Close context menu on outside click / Escape.
  useEffect(() => {
    if (!contextMenu) return
    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null
      if (target?.closest('[data-aisle-context-menu]')) return
      setContextMenu(null)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  // -------------------------------------------------------------------------
  // Render — Layer (Konva) + portal'd HTML overlay
  // -------------------------------------------------------------------------

  return (
    <>
      <Layer listening={active}>
        {/* Edges */}
        {edges.map((edge) => {
          const a = nodesById.get(edge.from_node_id)
          const b = nodesById.get(edge.to_node_id)
          if (!a || !b) return null
          if (a.floor_level !== floorLevel || b.floor_level !== floorLevel) {
            return null
          }
          return (
            <Line
              key={edge.id}
              points={[a.x, a.y, b.x, b.y]}
              stroke={edge.one_way ? '#a855f7' : '#10b981'}
              strokeWidth={2}
              opacity={0.85}
              lineCap='round'
              listening={false}
            />
          )
        })}

        {/* Selection halo (dashed Rect outline) */}
        {selectedNode && (
          <Rect
            x={selectedNode.x - 14}
            y={selectedNode.y - 14}
            width={28}
            height={28}
            stroke='#facc15'
            strokeWidth={1.5}
            dash={[4, 3]}
            cornerRadius={4}
            listening={false}
          />
        )}

        {/* Nodes */}
        {visibleNodes.map((node) => {
          const isSelected = selectedNodeId === node.id
          const isHovered = hoveredNodeId === node.id
          const fill = KIND_COLORS[node.kind] ?? KIND_COLORS.aisle
          return (
            <Group key={node.id}>
              <Circle
                x={node.x}
                y={node.y}
                radius={isHovered || isSelected ? 9 : 8}
                fill={fill}
                stroke={isSelected ? '#facc15' : '#ffffff'}
                strokeWidth={2}
                draggable={active}
                listening={true}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() =>
                  setHoveredNodeId((id) => (id === node.id ? null : id))
                }
                onClick={(e) => handleCircleClick(e, node.id)}
                onTap={(e) => handleCircleClick(e, node.id)}
                onDragEnd={(e) => handleDragEnd(e, node.id)}
                onContextMenu={(e) => handleContextMenu(e, node.id)}
              />
              <Text
                x={node.x - 30}
                y={node.y + 10}
                width={60}
                align='center'
                text={node.label || node.kind}
                fontSize={9}
                fill='#e2e8f0'
                listening={false}
              />
            </Group>
          )
        })}
      </Layer>

      {typeof document !== 'undefined' &&
        createPortal(
          <AisleGraphOverlay
            active={active}
            nodeCount={visibleNodes.length}
            edgeCount={edges.length}
            selectedNodeId={selectedNodeId}
            contextMenu={contextMenu}
            labelDialog={labelDialog}
            nodesById={nodesById}
            isAutoConnecting={autoConnect.isPending}
            isSeeding={seedFromRacks.isPending}
            onClose={onClose}
            onAutoConnect={() => autoConnect.mutate(4)}
            onSeedFromRacks={() => seedFromRacks.mutate()}
            onCloseContextMenu={() => setContextMenu(null)}
            onChangeKind={(id, kind) => {
              updateNode.mutate({ id, patch: { kind } })
              setContextMenu(null)
            }}
            onDelete={(id) => {
              deleteNode.mutate(id)
              setContextMenu(null)
              setSelectedNodeId(null)
            }}
            onSetLabel={(id) => {
              const cur = nodesById.get(id)?.label ?? ''
              setLabelDialog({ nodeId: id, current: cur })
              setContextMenu(null)
            }}
            onCloseLabelDialog={() => setLabelDialog(null)}
            onSaveLabel={(id, label) => {
              updateNode.mutate({
                id,
                patch: { label: label.trim() || null },
              })
              setLabelDialog(null)
            }}
          />,
          document.body
        )}
    </>
  )
})

// ---------------------------------------------------------------------------
// HTML overlay sub-component (portal'd to document.body)
// ---------------------------------------------------------------------------

interface AisleGraphOverlayProps {
  active: boolean
  nodeCount: number
  edgeCount: number
  selectedNodeId: string | null
  contextMenu: ContextMenuState | null
  labelDialog: LabelDialogState | null
  nodesById: Map<string, AisleNode>
  isAutoConnecting: boolean
  isSeeding: boolean
  onClose?: () => void
  onAutoConnect: () => void
  onSeedFromRacks: () => void
  onCloseContextMenu: () => void
  onChangeKind: (id: string, kind: AisleNodeKind) => void
  onDelete: (id: string) => void
  onSetLabel: (id: string) => void
  onCloseLabelDialog: () => void
  onSaveLabel: (id: string, label: string) => void
}

function AisleGraphOverlay({
  active,
  nodeCount,
  edgeCount,
  selectedNodeId,
  contextMenu,
  labelDialog,
  nodesById,
  isAutoConnecting,
  isSeeding,
  onClose,
  onAutoConnect,
  onSeedFromRacks,
  onCloseContextMenu,
  onChangeKind,
  onDelete,
  onSetLabel,
  onCloseLabelDialog,
  onSaveLabel,
}: AisleGraphOverlayProps) {
  const [labelDraft, setLabelDraft] = useState('')

  useEffect(() => {
    if (labelDialog) setLabelDraft(labelDialog.current ?? '')
  }, [labelDialog])

  const contextNode = contextMenu ? nodesById.get(contextMenu.nodeId) : null

  return (
    <>
      {/* Toolbar mini-panel — bottom-left, non-blocking */}
      {active && (
        <div
          className='pointer-events-auto fixed bottom-6 left-6 z-40 w-[260px] rounded-lg border border-slate-700/80 bg-slate-900/95 p-3 text-xs text-slate-200 shadow-2xl backdrop-blur'
          data-aisle-toolbar
        >
          <div className='mb-2 flex items-center justify-between'>
            <div className='font-semibold tracking-wide text-emerald-400'>
              Aisle Graph Editor
            </div>
            {onClose && (
              <button
                type='button'
                onClick={onClose}
                className='rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                aria-label='Close aisle editor'
              >
                ×
              </button>
            )}
          </div>
          <ul className='mb-2 space-y-1 text-[11px] leading-snug text-slate-400'>
            <li>• Click empty space to add a node</li>
            <li>• Click two nodes to connect them</li>
            <li>• Drag a node to move it</li>
            <li>• Right-click a node for options</li>
          </ul>
          <div className='mb-2 flex items-center justify-between text-[11px] text-slate-400'>
            <span>{nodeCount} nodes</span>
            <span>{edgeCount} edges</span>
            {selectedNodeId && (
              <span className='text-amber-400'>1 selected</span>
            )}
          </div>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='secondary'
              className='flex-1'
              disabled={isAutoConnecting}
              onClick={onAutoConnect}
            >
              {isAutoConnecting ? 'Connecting…' : 'Auto-connect (k=4)'}
            </Button>
            <Button
              size='sm'
              variant='outline'
              className='flex-1'
              disabled={isSeeding}
              onClick={onSeedFromRacks}
            >
              {isSeeding ? 'Seeding…' : 'Seed from racks'}
            </Button>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && contextNode && (
        <div
          data-aisle-context-menu
          className='pointer-events-auto fixed z-50 w-44 rounded-md border border-slate-700 bg-slate-900/98 p-1 text-xs text-slate-200 shadow-xl'
          style={{ top: contextMenu.screenY, left: contextMenu.screenX }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className='border-b border-slate-700 px-2 py-1.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase'>
            Aisle Node
          </div>
          <div className='px-2 py-1 text-[10px] text-slate-500'>
            Change kind
          </div>
          <div className='grid grid-cols-2 gap-1 px-1 pb-1'>
            {KIND_OPTIONS.map((kind) => {
              const isCurrent = contextNode.kind === kind
              return (
                <button
                  key={kind}
                  type='button'
                  onClick={() => onChangeKind(contextNode.id, kind)}
                  className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-left capitalize hover:bg-slate-800 ${
                    isCurrent ? 'bg-slate-800 ring-1 ring-emerald-500/40' : ''
                  }`}
                >
                  <span
                    className='inline-block h-2 w-2 rounded-full'
                    style={{ background: KIND_COLORS[kind] }}
                  />
                  <span className='truncate'>{kind}</span>
                </button>
              )
            })}
          </div>
          <div className='border-t border-slate-700' />
          <button
            type='button'
            className='w-full rounded px-2 py-1.5 text-left hover:bg-slate-800'
            onClick={() => onSetLabel(contextNode.id)}
          >
            Set label…
          </button>
          <button
            type='button'
            className='w-full rounded px-2 py-1.5 text-left text-red-400 hover:bg-red-500/10'
            onClick={() => onDelete(contextNode.id)}
          >
            Delete node
          </button>
          <button
            type='button'
            className='w-full rounded px-2 py-1.5 text-left text-slate-400 hover:bg-slate-800'
            onClick={onCloseContextMenu}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Set-label dialog */}
      {labelDialog && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/40'
          onClick={onCloseLabelDialog}
        >
          <div
            className='w-80 rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-200 shadow-2xl'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='mb-2 font-semibold'>Set node label</div>
            <input
              autoFocus
              type='text'
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  onSaveLabel(labelDialog.nodeId, labelDraft)
                if (e.key === 'Escape') onCloseLabelDialog()
              }}
              placeholder='e.g. A1-end, dock-3, doorway-N'
              className='mb-3 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none'
            />
            <div className='flex justify-end gap-2'>
              <Button size='sm' variant='ghost' onClick={onCloseLabelDialog}>
                Cancel
              </Button>
              <Button
                size='sm'
                onClick={() => onSaveLabel(labelDialog.nodeId, labelDraft)}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Created and developed by Jai Singh
