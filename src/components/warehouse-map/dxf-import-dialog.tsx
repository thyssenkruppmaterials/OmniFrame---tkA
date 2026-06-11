// Created and developed by Jai Singh
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Stage, Layer, Line, Circle as KonvaCircle } from 'react-konva'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { WarehouseMapService } from '@/lib/supabase/warehouse-map.service'
import { parseDxf, type DxfEntity } from '@/lib/utils/dxf-parser'
import { logger } from '@/lib/utils/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
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

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type LayerRole = 'building-outline' | 'zone' | 'rack' | 'aisle' | 'ignore'

const ROLE_OPTIONS: { value: LayerRole; label: string }[] = [
  { value: 'building-outline', label: 'Building Outline' },
  { value: 'zone', label: 'Zone' },
  { value: 'rack', label: 'Rack' },
  { value: 'aisle', label: 'Aisle' },
  { value: 'ignore', label: 'Ignore' },
]

const PREVIEW_WIDTH = 560
const PREVIEW_HEIGHT = 360
const PREVIEW_PADDING = 16

const LAYER_PALETTE = [
  '#3B82F6',
  '#22C55E',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#10B981',
  '#06B6D4',
  '#F97316',
  '#A855F7',
]

interface DxfImportDialogProps {
  mapId: string
  open: boolean
  onClose: () => void
  onImported: () => void
}

