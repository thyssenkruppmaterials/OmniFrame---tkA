---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# UILibrary - Component Catalog

## Purpose
Catalog of all UI components in the OneBoxFullStack application. The project uses **shadcn/ui** (new-york style) with **Tailwind CSS**, **Radix UI** primitives, and **class-variance-authority** (cva) for variant management. Icons come from **Lucide React**.

## shadcn/ui Configuration
- **Style:** `new-york`
- **RSC:** `false` (client-side React / Vite)
- **TSX:** `true`
- **Base color:** `slate`
- **CSS variables:** `true` (OKLCH color space)
- **Icon library:** `lucide`
- **Path aliases:** `@/components/ui`, `@/lib/utils`, `@/hooks`
- **Registry:** magicui (`https://magicui.design/r/{name}.json`)
- **Config file:** `components.json` at project root

## Core Primitives (shadcn/ui)

| Component | File | Description |
|-----------|------|-------------|
| Button | `button.tsx` | Multi-variant button (default, destructive, outline, secondary, ghost, link) with sizes (default, sm, lg, icon). Uses `cva` + `Slot` for composition. |
| Input | `input.tsx` | Styled text input |
| Textarea | `textarea.tsx` | Multi-line text input |
| Label | `label.tsx` | Form label |
| Form | `form.tsx` | React Hook Form integration with field/item/control/message |
| Field | `field.tsx` | Standalone field wrapper |
| Select | `select.tsx` | Dropdown select |
| Multi-Select | `multi-select.tsx` | Multi-value select |
| Checkbox | `checkbox.tsx` | Boolean toggle checkbox |
| Radio Group | `radio-group.tsx` | Radio button group |
| Switch | `switch.tsx` | Toggle switch |
| Slider | `slider.tsx` | Range slider |
| Calendar | `calendar.tsx` | Date calendar picker |
| Date Picker | `date-picker.tsx` | Date input with calendar popover |
| Time Picker | `time-picker.tsx` | Time selection input |
| Color Picker | `color-picker-input.tsx` | Color selection input |
| Input OTP | `input-otp.tsx` | One-time password input |

## Layout & Navigation

| Component | File | Description |
|-----------|------|-------------|
| Sidebar | `sidebar.tsx` | Full sidebar system (Provider, Header, Content, Footer, Rail, Menu, MenuButton, etc.) with cookie-persisted collapse state. ~724 lines. |
| Tabs | `tabs.tsx` | Tab navigation |
| Tab Menu | `tab-menu.tsx` | Alternative tab-based menu |
| Breadcrumb | `breadcrumb.tsx` | Breadcrumb navigation trail |
| Separator | `separator.tsx` | Visual divider |
| Scroll Area | `scroll-area.tsx` | Custom scrollbar area |
| Collapsible | `collapsible.tsx` | Expand/collapse container |

## Overlay & Feedback

| Component | File | Description |
|-----------|------|-------------|
| Dialog | `dialog.tsx` | Modal dialog |
| Alert Dialog | `alert-dialog.tsx` | Confirmation dialog |
| Confirm Dialog | `confirm-dialog.tsx` | Custom confirmation dialog |
| Sheet | `sheet.tsx` | Slide-out panel |
| Popover | `popover.tsx` | Floating popover |
| Tooltip | `tooltip.tsx` | Hover tooltip |
| Dropdown Menu | `dropdown-menu.tsx` | Contextual dropdown menu |
| Command | `command.tsx` | Command palette (cmdk) |
| Sonner | `sonner.tsx` | Toast notifications (via Sonner) |
| Custom Toast | `custom-toast.tsx` | Custom toast component |
| Alert | `alert.tsx` | Inline alert message |
| Progress | `progress.tsx` | Progress bar |

## Data Display

| Component | File | Description |
|-----------|------|-------------|
| Table | `table.tsx` | HTML table primitives |
| Card | `card.tsx` | Content card container |
| Badge | `badge.tsx` | Status/label badge |
| Avatar | `avatar.tsx` | User avatar with fallback |
| Skeleton | `skeleton.tsx` | Loading placeholder |
| Barcode | `barcode.tsx` | Barcode renderer |
| QR Code | `shadcn-io/qr-code/` | QR code generator (server + client) |
| Shipping Label | `shipping-label.tsx` | Printable shipping label |
| Productivity Card | `productivity-card.tsx` | Productivity metrics card |

