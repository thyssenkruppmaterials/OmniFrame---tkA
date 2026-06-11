---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-04-10
---
# UI Component Conventions

## Purpose
Documents the coding conventions, naming patterns, import strategies, and customization approach used across the OneBox UI component library.

## Component Structure

### Standard shadcn/ui Component Pattern
Components follow the shadcn/ui convention — they are **owned source code** (not library imports) located in `src/components/ui/`. Each file is self-contained with:

1. **Imports** — Radix primitives, `cn()` utility, `cva` for variants
2. **Variant definitions** — Using `class-variance-authority` (cva)
3. **Component function** — Functional component with destructured props
4. **Named exports** — Both the component and its variants type

```typescript
// Typical shadcn/ui component pattern
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva('base-classes...', {
  variants: { variant: { ... }, size: { ... } },
  defaultVariants: { variant: 'default', size: 'default' },
})

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
```

### Custom Component Pattern
Domain-specific components (RF forms, dialogs, etc.) follow a different pattern:
1. Named exports (not default)
2. Props interfaces defined inline or co-located
3. Compose shadcn/ui primitives rather than raw HTML
4. Use Tailwind classes directly (no separate CSS files)

## Naming Conventions

### Files
- **shadcn/ui primitives:** `kebab-case.tsx` (e.g., `button.tsx`, `dropdown-menu.tsx`, `alert-dialog.tsx`)
- **Domain components:** `kebab-case.tsx` with descriptive prefixes (e.g., `rf-picking-form.tsx`, `delivery-status-filter-dialog.tsx`)
- **RF step components:** `rf-step-{action}.tsx` in `rf-steps/` subdirectory
- **Test files:** `__tests__/{component}.test.tsx`

### Components
- **PascalCase** for all components (e.g., `Button`, `DataTable`, `SidebarMenuCollapsible`)
- **Descriptive compound names** for complex components (e.g., `DataTableColumnHeader`, `CycleCountErrorBoundary`)

### Types
- Interfaces use PascalCase: `DataTableProps<TData, TValue>`, `ThemePreset`, `NavGroup`
- Type aliases for unions: `type NavItem = NavCollapsible | NavLink`
- Variant types from cva: `VariantProps<typeof buttonVariants>`

## Import Patterns

### Path Aliases
All imports use TypeScript path aliases (configured in `tsconfig.json`):
- `@/components/ui/*` — UI primitives
- `@/components/layout/*` — Layout components
- `@/components/theme/*` — Theme components
- `@/components/data-table` — Data table (barrel export)
- `@/lib/utils` — Utility functions (`cn`, etc.)
- `@/lib/theme/*` — Theme utilities
- `@/hooks/*` — Custom hooks
- `@/context/*` — React contexts
- `@/stores/*` — Zustand stores

### Import Organization (observed convention)
1. React imports
2. Third-party libraries (TanStack, Radix, Framer Motion, Lucide icons)
3. Internal utilities (`@/lib/`)
4. Hooks (`@/hooks/`)
5. Components (`@/components/`)
6. Local/relative imports

## Composition Patterns

### `asChild` Pattern (Slot)
Many components support `asChild` prop via Radix `Slot`, allowing the component to render as its child element:
```typescript
<Button asChild>
  <Link to="/page">Navigate</Link>
</Button>
```

### `data-slot` Attribute
Components use `data-slot` for CSS targeting and debugging:
```typescript
<Comp data-slot='button' className={...} />
```

### `cn()` Utility
All className merging uses `cn()` from `@/lib/utils` (wraps `clsx` + `tailwind-merge`):
```typescript
className={cn('base-classes', conditional && 'optional-class', className)}
```

## Styling Approach

### Tailwind CSS
- All styling via Tailwind utility classes
- No separate CSS modules or styled-components
- CSS variables for theme tokens (`--background`, `--primary`, etc.)
- OKLCH color space for CSS variable values
- Responsive prefixes: `sm:`, `md:`, `lg:`
- State variants: `hover:`, `focus-visible:`, `disabled:`, `data-[state=...]:`
- Dark mode: `dark:` prefix (class-based dark mode)

### CSS Variable Integration
Components reference theme tokens via Tailwind's CSS variable integration:
```
bg-background text-foreground border-border
bg-primary text-primary-foreground
bg-muted text-muted-foreground
```

## shadcn/ui Customization Approach

1. **Own the source** — Components are copied into the project, not imported from a package
2. **Modify freely** — Components can be customized directly in `src/components/ui/`
3. **Extend variants** — Add new variants to existing `cva` definitions
4. **Compose** — Build complex components by composing primitives
5. **Override via className** — All components accept and merge `className` props

## Error Boundary Pattern
Class-based React error boundaries with:
- `getDerivedStateFromError` for error state
- `componentDidCatch` for logging
- Fallback UI with retry/refresh/home actions
- Dev-only technical detail disclosure
- HOC wrapper: `withCycleCountErrorBoundary(Component)`

## Presence Components Pattern
Presence indicators follow a composable pattern:
- `StatusIndicator` — Base colored dot with tooltip
- `PresenceAvatar` — Composes Avatar + StatusIndicator
- `OnlineUsersPanel` — Panel listing online users
- `StatusSelector` — Status selection dropdown
- Size system: `xs | sm | md | lg` with mapped CSS classes

## Key Libraries
- **Radix UI** — Accessible primitives (Dialog, Popover, DropdownMenu, etc.)
- **class-variance-authority** — Variant management
- **tailwind-merge** + **clsx** — Class name merging (via `cn()`)
- **Lucide React** — Icon system
- **TanStack React Table** — Table engine
- **TanStack Router** — Routing and navigation
- **Framer Motion** — Animations (sidebar nav, transitions)
- **cmdk** — Command palette
- **Sonner** — Toast notifications
- **culori** — OKLCH color manipulation

## Related
- [[UILibrary - Component Catalog]]
- [[Layout - App Shell]]
- [[DataTable - Reusable Table]]
- [[ThemeSystem - Styling]]