---
tags: [type/component, status/active, domain/frontend, domain/backend]
created: 2026-04-10
---
# HR & Time Tracking

## Purpose
HR module providing three interconnected sub-features: **Employee Reviews** for performance management, **Time Clock Kiosk** for badge-based clock-in/out at shared terminals, and **Time Tracker** for timecard management and reporting. Handles the full employee time-and-attendance lifecycle from physical kiosk interaction through administrative review and reporting.

## Key Components

### Employee Reviews (`hr/employee-reviews/`)
- **ReviewsDashboard** — Overview of review cycles, completion rates, upcoming reviews
- **ActiveReviews** — In-progress review management panel
- **ReviewTemplates** — Template library for different review types (annual, probationary, etc.)
- **ReviewHistory** — Historical review records and trends
- **ReviewSettings** — Review cycle configuration and notification rules

### Time Clock Kiosk (`hr/time-clock-kiosk/`)
- **TimeClockKiosk** (`time-clock-kiosk.tsx`) — Full-screen kiosk application with state machine flow:
  - States: `badge_entry` → `employee_confirm` → `camera_capture` → `processing` → `confirmation`
  - Optional flows: `overtime_signup`, `time_adjustment`
- **KioskSplashScreen** — Idle/attract screen with branding
- **BadgeInput** — Badge number entry (numeric keypad or scanner)
- **KioskNumericKeypad** — Touch-optimized numeric input for kiosk mode
- **CameraCapture** — Webcam photo capture for clock-in verification
- **ClockConfirmation** — Success/failure confirmation display with auto-reset
- **KioskTimeDial** — Visual time display component
- **KioskOvertimeSignup** — Overtime availability signup at clock-in
- **KioskTimeAdjustment** — Time correction request submission
- **TimeClockService** (`services/time-clock.service.ts`) — Backend operations:
  - `lookupEmployeeByBadge()` — Badge-to-employee resolution
  - `getActiveClockEntry()` / `getRecentEntries()` — Current and recent clock records
  - `clockIn()` / `clockOut()` — Clock event recording
  - `uploadClockPhoto()` — Verification photo storage

### Time Tracker (`hr/time-tracker/`)
- **TimecardDashboard** — Timecard overview with summary metrics
- **TimecardManagement** — Administrative timecard editing and approval
- **ClockEntries** — Raw clock-in/out entry log
- **TimeReports** — Time reporting and analytics
- **TimeTrackerSettings** — Time tracking configuration (rounding rules, overtime thresholds)
- **TimeTrackerService** (`services/time-tracker.service.ts`) — Backend service for timecard CRUD

## State Management
- **Time Clock Kiosk** — Local `useState` state machine with 7 states; no external context needed (kiosk is self-contained)
  - Real-time clock updated every 1 second
  - Auto-reset to `badge_entry` after confirmation timeout
  - Employee lookup, active entry detection, photo capture all managed locally
- **Time Tracker** — Service-based data fetching via `time-tracker.service.ts`
- **Employee Reviews** — Component-local state management

## Architecture Notes
- Kiosk is designed for shared terminal use — no authentication context, uses badge lookup only
- Camera capture requires browser `getUserMedia` permission
- Kiosk uses `framer-motion` for smooth state transitions
- Time Clock Kiosk includes `ThemeSwitch` but no full header (kiosk mode)
- Employee data types: `EmployeeLookupResult`, `ClockEntry`, `ClockResult`

## Related
- [[Architecture]]
- [[UserManagement - Feature Module]]
- [[ShiftProductivity - Feature Module]]
- [[Onboarding - Feature Module]]