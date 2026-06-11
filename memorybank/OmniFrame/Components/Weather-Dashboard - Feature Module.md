---
tags:
  - type/component
  - status/active
  - domain/frontend
created: 2026-04-11
---
# Weather Dashboard - Feature Module

## Purpose
Real-time weather tracking dashboard embedded as a tab within Facility Security (`/facility/security?tab=weather`). Provides current conditions, forecasts, radar map, and detailed meteorological metrics with animated weather backgrounds.

## Location
`src/features/weather/`

## Architecture
Follows the standard feature module pattern (same as [[Camera System - Feature Module]]):
- Lazy-loaded from the security route via `React.lazy`
- Components, hooks, types, and utils in subfolders
- Exported through `index.ts` barrel file

## Data Sources
- **Open-Meteo API** (free, no API key) - Current conditions, hourly (48h), daily (7-day) forecasts
- **Open-Meteo Geocoding API** - City search / location lookup
- **RainViewer API** (free, no API key) - Precipitation radar tile overlays

## Components (12 files)
- `WeatherDashboard.tsx` - Main orchestrator, responsive grid layout
- `WeatherBackground.tsx` - Canvas particle systems (rain/snow) + Framer Motion ambient effects
- `WeatherIcon.tsx` - Animated SVG weather icons
- `CurrentConditionsHero.tsx` - Large temp with spring counter, animated icon
- `HourlyForecastStrip.tsx` - Scrollable 24h strip + Recharts sparkline
- `DailyForecastCards.tsx` - 7-day forecast with animated temperature range bars
- `TemperatureChart.tsx` - Recharts ComposedChart, dual Y-axis
- `WeatherRadarMap.tsx` - Leaflet + RainViewer radar overlay with playback
- `WeatherMetricsGrid.tsx` - 8 metric cards with mini visualizations
- `LocationSearchBar.tsx` - City search combobox + geolocation + C/F toggle
- `WindCompass.tsx` - SVG compass with animated needle
- `SunriseSunsetArc.tsx` - SVG semicircle showing sun position

## Hooks (4 files)
- `useWeather` - TanStack Query, fetches Open-Meteo forecast, 5-min auto-refresh
- `useGeolocation` - Browser geolocation with localStorage persistence
- `useLocationSearch` - Debounced geocoding search (300ms)
- `useRainViewer` - Fetches radar tile timestamps, 10-min refresh

## Dependencies Added
- `react-leaflet` + `leaflet` + `@types/leaflet`

## Related
- [[Camera System - Feature Module]]
- [[VisitorLog - Feature Module]]
- [[ADR-Weather-Open-Meteo]]
- [[Add-Weather-Tab-Facility-Security]]
- [[Architecture]]