// Created and developed by Jai Singh
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - New warehouse map tables (warehouse_assets, warehouse_asset_position_latest) not yet in generated database.types.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Layer, Group, Circle, Line, Rect, Text } from 'react-konva'
import { supabase } from '@/lib/supabase/client'

type AssetKind =
  | 'forklift'
  | 'operator'
  | 'cart'
  | 'pallet_jack'
  | 'robot'
  | 'sensor'
  | 'other'

interface AssetPositionRow {
  asset_id: string
  map_id: string
  x: number
  y: number
  floor_level: number
  heading_deg: number | null
  speed_mps: number | null
  source: string | null
  observed_at: string
  warehouse_assets: {
    display_name: string
    kind: AssetKind
    color: string | null
    active: boolean
  }
}

type RealtimeAssetRow = Omit<AssetPositionRow, 'warehouse_assets'>

interface AssetMeta {
  asset_id: string
  display_name: string
  kind: AssetKind
  color: string | null
}

interface Vec3 {
  x: number
  y: number
  heading: number
}

interface Position {
  current: Vec3
  target: Vec3
  meta: AssetMeta
}

interface AssetPositionOverlayProps {
  mapId: string | null
  floorLevel?: number
  visible?: boolean
}

const KIND_COLOR_DEFAULTS: Record<AssetKind, string> = {
  forklift: '#f59e0b',
  operator: '#22c55e',
  robot: '#a855f7',
  cart: '#3b82f6',
  pallet_jack: '#06b6d4',
  sensor: '#94a3b8',
  other: '#64748b',
}

const LERP_TAU_MS = 120
const PULSE_PERIOD_MS = 1500
const PULSE_MIN = 0.2
const PULSE_MAX = 0.8

/**
 * AssetPositionOverlay
 *
 * A Konva `Layer` that renders live asset positions (forklifts, operators,
 * robots, etc.) on top of the warehouse map canvas. It performs an initial
 * fetch via `@tanstack/react-query`, then subscribes to Supabase Realtime
 * `postgres_changes` for the `warehouse_asset_position_latest` table filtered
 * by `map_id`. Incoming positions are merged into a local `Map` keyed by
 * `asset_id`, and a `requestAnimationFrame` loop smoothly interpolates the
 * rendered position toward the latest target so updates do not "snap".
 *
 * Mount this component as a sibling `Layer` inside a parent `Stage` (after
 * the base map / racks layers so it renders on top).
 */