## Specialized / Domain Components

| Component | File | Description |
|-----------|------|-------------|
| Scanner Input | `scanner-input.tsx` | Barcode scanner input |
| Scanner Password | `scanner-password-input.tsx` | Masked scanner input |
| QWERTY Keyboard | `qwerty-keyboard.tsx` | On-screen keyboard |
| Disposition Select | `disposition-select.tsx` | Material disposition selector |
| Disposition Editor | `disposition-editor-dialog.tsx` | Disposition editing dialog |
| Kitting Data Grid | `kitting-data-grid.tsx` | Kit building data grid |

## RF (Radio Frequency) Workflow Components
Large collection of RF/warehouse workflow components:
- `rf-cycle-count-unified.tsx` - Unified cycle count form
- `rf-picking-form.tsx` - Picking workflow
- `rf-putaway-form.tsx` - Putaway workflow
- `rf-kitting-picking-form.tsx` - Kitting pick workflow
- `rf-build-kit-form.tsx` - Kit building form
- `rf-inspect-kit-form.tsx` - Kit inspection
- `rf-sap-migo-form.tsx` - SAP MIGO integration
- `rf-location-scanner.tsx` - Location scanning
- `rf-task-claim.tsx` - Task claiming
- `rf-drone-control.tsx` - Drone control interface
- `rf-work-queue-dashboard.tsx` - Work queue dashboard
- `rf-work-queue-dashboard-simple.tsx` - Simplified dashboard
- `rf-grs-cycle-count-form.tsx` - GRS-specific cycle count
- `rf-cycle-count-out-form.tsx` - Cycle count out
- `rf-unknown-batch-dialog.tsx` - Unknown batch handling
- `rf-empty-location-material-dialog.tsx` - Empty location verification

### RF Steps System (`rf-steps/`)
Modular step-based workflow system:
- `types.ts` - Step type definitions
- `index.ts` - Barrel exports
- `rf-step-barcode-scan.tsx` - Barcode scanning step
- `rf-step-location-scan.tsx` - Location scanning step
- `rf-step-quantity-entry.tsx` - Quantity entry step
- `rf-step-condition-assessment.tsx` - Condition assessment
- `rf-step-serial-capture.tsx` - Serial number capture
- `rf-step-photo-capture.tsx` - Photo documentation
- `rf-step-notes.tsx` - Notes entry step
- `rf-step-review.tsx` - Review step
- `rf-step-confirm.tsx` - Confirmation step
- `rf-step-supervisor-signoff.tsx` - Supervisor sign-off
- `rf-step-empty-location-verification.tsx` - Empty location check

## Import/Filter Dialogs
- `import-progress-dialog.tsx` / `import-confirm-dialog.tsx` - Generic import dialogs
- `material-master-import-progress-dialog.tsx` - Material master import
- `sq01-import-progress-dialog.tsx` / `sq01-filter-dialog.tsx` - SQ01 data
- `lx03-import-progress-dialog.tsx` / `lx03-import-confirm-dialog.tsx` / `lx03-filter-dialog.tsx` - LX03 data
- `wave-delivery-dialog.tsx` - Wave delivery management
- `delivery-status-filter-dialog.tsx` - Delivery filtering
- `advanced-delivery-filter-dialog.tsx` - Advanced delivery filtering
- `add-kit-build-plan-dialog.tsx` - Kit build plan creation
- `count-resume-prompt.tsx` - Count resume prompt
- `device-registration-dialog.tsx` - Device registration

## Branding & Visual
- `cinematic-logo.tsx` - Animated cinematic logo
- `onebox-logo.tsx` - OneBox brand logo
- `animated-theme-toggler.tsx` - Animated light/dark toggle
- `typewriter.tsx` - Typewriter text effect

## Component Count
**~100 files** in `src/components/ui/` spanning primitives, overlays, data display, domain-specific RF workflows, import dialogs, and branding elements.

## Related
- [[Layout - App Shell]]
- [[DataTable - Reusable Table]]
- [[ThemeSystem - Styling]]
- [[UI-Component-Conventions]]