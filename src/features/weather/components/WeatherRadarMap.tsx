// Created and developed by Jai Singh
import { useState, useEffect, useCallback } from 'react'
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
} from '@tabler/icons-react'
import { motion } from 'framer-motion'
import { Icon } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import { useRainViewer } from '../hooks/use-rain-viewer'
import type { GeoLocation } from '../types/weather.types'

interface WeatherRadarMapProps {
  location: GeoLocation
}

const locationIcon = new Icon({
  iconUrl:
    'data:image/svg+xml,' +
    encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" fill="#3b82f6" opacity="0.3"/>
      <circle cx="12" cy="12" r="4" fill="#3b82f6" stroke="white" stroke-width="2"/>
    </svg>
  `),
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, map.getZoom())
  }, [center, map])
  return null
}

export function WeatherRadarMap({ location }: WeatherRadarMapProps) {
  const { frames, getTileUrl, isLoading } = useRainViewer()
  const [frameIndex, setFrameIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [opacity, setOpacity] = useState(0.6)

  const center: [number, number] = [location.latitude, location.longitude]

  useEffect(() => {
    if (frames.length > 0) {
      setFrameIndex(Math.max(0, frames.length - 3))
    }
  }, [frames.length])

  useEffect(() => {
    if (!isPlaying || frames.length === 0) return
    const interval = setInterval(() => {
      setFrameIndex((prev) => {
        if (prev >= frames.length - 1) {
          setIsPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, 700)
    return () => clearInterval(interval)
  }, [isPlaying, frames.length])

  const togglePlay = useCallback(() => {
    if (frameIndex >= frames.length - 1) setFrameIndex(0)
    setIsPlaying((p) => !p)
  }, [frameIndex, frames.length])

  const stepBack = useCallback(() => {
    setFrameIndex((p) => Math.max(0, p - 1))
    setIsPlaying(false)
  }, [])

  const stepForward = useCallback(() => {
    setFrameIndex((p) => Math.min(frames.length - 1, p + 1))
    setIsPlaying(false)
  }, [frames.length])

  const currentFrame = frames[frameIndex]
  const frameTime = currentFrame
    ? new Date(currentFrame.time * 1000).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
    : ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className='overflow-hidden rounded-xl bg-white/[0.07] ring-1 ring-white/10 backdrop-blur-lg'
    >
      <div className='relative h-64 w-full sm:h-72 lg:h-80'>
        {isLoading ? (
          <div className='flex h-full items-center justify-center'>
            <div className='border-primary/20 border-t-primary/60 h-8 w-8 animate-spin rounded-full border-2' />
          </div>
        ) : (
          <MapContainer
            center={center}
            zoom={7}
            className='h-full w-full'
            zoomControl={false}
            attributionControl={false}
            style={{ background: '#0f172a' }}
          >
            <MapUpdater center={center} />
            <TileLayer url='https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' />
            {currentFrame && (
              <TileLayer
                key={currentFrame.path}
                url={getTileUrl(currentFrame)}
                opacity={opacity}
                zIndex={2}
              />
            )}
            <Marker position={center} icon={locationIcon} />
          </MapContainer>
        )}
      </div>

      {/* Controls */}
      <div className='flex items-center gap-3 px-4 py-2.5'>
        <div className='flex items-center gap-0.5'>
          {[
            {
              action: stepBack,
              icon: IconPlayerSkipBack,
              disabled: frameIndex === 0,
            },
            {
              action: togglePlay,
              icon: isPlaying ? IconPlayerPause : IconPlayerPlay,
              disabled: false,
            },
            {
              action: stepForward,
              icon: IconPlayerSkipForward,
              disabled: frameIndex >= frames.length - 1,
            },
          ].map((btn, i) => (
            <button
              key={i}
              onClick={btn.action}
              disabled={btn.disabled}
              className='rounded-lg p-1.5 text-white/50 transition-all hover:bg-white/10 hover:text-white disabled:opacity-30'
            >
              <btn.icon size={14} />
            </button>
          ))}
        </div>

        <span className='text-xs font-medium text-white/60 tabular-nums'>
          {frameTime}
        </span>

        <div className='flex-1'>
          <input
            type='range'
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={frameIndex}
            onChange={(e) => {
              setFrameIndex(Number(e.target.value))
              setIsPlaying(false)
            }}
            className='h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-blue-400 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-400'
          />
        </div>

        <div className='flex items-center gap-1.5'>
          <span className='text-[10px] text-white/30'>Opacity</span>
          <input
            type='range'
            min={0}
            max={100}
            value={opacity * 100}
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            className='h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/10 accent-blue-400 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-400'
          />
        </div>
      </div>
    </motion.div>
  )
}

// Created and developed by Jai Singh