interface ParsedDxf {
  entities: DxfEntity[]
  layers: string[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

interface ImportSummary {
  buildingOutlineSet: boolean
  zonesCreated: number
  racksCreated: number
  aisleNodesCreated: number
  aisleEdgesCreated: number
  layersIgnored: number
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

function guessRole(layer: string): LayerRole {
  const l = layer.toLowerCase()
  if (/(wall|outline|floorplan|building|perimeter)/.test(l))
    return 'building-outline'
  if (/(zone|area|region)/.test(l)) return 'zone'
  if (/(rack|shelf|shelving|bay)/.test(l)) return 'rack'
  if (/(aisle|path|walkway|corridor)/.test(l)) return 'aisle'
  return 'ignore'
}

function colorForLayer(layer: string): string {
  let hash = 0
  for (let i = 0; i < layer.length; i++) {
    hash = (hash * 31 + layer.charCodeAt(i)) | 0
  }
  return LAYER_PALETTE[Math.abs(hash) % LAYER_PALETTE.length]
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function aabb(points: { x: number; y: number }[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

function bboxArea(points: { x: number; y: number }[]) {
  if (points.length === 0) return 0
  const b = aabb(points)
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY)
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

// ---------------------------------------------------------------------------
// Org-id fetcher (mirrors WarehouseMapService.getOrganizationId)
// ---------------------------------------------------------------------------

async function fetchOrganizationId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle()

  if (error) throw error
  const orgId = (profile as { organization_id?: string } | null)
    ?.organization_id
  if (!orgId) throw new Error('No organization found for user')
  return orgId
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DxfImportDialog({
  mapId,
  open,
  onClose,
  onImported,
}: DxfImportDialogProps) {
  const queryClient = useQueryClient()

  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedDxf | null>(null)
  const [layerRoles, setLayerRoles] = useState<Record<string, LayerRole>>({})
  const [activeTab, setActiveTab] = useState<'preview' | 'mapping'>('preview')

  // Reset all local state when the dialog closes so a re-open starts fresh.
  useEffect(() => {
    if (!open) {
      setFileName(null)
      setParsed(null)
      setLayerRoles({})
      setActiveTab('preview')
    }
  }, [open])

  // -------------------------------------------------------------------------
  // File handling
  // -------------------------------------------------------------------------

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    try {
      const text = await file.text()
      const result = parseDxf(text)
      setParsed(result)
      const roles: Record<string, LayerRole> = {}
      for (const layer of result.layers) roles[layer] = guessRole(layer)
      setLayerRoles(roles)
      toast.success(
        `Parsed ${result.entities.length} entities across ${result.layers.length} layer${result.layers.length === 1 ? '' : 's'}`
      )
    } catch (err) {
      logger.error('DXF parse failed', err)
      toast.error('Failed to parse DXF file')
      setParsed(null)
    }
  }

  // -------------------------------------------------------------------------
  // Preview transform: fit DXF bounds into the preview canvas
  // -------------------------------------------------------------------------

  const previewTransform = useMemo(() => {
    if (!parsed) return null
    const { minX, minY, maxX, maxY } = parsed.bounds
    const w = Math.max(1, maxX - minX)
    const h = Math.max(1, maxY - minY)
    const sx = (PREVIEW_WIDTH - 2 * PREVIEW_PADDING) / w
    const sy = (PREVIEW_HEIGHT - 2 * PREVIEW_PADDING) / h
    const scale = Math.min(sx, sy)
    // DXF Y-up → screen Y-down: flip via -y.
    const offsetX = PREVIEW_PADDING - minX * scale
    const offsetY = PREVIEW_PADDING + maxY * scale
    return {
      project: (x: number, y: number): [number, number] => [
        x * scale + offsetX,
        -y * scale + offsetY,
      ],
      scale,
    }
  }, [parsed])

  // -------------------------------------------------------------------------
  // Import mutation
  // -------------------------------------------------------------------------

  const importMutation = useMutation<ImportSummary>({
    mutationFn: async () => {
      if (!parsed) throw new Error('No DXF parsed')

      const service = WarehouseMapService.getInstance()
      // The aisle-graph helpers are part of a planned service surface (see
      // migration 238 / 239). We call them here behind a typed cast so this
      // dialog compiles before those methods are added to the service class.
      const aisleSvc = service as unknown as {
        createAisleNode: (data: {
          map_id: string
          x: number
          y: number
          floor_level: number
          kind: 'aisle'
          organization_id: string
        }) => Promise<{ id: string }>
        createAisleEdge: (data: {
          map_id: string
          from_node_id: string
          to_node_id: string
          cost: number
          organization_id: string
        }) => Promise<unknown>
      }

      const organizationId = await fetchOrganizationId()

      // Bucket entities per layer for fast lookup.
      const byLayer = new Map<string, DxfEntity[]>()
      for (const e of parsed.entities) {
        const arr = byLayer.get(e.layer) ?? []
        arr.push(e)
        byLayer.set(e.layer, arr)
      }

      const summary: ImportSummary = {
        buildingOutlineSet: false,
        zonesCreated: 0,
        racksCreated: 0,
        aisleNodesCreated: 0,
        aisleEdgesCreated: 0,
        layersIgnored: 0,
      }

      for (const [layer, role] of Object.entries(layerRoles)) {
        const entities = byLayer.get(layer) ?? []
        if (role === 'ignore') {
          summary.layersIgnored++
          continue
        }

        const closedPolylines = entities.filter(
          (e): e is Extract<DxfEntity, { type: 'LWPOLYLINE' | 'POLYLINE' }> =>
            (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') &&
            e.closed &&
            e.points.length >= 3
        )
        const openPolylines = entities.filter(
          (e): e is Extract<DxfEntity, { type: 'LWPOLYLINE' | 'POLYLINE' }> =>
            (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') &&
            !e.closed &&
            e.points.length >= 2
        )

        if (role === 'building-outline') {
          if (closedPolylines.length === 0) continue
          let largest = closedPolylines[0]
          let largestArea = bboxArea(largest.points)
          for (let i = 1; i < closedPolylines.length; i++) {
            const a = bboxArea(closedPolylines[i].points)
            if (a > largestArea) {
              largest = closedPolylines[i]
              largestArea = a
            }
          }
          await service.updateMap(mapId, {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            building_outline: largest.points as any,
          })
          summary.buildingOutlineSet = true
          toast.info(`Set building outline from layer "${layer}"`)
        } else if (role === 'zone') {
          let idx = 0
          for (const poly of closedPolylines) {
            idx++
            await service.createZone({
              map_id: mapId,
              organization_id: organizationId,
              name: `${layer}-${idx}`,
              polygon: poly.points,
              zone_type: 'storage',
              color: '#3B82F6',
              opacity: 0.3,
              floor_level: 0,
              sort_order: 0,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
            summary.zonesCreated++
          }
          if (idx > 0)
            toast.info(`Created ${idx} zone(s) from layer "${layer}"`)
        } else if (role === 'rack') {
          let idx = 0
          for (const poly of closedPolylines) {
            idx++
            const box = aabb(poly.points)
            await service.createRack({
              map_id: mapId,
              organization_id: organizationId,
              zone_id: null,
              label: `${layer}-${idx}`,
              rack_type: 'shelving',
              position_x: box.minX,
              position_y: box.minY,
              width: Math.max(1, box.maxX - box.minX),
              height: Math.max(1, box.maxY - box.minY),
              rotation: 0,
              rows: 4,
              columns: 6,
              aisle: null,
              metadata: {},
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
            summary.racksCreated++
          }
          if (idx > 0)
            toast.info(`Created ${idx} rack(s) from layer "${layer}"`)
        } else if (role === 'aisle') {
          let nodesThisLayer = 0
          let edgesThisLayer = 0
          for (const poly of openPolylines) {
            const nodeIds: string[] = []
            for (const pt of poly.points) {
              const node = await aisleSvc.createAisleNode({
                map_id: mapId,
                organization_id: organizationId,
                x: pt.x,
                y: pt.y,
                floor_level: 0,
                kind: 'aisle',
              })
              nodeIds.push(node.id)
              nodesThisLayer++
              summary.aisleNodesCreated++
            }
            for (let k = 0; k < nodeIds.length - 1; k++) {
              const cost = distance(poly.points[k], poly.points[k + 1])
              await aisleSvc.createAisleEdge({
                map_id: mapId,
                organization_id: organizationId,
                from_node_id: nodeIds[k],
                to_node_id: nodeIds[k + 1],
                cost,
              })
              edgesThisLayer++
              summary.aisleEdgesCreated++
            }
          }
          if (nodesThisLayer > 0) {
            toast.info(
              `Created ${nodesThisLayer} aisle node(s) and ${edgesThisLayer} edge(s) from layer "${layer}"`
            )
          }
        }
      }

      return summary
    },
    onSuccess: (summary) => {
      const parts: string[] = []
      if (summary.buildingOutlineSet) parts.push('building outline')
      if (summary.zonesCreated) parts.push(`${summary.zonesCreated} zones`)
      if (summary.racksCreated) parts.push(`${summary.racksCreated} racks`)
      if (summary.aisleNodesCreated)
        parts.push(
          `${summary.aisleNodesCreated} aisle nodes / ${summary.aisleEdgesCreated} edges`
        )
      toast.success(
        parts.length > 0
          ? `Imported: ${parts.join(', ')}`
          : 'Import complete (nothing to write)'
      )
      void queryClient.invalidateQueries({
        predicate: (q) => {
          const key = q.queryKey?.[0]
          return typeof key === 'string' && key.startsWith('warehouse')
        },
      })
      onImported()
      onClose()
    },
    onError: (err) => {
      logger.error('DXF import failed', err)
      toast.error(
        err instanceof Error ? `Import failed: ${err.message}` : 'Import failed'
      )
    },
  })

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const totalLayers = parsed?.layers.length ?? 0
  const importing = importMutation.isPending

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !importing) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Upload className='size-4' />
            Import DXF Floorplan
          </DialogTitle>
          <DialogDescription>
            Upload a DXF file, preview the detected geometry, and assign each
            layer to a warehouse role (outline, zone, rack, or aisle).
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {/* Step 1: file picker */}
          <div className='space-y-2'>
            <Label htmlFor='dxf-file'>DXF file</Label>
            <Input
              id='dxf-file'
              type='file'
              accept='.dxf'
              onChange={handleFileChange}
              disabled={importing}
            />
            {fileName && (
              <p className='text-muted-foreground text-xs'>
                Selected: <span className='font-mono'>{fileName}</span>
              </p>
            )}
          </div>

          {parsed && (
            <>
              {/* Summary */}
              <Alert>
                <AlertDescription className='space-y-1 text-xs'>
                  <div>
                    <span className='font-medium'>Entities:</span>{' '}
                    {parsed.entities.length}
                    <span className='mx-2 opacity-50'>•</span>
                    <span className='font-medium'>Layers:</span> {totalLayers}
                  </div>
                  <div className='font-mono'>
                    bounds: ({parsed.bounds.minX.toFixed(2)},{' '}
                    {parsed.bounds.minY.toFixed(2)}) → (
                    {parsed.bounds.maxX.toFixed(2)},{' '}
                    {parsed.bounds.maxY.toFixed(2)})
                  </div>
                </AlertDescription>
              </Alert>

              {/* Tabs: preview + mapping */}
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as 'preview' | 'mapping')}
              >
                <TabsList>
                  <TabsTrigger value='preview'>Preview</TabsTrigger>
                  <TabsTrigger value='mapping'>
                    Mapping ({totalLayers})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value='preview'>
                  <div
                    className='bg-muted/30 rounded-md border'
                    style={{ width: PREVIEW_WIDTH, maxWidth: '100%' }}
                  >
                    {previewTransform && (
                      <Stage width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT}>
                        <Layer>
                          {parsed.entities.map((e, idx) => {
                            const stroke = colorForLayer(e.layer)
                            if (e.type === 'LINE') {
                              const [a, b] = [
                                previewTransform.project(e.x1, e.y1),
                                previewTransform.project(e.x2, e.y2),
                              ]
                              return (
                                <Line
                                  key={idx}
                                  points={[a[0], a[1], b[0], b[1]]}
                                  stroke={stroke}
                                  strokeWidth={1}
                                />
                              )
                            }
                            if (e.type === 'CIRCLE') {
                              const [cx, cy] = previewTransform.project(
                                e.cx,
                                e.cy
                              )
                              return (
                                <KonvaCircle
                                  key={idx}
                                  x={cx}
                                  y={cy}
                                  radius={Math.max(
                                    1,
                                    e.r * previewTransform.scale
                                  )}
                                  stroke={stroke}
                                  strokeWidth={1}
                                />
                              )
                            }
                            const flat: number[] = []
                            for (const p of e.points) {
                              const [px, py] = previewTransform.project(
                                p.x,
                                p.y
                              )
                              flat.push(px, py)
                            }
                            return (
                              <Line
                                key={idx}
                                points={flat}
                                closed={e.closed}
                                stroke={stroke}
                                strokeWidth={1}
                              />
                            )
                          })}
                        </Layer>
                      </Stage>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value='mapping'>
                  <ScrollArea className='h-[320px] rounded-md border'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-[40%]'>Layer</TableHead>
                          <TableHead>Entities</TableHead>
                          <TableHead>Role</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsed.layers.map((layer) => {
                          const count = parsed.entities.filter(
                            (e) => e.layer === layer
                          ).length
                          const role = layerRoles[layer] ?? 'ignore'
                          return (
                            <TableRow key={layer}>
                              <TableCell>
                                <div className='flex items-center gap-2'>
                                  <span
                                    className='inline-block size-3 rounded-sm'
                                    style={{
                                      backgroundColor: colorForLayer(layer),
                                    }}
                                  />
                                  <span className='font-mono text-xs'>
                                    {layer}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className='text-muted-foreground text-xs'>
                                {count}
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={role}
                                  onValueChange={(v) =>
                                    setLayerRoles((prev) => ({
                                      ...prev,
                                      [layer]: v as LayerRole,
                                    }))
                                  }
                                  disabled={importing}
                                >
                                  <SelectTrigger className='h-8 w-[160px]'>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ROLE_OPTIONS.map((opt) => (
                                      <SelectItem
                                        key={opt.value}
                                        value={opt.value}
                                      >
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={!parsed || importing}
          >
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
