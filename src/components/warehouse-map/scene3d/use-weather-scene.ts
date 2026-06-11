// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Warehouse 3D Scene — weather → atmosphere adapter
// ---------------------------------------------------------------------------
// Consumes the existing weather feature's WeatherData (Open-Meteo) and maps it
// to Three.js scene atmosphere parameters: a soft solid-color background, fog,
// a sun direction driven by sunrise/sunset + time of day, ambient fill, and
// precipitation particle parameters. This is the ONLY coupling point between
// the weather feature and the 3D scene — the weather feature itself is untouched.
import { useMemo } from 'react'
import type {
  AnimationState,
  WeatherData,
} from '@/features/weather/types/weather.types'
import { getAnimationState } from '@/features/weather/utils/wmo-codes'
import { isoCameraDistance } from './scene-config'

export interface SceneAtmosphere {
  /** Solid background color (the "soft, solid-colored background"). */
  background: string
  fog: { color: string; near: number; far: number }
  /** Normalized-ish direction from scene center toward the sun. */
  sunDir: [number, number, number]
  sun: { intensity: number; color: string }
  ambient: { intensity: number; color: string }
  hemi: { sky: string; ground: string; intensity: number }
  precipitation: { kind: 'rain' | 'snow' | 'none'; intensity: number }
  /** Horizontal wind drift applied to particles (scene units / s). */
  wind: [number, number, number]
  thunder: boolean
  /** IBL environment intensity multiplier. */
  envIntensity: number
  label: string
  isDay: boolean
}

// Soft daylight defaults — used when weather is disabled or unavailable. This is
// the "neutral editor lighting" baseline so placing racks isn't disrupted by a
// storm rolling in.
export const NEUTRAL_ATMOSPHERE: SceneAtmosphere = {
  background: '#dfe7f0',
  fog: { color: '#dfe7f0', near: 40, far: 220 },
  sunDir: [0.6, 1, 0.45],
  sun: { intensity: 2.1, color: '#fff4e2' },
  ambient: { intensity: 0.55, color: '#eaf0f8' },
  hemi: { sky: '#eef4ff', ground: '#c9d3e0', intensity: 0.7 },
  precipitation: { kind: 'none', intensity: 0 },
  wind: [0.4, 0, 0.2],
  thunder: false,
  envIntensity: 0.9,
  label: 'Clear',
  isDay: true,
}

// Per-condition base color grading. Background/fog tints establish the mood; the
// sun/ambient values are further modulated by cloud cover and day/night below.
// Night backgrounds are deliberately "dusk blue" rather than near-black: the
// Location tab is a working tool first and a mood piece second. A #1a2238-class
// night background + dim sun rendered the whole tab black for any user whose
// weather location was in night-time (the default location is in the UK).
const CONDITION_GRADE: Record<
  AnimationState,
  { bg: [string, string]; fog: string; sun: string; envBoost: number }
> = {
  // [dayBg, nightBg]
  clear: {
    bg: ['#cfe4f7', '#2e3a5c'],
    fog: '#dcebfb',
    sun: '#fff3df',
    envBoost: 1.0,
  },
  clouds: {
    bg: ['#d3dae4', '#323c54'],
    fog: '#d9dfe8',
    sun: '#f3eee4',
    envBoost: 0.85,
  },
  fog: {
    bg: ['#d7dbdf', '#363c48'],
    fog: '#cfd4d9',
    sun: '#ece7df',
    envBoost: 0.7,
  },
  rain: {
    bg: ['#b9c4d1', '#2c3447'],
    fog: '#bcc6d2',
    sun: '#dfe3e8',
    envBoost: 0.7,
  },
  'heavy-rain': {
    bg: ['#a7b3c2', '#272e3f'],
    fog: '#aab5c2',
    sun: '#cfd6dd',
    envBoost: 0.6,
  },
  snow: {
    bg: ['#e3e9f1', '#3a4258'],
    fog: '#e6ebf2',
    sun: '#f4f6fa',
    envBoost: 0.9,
  },
  'heavy-snow': {
    bg: ['#e8edf3', '#3e4660'],
    fog: '#eaeef4',
    sun: '#f6f8fb',
    envBoost: 0.95,
  },
  thunderstorm: {
    bg: ['#9aa6b6', '#232a3a'],
    fog: '#9faab8',
    sun: '#c7cdd6',
    envBoost: 0.5,
  },
}

// Legibility floors — no weather/time combination may light the scene below
// these. Mood can dim the scene; it must never erase it.
const MIN_SUN_INTENSITY = 0.85
const MIN_AMBIENT_INTENSITY = 0.45
const MIN_HEMI_INTENSITY = 0.5
const MIN_ENV_INTENSITY = 0.55

function parseHour(iso: string | undefined): number | null {
  if (!iso) return null
  // Open-Meteo returns local ISO like "2026-06-07T13:00". Extract H:MM as fraction.
  const m = iso.match(/T(\d{2}):(\d{2})/)
  if (!m) return null
  return Number(m[1]) + Number(m[2]) / 60
}

/**
 * Sun direction + intensity from sunrise/sunset and current time. During the
 * day the sun arcs east→west; at night a low cool "moon" direction is returned.
 */
