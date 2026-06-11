// Created and developed by Jai Singh
import { useQuery } from '@tanstack/react-query'
import type { RainViewerData, RainViewerFrame } from '../types/weather.types'

const RAIN_VIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json'

async function fetchRainViewerData(): Promise<RainViewerData> {
  const response = await fetch(RAIN_VIEWER_API)
  if (!response.ok) throw new Error('RainViewer API error')
  return response.json()
}

export function useRainViewer() {
  const query = useQuery<RainViewerData>({
    queryKey: ['rain-viewer-maps'],
    queryFn: fetchRainViewerData,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 2,
  })

  const allFrames: RainViewerFrame[] = [
    ...(query.data?.radar.past ?? []),
    ...(query.data?.radar.nowcast ?? []),
  ]

  const getTileUrl = (frame: RainViewerFrame) =>
    `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_1.png`

  return {
    ...query,
    frames: allFrames,
    getTileUrl,
    host: query.data?.host,
  }
}

// Created and developed by Jai Singh
