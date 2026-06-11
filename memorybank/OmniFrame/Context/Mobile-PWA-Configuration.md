---
tags: [type/context, status/active, domain/infra]
created: 2026-04-10
---
# Mobile & PWA Configuration

## Purpose
Documents the Progressive Web App setup, Capacitor iOS integration, and mobile device agent for OneBox.

## PWA Architecture

OneBox uses **route-scoped PWAs** — not a single global PWA. Each PWA has its own manifest, service worker scope, and meta tag management.

### VitePWA Configuration (in `vite.config.ts`)
- **Register type:** `autoUpdate`
- **Inject register:** `false` (manual registration — PWA managers handle it)
- **Workbox settings:**
  - Glob patterns: `**/*.{js,css,html,ico,png,svg}`
  - Glob ignores: `build-info.json`, `sw.js` (never precached)
  - Navigation fallback: `/index.html` with denylist for API/static routes
  - Navigation preload: disabled
  - Cache ID: `onebox-ai-${BUILD_META.hash}` (deterministic from git hash)
  - `skipWaiting: true`, `clientsClaim: true`, `cleanupOutdatedCaches: true`
- **Runtime caching:**
  - `build-info.json` → **NetworkOnly** (version polling must never be cached)
  - `sw.js` → **NetworkOnly**
  - Google Fonts / gstatic → **CacheFirst** (1 year, max 10 entries)
- **Manifest:** name "OmniFrame - RF Terminal", scope `/rf-interface`, start_url `/rf-interface`
- **Dev options:** disabled

### RF Interface PWA (`src/lib/pwa/rf-pwa-manager.ts`)
- **Singleton:** `RFPWAManager.getInstance()`
- **Scope:** `/rf-interface/` and `/rf-signin`
- **Service worker:** Registered at `/sw.js` with scope `/rf-interface/`
- **Behavior:**
  - Adds PWA meta tags (manifest, theme-color, apple-mobile-web-app-*) dynamically on RF routes
  - Removes meta tags when navigating away from RF routes
  - Enforces RF scope in standalone mode — redirects to `/rf-signin` if user navigates outside
  - Handles route changes via `handleRouteChange()` method
- **iOS support:** apple-touch-icon, apple-mobile-web-app-capable, apple-mobile-web-app-title "OmniFrame RF"

### TimeClock Kiosk PWA (`src/lib/pwa/timeclock-pwa-manager.ts`)
- **Singleton:** `TimeclockPWAManager.getInstance()`
- **Scope:** `/timeclockapp/`
- **Service worker:** Registered at `/sw.js` with scope `/timeclockapp/`
- **Theme:** Dark (`#09090b`), apple-mobile-web-app-status-bar-style `black-translucent`
- **Scope enforcement:** Uses `sessionStorage('timeclock-pwa')` to detect standalone mode and redirect back to `/timeclockapp/` if user navigates away
- **Manifest:** Separate file at `/timeclock-manifest.webmanifest`

## Capacitor iOS Setup

### Dependencies
- `@capacitor/core`: ^7.4.4
- `@capacitor/device`: ^7.0.3
- `@capacitor/ios`: ^7.4.4

### iOS Project Structure (`ios/`)
- **Xcode project:** `App/App.xcodeproj` + `App/App.xcworkspace`
- **CocoaPods:** `App/Podfile` + `App/Podfile.lock`
- **App delegate:** `App/App/AppDelegate.swift`
- **Custom plugins:**
  - `DJIDronePlugin` — Swift/ObjC bridged plugin for DJI drone scanner integration
    - `DJIDronePlugin.swift` (Swift implementation)
    - `DJIDronePlugin.m` (ObjC bridge)
    - `App-Bridging-Header.h`
- **Assets:** `Assets.xcassets` with AppIcon and Splash image sets
- **Storyboards:** `LaunchScreen.storyboard`, `Main.storyboard`

### Device Agent (`src/mobile/device-agent/`)

Capacitor plugin for mobile device management (MDM) telemetry:

**Plugin interface (`device-agent-plugin.ts`):**
- `startTelemetry(config)` / `stopTelemetry()`
- `getAgentStatus()` — running state, last heartbeat, queued events
- `sendHeartbeat()` / `reportLocation()` / `getDeviceHealth()`
- `setConfig(options)`

**Telemetry config:**
- `serverUrl` (defaults to `VITE_MDM_SERVICE_URL` or `http://localhost:8040`)
- `heartbeatIntervalSeconds`: 300 (5 min)
- `locationUpdateIntervalSeconds`: 600 (10 min)
- `healthReportIntervalSeconds`: 1800 (30 min)
- `backgroundLocationEnabled`: false
- `significantChangeOnly`: true

**Device health reports include:** Battery level/state, disk space, memory, network type, carrier, roaming status, OS version, model name.

**React hook (`use-device-agent.ts`):** `useDeviceAgent()` — polls agent status every 30s, provides `startAgent()`, `stopAgent()`, `refresh()`.

## Related
- [[Build-Configuration]] — VitePWA plugin configuration in vite.config.ts
- [[Deployment-Railway]] — Netlify cache headers for PWA assets
- [[Infrastructure - Monitoring and Performance]] — Health check integration
