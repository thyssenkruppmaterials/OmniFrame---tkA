import { Link, useMatches } from '@tanstack/react-router'
import { Home } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

/**
 * Map of route paths to human-readable labels.
 * Paths use the full pathname (without the /_authenticated layout prefix).
 */
const routeLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/apps': 'Applications',
  '/apps/grs': 'GRS Apps',
  '/apps/inventory': 'Inventory',
  '/apps/outbound': 'Outbound',
  '/apps/inbound': 'Inbound',
  '/apps/kitting': 'Kitting',
  '/apps/unit-pack': 'Unit Pack',
  '/apps/quality': 'Quality',
  '/apps/customer-portal': 'Customer Portal',
  '/apps/smartsheet-integrations': 'Smartsheet',
  '/apps/shift-productivity': 'Shift Productivity',
  '/apps/standard-work': 'Standard Work',
  '/apps/my-productivity': 'My Productivity',
  '/apps/data-manager': 'Data Manager',
  '/apps/tka-data-manager': 'TKA Data Manager',
  '/business': 'Business',
  '/business/customer-service': 'Customer Service',
  '/business/engineering': 'Engineering',
  '/business/inventory': 'Inventory',
  '/business/logistics': 'Logistics',
  '/business/supply-chain': 'Supply Chain',
  '/business/transportation': 'Transportation',
  '/business/warehouse': 'Warehouse',
  '/intelligence': 'Intelligence Hub',
  '/intelligence/ai-chat': 'A.I. Chat',
  '/intelligence/drone-control': 'Drone Control',
  '/admin': 'Administration',
  '/admin/roles': 'Role Management',
  '/admin/onboarding': 'Onboarding',
  '/admin/user-management': 'User Management',
  '/admin/permissions': 'Permissions',
  '/admin/session-management': 'Session Management',
  '/admin/sap-testing': 'SAP Testing',
  '/admin/system-settings': 'System Settings',
  '/admin/work-queue': 'Work Queue',
  '/admin/performance-monitor': 'Performance Monitor',
  '/settings': 'Settings',
  '/settings/account': 'Account',
  '/settings/appearance': 'Appearance',
  '/settings/notifications': 'Notifications',
  '/settings/display': 'Display',
  '/settings/organization': 'Organization',
  '/settings/cache': 'Cache',
  '/tasks': 'Tasks',
  '/facility': 'Facility',
  '/facility/security': 'Security',
  '/facility/maintenance': 'Maintenance',
  '/facility/it-services': 'IT Services',
  '/facility/vendor-management': 'Vendor Management',
  '/help-center': 'Help Center',
}

/**
 * Derive a readable label from a path segment as a fallback.
 * e.g. "shift-productivity" → "Shift Productivity"
 */
function segmentToLabel(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

interface BreadcrumbEntry {
  label: string
  path: string
  isLast: boolean
}

export function AppBreadcrumbs() {
  const matches = useMatches()

  // Build breadcrumb entries from the matched route chain.
  // We skip layout routes (those containing underscores like _authenticated)
  // and the root route, then construct progressive paths.
  const breadcrumbs: BreadcrumbEntry[] = []
  const seen = new Set<string>()

  for (const match of matches) {
    const pathname = match.pathname

    // Skip root and layout-only matches
    if (!pathname || pathname === '/' || seen.has(pathname)) continue

    // Skip internal layout routes (their id contains underscore segments)
    const routeId = match.routeId ?? ''
    if (
      routeId.includes('_authenticated') ||
      routeId.includes('__root') ||
      routeId.startsWith('/_') ||
      routeId === '__root__'
    )
      continue

    seen.add(pathname)

    // Normalize: remove trailing slash
    const normalizedPath =
      pathname.endsWith('/') && pathname !== '/'
        ? pathname.slice(0, -1)
        : pathname

    const label =
      routeLabels[normalizedPath] ??
      segmentToLabel(normalizedPath.split('/').pop() ?? '')

    breadcrumbs.push({
      label,
      path: normalizedPath,
      isLast: false,
    })
  }

  // Mark last item
  if (breadcrumbs.length > 0) {
    breadcrumbs[breadcrumbs.length - 1].isLast = true
  }

  // Don't render breadcrumbs on the dashboard (no segments beyond root)
  if (breadcrumbs.length === 0) return null

  return (
    <Breadcrumb className='px-4 py-2'>
      <BreadcrumbList>
        {/* Home breadcrumb */}
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to='/' className='flex items-center gap-1'>
              <Home className='size-3.5' />
              <span className='sr-only'>Dashboard</span>
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {breadcrumbs.map((crumb) => (
          <span key={crumb.path} className='contents'>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {crumb.isLast ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={crumb.path}>{crumb.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