export function AssetPositionOverlay({
  mapId,
  floorLevel = 0,
  visible = true,
}: AssetPositionOverlayProps) {
  const [positions, setPositions] = useState<Map<string, Position>>(
    () => new Map()
  )

  const positionsRef = useRef(positions)
  positionsRef.current = positions

  const pulseRef = useRef(PULSE_MIN)
  const [, setFrame] = useState(0)

  const { data: initialData } = useQuery<AssetPositionRow[]>({
    queryKey: ['warehouse-asset-positions', mapId, floorLevel],
    enabled: Boolean(mapId) && visible,
    staleTime: Infinity,
    queryFn: async () => {
      if (!mapId) return []
      const { data, error } = await supabase
        .from('warehouse_asset_position_latest')
        .select('*, warehouse_assets!inner(display_name, kind, color, active)')
        .eq('map_id', mapId)
        .eq('floor_level', floorLevel)

      if (error) throw error
      return (data ?? []) as unknown as AssetPositionRow[]
    },
  })

  useEffect(() => {
    if (!initialData) return
    setPositions((prev) => {
      const next = new Map(prev)
      for (const row of initialData) {
        if (!row.warehouse_assets?.active) continue
        const meta: AssetMeta = {
          asset_id: row.asset_id,
          display_name: row.warehouse_assets.display_name,
          kind: row.warehouse_assets.kind,
          color: row.warehouse_assets.color,
        }
        const target: Vec3 = {
          x: row.x,
          y: row.y,
          heading: row.heading_deg ?? 0,
        }
        const existing = next.get(row.asset_id)
        if (existing) {
          existing.target = target
          existing.meta = meta
        } else {
          next.set(row.asset_id, {
            current: { ...target },
            target,
            meta,
          })
        }
      }
      return next
    })
  }, [initialData])

  useEffect(() => {
    if (!mapId || !visible) return

    let channel: RealtimeChannel | null = null
    let cancelled = false

    const fetchAssetMeta = async (
      assetId: string
    ): Promise<AssetMeta | null> => {
      const { data, error } = await supabase
        .from('warehouse_assets')
        .select('display_name, kind, color, active')
        .eq('id', assetId)
        .single()
      if (error || !data || !data.active) return null
      return {
        asset_id: assetId,
        display_name: data.display_name,
        kind: data.kind as AssetKind,
        color: data.color,
      }
    }

    const applyUpsert = async (row: RealtimeAssetRow) => {
      if (row.floor_level !== floorLevel) return
      const existing = positionsRef.current.get(row.asset_id)
      let meta = existing?.meta ?? null
      if (!meta) {
        meta = await fetchAssetMeta(row.asset_id)
        if (!meta || cancelled) return
      }
      const target: Vec3 = {
        x: row.x,
        y: row.y,
        heading: row.heading_deg ?? 0,
      }
      setPositions((prev) => {
        const next = new Map(prev)
        const ex = next.get(row.asset_id)
        if (ex) {
          ex.target = target
          if (meta) ex.meta = meta
        } else if (meta) {
          next.set(row.asset_id, {
            current: { ...target },
            target,
            meta,
          })
        }
        return next
      })
    }

    const applyDelete = (assetId: string) => {
      setPositions((prev) => {
        if (!prev.has(assetId)) return prev
        const next = new Map(prev)
        next.delete(assetId)
        return next
      })
    }

    channel = supabase
      .channel(`asset-positions:${mapId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase realtime event literal
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'warehouse_asset_position_latest',
          filter: `map_id=eq.${mapId}`,
        },
        (payload: {
          eventType: 'INSERT' | 'UPDATE' | 'DELETE'
          new: Record<string, unknown>
          old: Record<string, unknown>
        }) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<RealtimeAssetRow>
            if (oldRow.asset_id) applyDelete(oldRow.asset_id)
            return
          }
          const newRow = payload.new as Partial<RealtimeAssetRow>
          if (
            !newRow.asset_id ||
            typeof newRow.x !== 'number' ||
            typeof newRow.y !== 'number' ||
            typeof newRow.floor_level !== 'number' ||
            typeof newRow.map_id !== 'string'
          ) {
            return
          }
          void applyUpsert({
            asset_id: newRow.asset_id,
            map_id: newRow.map_id,
            x: newRow.x,
            y: newRow.y,
            floor_level: newRow.floor_level,
            heading_deg: newRow.heading_deg ?? null,
            speed_mps: newRow.speed_mps ?? null,
            source: newRow.source ?? null,
            observed_at: newRow.observed_at ?? new Date().toISOString(),
          })
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [mapId, floorLevel, visible])

  useEffect(() => {
    if (!visible) return
    let rafId = 0
    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.max(0, now - last)
      last = now
      const alpha = 1 - Math.exp(-dt / LERP_TAU_MS)

      for (const pos of positionsRef.current.values()) {
        const dx = pos.target.x - pos.current.x
        const dy = pos.target.y - pos.current.y
        let dh = pos.target.heading - pos.current.heading
        // shortest-arc heading delta
        if (dh > 180) dh -= 360
        if (dh < -180) dh += 360

        if (
          Math.abs(dx) > 0.005 ||
          Math.abs(dy) > 0.005 ||
          Math.abs(dh) > 0.05
        ) {
          pos.current.x += dx * alpha
          pos.current.y += dy * alpha
          pos.current.heading += dh * alpha
        }
      }

      const phase = (now % PULSE_PERIOD_MS) / PULSE_PERIOD_MS
      const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
      pulseRef.current = PULSE_MIN + (PULSE_MAX - PULSE_MIN) * wave

      setFrame((f) => (f + 1) % 1_000_000)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [visible])

  const renderList = useMemo(() => Array.from(positions.values()), [positions])

  if (!visible) return null

  const pulseOpacity = pulseRef.current

  return (
    <Layer listening={false}>
      {renderList.map((pos) => {
        const color =
          pos.meta.color ?? KIND_COLOR_DEFAULTS[pos.meta.kind] ?? '#64748b'
        const label = pos.meta.display_name
        const labelWidth = Math.max(40, label.length * 6 + 10)
        const labelHeight = 14

        return (
          <Group
            key={pos.meta.asset_id}
            x={pos.current.x}
            y={pos.current.y}
            rotation={pos.current.heading}
          >
            <Circle
              radius={14}
              stroke={color}
              strokeWidth={2}
              opacity={pulseOpacity}
              listening={false}
            />
            <Circle radius={14} fill={color} listening={false} />
            <Line
              points={[0, 0, 18, 0]}
              stroke='#ffffff'
              strokeWidth={2}
              lineCap='round'
              listening={false}
            />
            <Group rotation={-pos.current.heading} listening={false}>
              <Rect
                x={-labelWidth / 2}
                y={18}
                width={labelWidth}
                height={labelHeight}
                fill='rgba(0, 0, 0, 0.7)'
                cornerRadius={3}
                listening={false}
              />
              <Text
                text={label}
                fontSize={10}
                fill='#ffffff'
                x={-labelWidth / 2}
                y={20}
                width={labelWidth}
                height={labelHeight}
                align='center'
                verticalAlign='middle'
                listening={false}
              />
            </Group>
          </Group>
        )
      })}
    </Layer>
  )
}

// Created and developed by Jai Singh
