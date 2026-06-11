---
tags:
  - type/implementation
  - status/active
  - domain/frontend
created: 2026-04-11
---
# Add Weather Tab to Facility Security

## Purpose
Added a full-featured real-time weather tracking tab to the Facility Security page at `/facility/security?tab=weather`.

## Steps

### 1. Dependencies
```bash
pnpm add react-leaflet leaflet
pnpm add -D @types/leaflet
```

### 2. Feature module created
Created `src/features/weather/` with 16 files:
- 3 types/utils files
- 4 hooks
- 12 components
- 1 barrel index

### 3. Route integration (`security.tsx`)
- Added `WeatherDashboard` lazy import from `@/features/weather`
- Added `{ id: 'weather', label: 'Weather' }` to `securityTabs` array (between Badge Access and Security Settings)
- Added `case 'weather':` to `renderTabContent()` switch with Suspense fallback
- Added `'weather'` to the full-bleed layout conditional (no border/padding wrapper)

### 4. Key decisions
- Weather tab uses full-bleed layout (like visitor-tracking and camera-system) because it has its own animated background
- `WeatherRadarMap` is double-lazy: lazy inside `WeatherDashboard` and the dashboard itself is lazy from the route
- Default location is Derby, UK (Rolls-Royce facility) with browser geolocation + city search
- Temperature unit (C/F) persisted to localStorage

### 5. Build verification
- TypeScript: clean (`tsc -b`)
- Vite build: clean, weather radar chunk properly code-split at 157kB / 46kB gzip

## Files Changed
- `src/routes/_authenticated/facility/security.tsx` — Tab registration, lazy import, switch case
- `package.json` / `pnpm-lock.yaml` — New dependencies

## Files Created
- `src/features/weather/index.ts`
- `src/features/weather/types/weather.types.ts`
- `src/features/weather/utils/wmo-codes.ts`
- `src/features/weather/utils/weather-helpers.ts`
- `src/features/weather/hooks/use-weather.ts`
- `src/features/weather/hooks/use-geolocation.ts`
- `src/features/weather/hooks/use-location-search.ts`
- `src/features/weather/hooks/use-rain-viewer.ts`
- `src/features/weather/components/WeatherDashboard.tsx`
- `src/features/weather/components/WeatherBackground.tsx`
- `src/features/weather/components/WeatherIcon.tsx`
- `src/features/weather/components/CurrentConditionsHero.tsx`
- `src/features/weather/components/HourlyForecastStrip.tsx`
- `src/features/weather/components/DailyForecastCards.tsx`
- `src/features/weather/components/TemperatureChart.tsx`
- `src/features/weather/components/WeatherRadarMap.tsx`
- `src/features/weather/components/WeatherMetricsGrid.tsx`
- `src/features/weather/components/LocationSearchBar.tsx`
- `src/features/weather/components/WindCompass.tsx`
- `src/features/weather/components/SunriseSunsetArc.tsx`

## Related
- [[Weather-Dashboard - Feature Module]] — Component documentation
- [[ADR-Weather-Open-Meteo]] — Decision record
- [[Camera System - Feature Module]] — Same pattern followed
- [[VisitorLog - Feature Module]] — Same parent route