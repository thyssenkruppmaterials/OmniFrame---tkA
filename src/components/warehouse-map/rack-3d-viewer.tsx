// Created and developed by Jai Singh
import { useMemo } from 'react'
import { OrbitControls, Text as DreiText } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import type {
  WarehouseRack,
  WarehouseLocationMapping,
  OperationalStatus,
} from './types'
import { STATUS_COLORS, STATUS_BADGE_TEXT } from './types'

interface Rack3DViewerProps {
  rackId: string | null
  rack: WarehouseRack | null
  locations: WarehouseLocationMapping[]
  onClose: () => void
}

const POST_THICKNESS = 0.08
const SHELF_THICKNESS = 0.04

function RackScene({
  rack,
  locations,
}: {
  rack: WarehouseRack
  locations: WarehouseLocationMapping[]
}) {
  const { rows, columns } = rack
  const rackW = rack.width / 100
  const rackH = rack.height / 100
  const shelfSpacing = rackH / Math.max(rows, 1)
  const baySpacing = rackW / Math.max(columns, 1)

  const locationMap = useMemo(() => {
    const m = new Map<string, OperationalStatus>()
    for (const loc of locations) {
      m.set(`${loc.rack_row}-${loc.rack_column}`, loc.operational_status)
    }
    return m
  }, [locations])

  const posts = useMemo(() => {
    const halfW = rackW / 2
    const halfD = baySpacing / 2
    return [
      [-halfW, rackH / 2, -halfD],
      [-halfW, rackH / 2, halfD],
      [halfW, rackH / 2, -halfD],
      [halfW, rackH / 2, halfD],
    ] as [number, number, number][]
  }, [rackW, rackH, baySpacing])

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={0.8} />

      {posts.map((pos, i) => (
        <mesh key={`post-${i}`} position={pos}>
          <boxGeometry args={[POST_THICKNESS, rackH, POST_THICKNESS]} />
          <meshStandardMaterial color='#94a3b8' />
        </mesh>
      ))}

      {Array.from({ length: rows + 1 }, (_, row) => {
        const y = row * shelfSpacing
        return (
          <mesh key={`shelf-${row}`} position={[0, y, 0]}>
            <boxGeometry
              args={[
                rackW + POST_THICKNESS,
                SHELF_THICKNESS,
                baySpacing + POST_THICKNESS,
              ]}
            />
            <meshStandardMaterial color='#cbd5e1' />
          </mesh>
        )
      })}

      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, col) => {
          const status = locationMap.get(`${row + 1}-${col + 1}`) ?? 'active'
          const x = -rackW / 2 + (col + 0.5) * baySpacing
          const y = row * shelfSpacing + shelfSpacing / 2
          const boxW = baySpacing * 0.7
          const boxH = shelfSpacing * 0.6
          const boxD = baySpacing * 0.5

          return (
            <mesh key={`loc-${row}-${col}`} position={[x, y, 0]}>
              <boxGeometry args={[boxW, boxH, boxD]} />
              <meshStandardMaterial
                color={STATUS_COLORS[status]}
                opacity={0.85}
                transparent
              />
            </mesh>
          )
        })
      )}

      <DreiText
        position={[0, rackH + 0.3, 0]}
        fontSize={0.25}
        color='#334155'
        anchorX='center'
        anchorY='middle'
      >
        {rack.label}
      </DreiText>

      <gridHelper
        args={[10, 20, '#e2e8f0', '#e2e8f0']}
        position={[0, -0.01, 0]}
      />
      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        minDistance={1}
        maxDistance={15}
      />
    </>
  )
}

export function Rack3DViewer({
  rackId,
  rack,
  locations,
  onClose,
}: Rack3DViewerProps) {
  return (
    <Dialog
      open={!!rackId}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className='flex h-[600px] max-w-4xl flex-col'>
        <DialogHeader>
          <div className='flex items-center gap-3'>
            <DialogTitle>{rack?.label ?? 'Rack'}</DialogTitle>
            {rack && (
              <>
                <Badge variant='outline'>{rack.rack_type}</Badge>
                <span className='text-muted-foreground text-sm'>
                  {rack.rows} rows &times; {rack.columns} columns
                </span>
              </>
            )}
          </div>
          <DialogDescription className='sr-only'>
            3D view of rack {rack?.label}
          </DialogDescription>
        </DialogHeader>

        <div className='min-h-0 flex-1 overflow-hidden rounded-md border bg-slate-50 dark:bg-slate-900'>
          {rack && (
            <Canvas camera={{ position: [3, 3, 3], fov: 50 }}>
              <RackScene rack={rack} locations={locations} />
            </Canvas>
          )}
        </div>

        <div className='flex flex-wrap gap-4 pt-2'>
          {(Object.keys(STATUS_COLORS) as OperationalStatus[]).map((status) => (
            <div
              key={status}
              className='text-muted-foreground flex items-center gap-1.5 text-xs'
            >
              <span
                className='inline-block h-3 w-3 rounded-sm'
                style={{ backgroundColor: STATUS_COLORS[status] }}
              />
              {STATUS_BADGE_TEXT[status]}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
