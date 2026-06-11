---
tags:
  - type/decision
  - status/active
  - domain/frontend
created: 2026-04-11
---
# ADR: Weather Feature — Open-Meteo + RainViewer + Canvas Animations

## Context
Needed a real-time weather tracking tab within Facility Security that rivals standalone weather apps. Required: current conditions, hourly/daily forecasts, radar map, animated backgrounds, and detailed metrics.

## Decisions

### 1. Open-Meteo as weather data provider
- **Chosen:** Open-Meteo (api.open-meteo.com)
- **Why:** Free, no API key required, no signup, 80+ weather variables, WMO-standardized weather codes, 16-day forecasts, auto timezone, generous rate limits (~10K req/day)
- **Rejected:** OpenWeatherMap (requires API key, 5-day free forecast limit), Tomorrow.io (500 calls/day free), WeatherAPI.com (requires key)

### 2. RainViewer for radar tiles
- **Chosen:** RainViewer (api.rainviewer.com)
- **Why:** Free, no API key, global radar coverage, provides past + nowcast frames for playback, simple tile URL structure compatible with Leaflet
- **Rejected:** OpenWeatherMap tiles (requires API key), Mapbox weather (paid)

### 3. Leaflet for map rendering
- **Chosen:** react-leaflet + leaflet
- **Why:** Lightweight (~40kB), free dark map tiles (CartoDB dark_all), simple tile layer API for radar overlay, well-maintained React bindings
- **Rejected:** Mapbox GL (requires token, heavier), Google Maps (requires key, licensing)

### 4. Canvas + Framer Motion for weather animations
- **Chosen:** HTML5 Canvas for particle systems (rain/snow), Framer Motion for transitions/ambient effects
- **Why:** Both already in the project. Canvas gives 60fps particle performance without DOM overhead. Framer Motion handles declarative animations (sky gradients, cloud drift, lightning).
- **Rejected:** Three.js/WebGL (overkill, already in project but too heavy for 2D weather), react-snowfall (single-purpose), Lottie (requires external animation files)

### 5. WMO weather codes as universal condition mapping
- **Chosen:** Single mapper function from WMO codes → { label, condition, animation, icon }
- **Why:** WMO codes are the international standard, returned directly by Open-Meteo, and map cleanly to animation states. One source of truth for all visual decisions.

### 6. Feature module pattern (not page-level)
- **Chosen:** `src/features/weather/` with barrel exports, lazy-loaded from security route
- **Why:** Matches existing camera-system and visitor-log patterns. Keeps the weather bundle separate (~157kB for radar map chunk, rest inlined with route).

## Consequences
- No API keys to manage or rotate
- No backend proxy needed (all APIs are CORS-friendly)
- Weather data refreshes every 5 minutes via TanStack Query
- Radar map is the heaviest chunk but is double-lazy-loaded
- `prefers-reduced-motion` respected for accessibility

## Related
- [[Weather-Dashboard - Feature Module]] — Component documentation
- [[Add-Weather-Tab-Facility-Security]] — Implementation details
- [[Architecture]] — System overview