function computeSun(weather: WeatherData): {
  dir: [number, number, number]
  dayT: number
} {
  const now = parseHour(weather.current.time)
  const sunrise = parseHour(weather.daily.sunrise?.[0])
  const sunset = parseHour(weather.daily.sunset?.[0])

  if (now == null || sunrise == null || sunset == null || sunset <= sunrise) {
    return { dir: [0.6, 1, 0.45], dayT: 0.5 }
  }

  // Fraction through the daylight window (clamped) drives the arc.
  const t = Math.min(1, Math.max(0, (now - sunrise) / (sunset - sunrise)))
  // Azimuth sweeps from east (-1 x) at sunrise to west (+1 x) at sunset.
  const az = (t - 0.5) * Math.PI // -90°..+90°
  // Elevation peaks at solar noon (~62°), low near the horizon.
  const elev = Math.sin(t * Math.PI) * (Math.PI / 2.9)
  const cosE = Math.cos(elev)
  const dir: [number, number, number] = [
    Math.sin(az) * cosE,
    Math.max(0.12, Math.sin(elev)),
    Math.cos(az) * cosE * 0.6 + 0.25,
  ]
  return { dir, dayT: t }
}

/**
 * Map WeatherData → scene atmosphere. When `enabled` is false (editor neutral
 * mode) or weather is unavailable, returns the soft neutral daylight baseline.
 */
export function useWeatherScene(
  weather: WeatherData | null | undefined,
  opts: { span: number; enabled: boolean }
): SceneAtmosphere {
  const { span, enabled } = opts
  return useMemo(() => {
    // Fog is measured from the CAMERA, which sits isoCameraDistance(span) away
    // on the iso rail — so fogNear starts just past the far edge of the layout
    // and only the distant ground plane fades into the horizon. Anchoring fog
    // at the world origin (the old behavior) put the entire scene 60%+ deep
    // into fog at the default zoom.
    const camDist = isoCameraDistance(span)
    const fogNear = camDist + span * 0.9
    const fogFar = camDist + span * 3.2 + 60

    if (!enabled || !weather) {
      return {
        ...NEUTRAL_ATMOSPHERE,
        fog: { ...NEUTRAL_ATMOSPHERE.fog, near: fogNear, far: fogFar },
      }
    }

    const c = weather.current
    const anim = getAnimationState(c.weatherCode)
    const grade = CONDITION_GRADE[anim] ?? CONDITION_GRADE.clear
    const isDay = c.isDay
    const cloud = Math.min(1, Math.max(0, c.cloudCover / 100))

    const { dir } = computeSun(weather)
    const sunDir: [number, number, number] = isDay ? dir : [-0.3, 0.5, -0.4]

    // Cloud cover and night dim the sun and lift ambient/fog — floored so the
    // scene always stays legible (see MIN_* above).
    const baseSun = isDay ? 2.4 : 1.1
    const sunIntensity = Math.max(
      MIN_SUN_INTENSITY,
      baseSun * (1 - cloud * 0.55)
    )
    const ambientIntensity = Math.max(
      MIN_AMBIENT_INTENSITY,
      (isDay ? 0.5 : 0.42) + cloud * 0.25
    )
    const background = isDay ? grade.bg[0] : grade.bg[1]

    // Precipitation particle params.
    let kind: 'rain' | 'snow' | 'none' = 'none'
    let intensity = 0
    if (anim === 'rain') {
      kind = 'rain'
      intensity = 0.45
    } else if (anim === 'heavy-rain') {
      kind = 'rain'
      intensity = 1
    } else if (anim === 'snow') {
      kind = 'snow'
      intensity = 0.5
    } else if (anim === 'heavy-snow') {
      kind = 'snow'
      intensity = 1
    } else if (anim === 'thunderstorm') {
      kind = 'rain'
      intensity = 1
    }

    // Wind drift from speed (km/h → scene units) + direction (deg, meteorological).
    const windRad = (c.windDirection * Math.PI) / 180
    const windMag = Math.min(2.5, c.windSpeed / 30)
    const wind: [number, number, number] = [
      Math.sin(windRad) * windMag,
      0,
      Math.cos(windRad) * windMag,
    ]

    return {
      background,
      fog: {
        color: isDay ? grade.fog : background,
        near: fogNear,
        far: fogFar,
      },
      sunDir,
      sun: { intensity: sunIntensity, color: grade.sun },
      ambient: {
        intensity: ambientIntensity,
        color: isDay ? '#eaf0f8' : '#9fb0d0',
      },
      hemi: {
        sky: background,
        ground: isDay ? '#c9d3e0' : '#3a4254',
        intensity: isDay ? 0.65 : MIN_HEMI_INTENSITY,
      },
      precipitation: { kind, intensity },
      wind,
      thunder: anim === 'thunderstorm',
      envIntensity: Math.max(
        MIN_ENV_INTENSITY,
        grade.envBoost * (isDay ? 1 : 0.75)
      ),
      label: `${anim}${isDay ? '' : ' (night)'}`,
      isDay,
    }
  }, [weather, span, enabled])
}

// Created and developed by Jai Singh
