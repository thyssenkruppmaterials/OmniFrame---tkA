---
tags: [type/component, status/active, domain/frontend, domain/admin]
created: 2026-04-10
---
# Employee Onboarding

## Purpose
Comprehensive 9-step employee onboarding wizard for new hire enrollment. Walks administrators through the complete onboarding lifecycle: personal information collection, authentication setup, role and position assignment, shift scheduling, working area configuration, certification tracking, device registration, and final review/submission. Includes accessibility features (ARIA live regions, focus management, keyboard navigation) and UX enhancements (auto-save, draft recovery, skip optional steps, completion celebrations).

## Key Components
- **OnboardingWizard** (`components/onboarding-wizard.tsx`) — Main wizard container with sidebar step indicator layout. All 9 steps are **lazy-loaded** via `React.lazy()` for bundle optimization
- **StepIndicator** / **StepIndicatorCompact** — Visual progress indicator showing completed/current/upcoming steps
- **WizardNavigation** — Previous/Next/Skip navigation buttons with keyboard shortcut hints
- **EmployeePrintouts** — Printable onboarding documents and badge generation

### Wizard Steps (Lazy-loaded)
1. **Step1PersonalInfo** — Name, contact details, emergency contact
2. **Step2Authentication** — Account creation, credential setup
3. **Step3RoleAssignment** — Role selection from available roles
4. **Step4PositionAssignment** — Department and position assignment
5. **Step5ShiftSchedule** — Shift pattern and schedule configuration
6. **Step6WorkingArea** — Physical working area/zone assignment
7. **Step7Certifications** — Required certification tracking (optional, skippable)
8. **Step8DeviceRegistration** — MDM device enrollment (optional, skippable)
9. **Step9ReviewSubmit** — Final review summary and submission

## State Management
- **OnboardingProvider** (`context/onboarding-context.tsx`) — React Context managing:
  - Current step index and navigation
  - Form data across all 9 steps
  - Step validation states
  - Auto-save status with visual feedback
  - Draft persistence (resume interrupted onboarding sessions)
  - Completion tracking
- **OnboardingService** (`services/onboarding.service.ts`) — Backend API for onboarding operations
- **Types** (`types/onboarding.types.ts`) — TypeScript definitions for all step data structures
- **BadgeGenerator** (`utils/badge-generator.ts`) — Employee badge/ID generation utility

## Architecture Notes
- Steps 7 (Certifications) and 8 (Device Registration) are optional with skip buttons
- Auto-save indicator shows save status with visual feedback
- Draft recovery banner appears when resuming an interrupted session
- Step completion triggers celebration animation
- Progress percentage displayed in page title
- Keyboard shortcuts for navigation (documented via tooltip hints)
- Focus management moves focus to new step content on navigation
- ARIA live region announces step changes for screen readers
- All step components code-split — not statically exported from barrel `index.ts` to preserve splitting

## Related
- [[Architecture]]
- [[RolesPermissions - Feature Module]]
- [[UserManagement - Feature Module]]
- [[DeviceManager - Feature Module]]
- [[ShiftProductivity - Feature Module]]