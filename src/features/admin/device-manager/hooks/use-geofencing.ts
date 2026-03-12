import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DeviceManagerService } from '@/lib/supabase/device-manager.service'
import type { Geofence } from '../types/device-manager.types'

export function useGeofences() {
  return useQuery({
    queryKey: ['mdm-geofences'],
    queryFn: DeviceManagerService.getGeofences,
    staleTime: 60_000,
  })
}

export function useCreateGeofence() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (geofence: Partial<Geofence>) =>
      DeviceManagerService.createGeofence(geofence),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mdm-geofences'] })
    },
  })
}

export function isPointInCircle(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): boolean {
  const R = 6371e3
  const phi1 = (lat * Math.PI) / 180
  const phi2 = (centerLat * Math.PI) / 180
  const deltaPhi = ((centerLat - lat) * Math.PI) / 180
  const deltaLambda = ((centerLng - lng) * Math.PI) / 180
  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = R * c
  return distance <= radiusMeters
}
