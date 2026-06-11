// Created and developed by Jai Singh
/**
 * RBAC Guards Audit Tests
 * Verify that critical admin components have PermissionGuard wrappers and
 * that key security patterns remain in place across the codebase.
 *
 * These tests read source files and check for expected patterns, acting as
 * structural regression guards — if someone removes a PermissionGuard import
 * or a security check, these tests will fail.
 */
import { resolve, dirname } from 'path'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { describe, it, expect } from 'vitest'

// Derive __dirname in ESM-compatible way (works in Vitest)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Read a source file relative to `src/`.
 * This test file lives at  src/__tests__/security/  so  ../../  → src/
 */
function readSrcFile(relativePath: string): string {
  const fullPath = resolve(__dirname, '../../', relativePath)
  return readFileSync(fullPath, 'utf-8')
}

/**
 * Read a project-root file (e.g. api/, rust-core-service/).
 * src/__tests__/security/ → ../../.. → project root
 */
function readProjectFile(relativePath: string): string {
  const fullPath = resolve(__dirname, '../../../', relativePath)
  return readFileSync(fullPath, 'utf-8')
}

// ---------------------------------------------------------------------------
// Admin Component Permission Guards
// ---------------------------------------------------------------------------

describe('Admin Component Permission Guards', () => {
  it('roles-primary-buttons should import PermissionGuard', () => {
    const content = readSrcFile(
      'features/admin/roles/components/roles-primary-buttons.tsx'
    )
    expect(content).toContain('PermissionGuard')
  })

  it('roles data-table-row-actions should import PermissionGuard', () => {
    const content = readSrcFile(
      'features/admin/roles/components/data-table-row-actions.tsx'
    )
    expect(content).toContain('PermissionGuard')
  })

  it('permissions-primary-buttons should import PermissionGuard', () => {
    const content = readSrcFile(
      'features/admin/permissions/components/permissions-primary-buttons.tsx'
    )
    expect(content).toContain('PermissionGuard')
  })

  it('permissions data-table-row-actions should import PermissionGuard', () => {
    const content = readSrcFile(
      'features/admin/permissions/components/data-table-row-actions.tsx'
    )
    expect(content).toContain('PermissionGuard')
  })

  it('user-management-table should import PermissionGuard', () => {
    const content = readSrcFile(
      'features/user-management/components/user-management-table.tsx'
    )
    expect(content).toContain('PermissionGuard')
  })

  it('session-management index should import PermissionGuard', () => {
    const content = readSrcFile('features/session-management/index.tsx')
    expect(content).toContain('PermissionGuard')
  })

  it('user-permissions-dialog should use real permission check, not hardcoded canModify', () => {
    const content = readSrcFile(
      'features/user-management/components/user-permissions-dialog.tsx'
    )
    // canModify must be computed from the permission store, not hardcoded to true
    expect(content).not.toContain('canModify: true')
    expect(content).toContain('usePermissionStore')
  })
})

// ---------------------------------------------------------------------------
// Route Protection Configuration
// ---------------------------------------------------------------------------

describe('Route Protection Configuration', () => {
  it('route-protection should enforce resource permissions for admin routes (fail-closed)', () => {
    const content = readSrcFile('lib/auth/route-protection.ts')
    // The route protection must distinguish admin routes for strict enforcement
    expect(content).toContain("startsWith('/admin')")
  })

  it('admin route.tsx should have beforeLoad with createProtectedRouteBeforeLoad', () => {
    const content = readSrcFile('routes/_authenticated/admin/route.tsx')
    expect(content).toContain('beforeLoad')
    expect(content).toContain('createProtectedRouteBeforeLoad')
  })

  it('tab-permissions-debug should gate exec_sql behind DEV check', () => {
    const content = readSrcFile(
      'routes/_authenticated/admin/tab-permissions-debug.tsx'
    )
    // The exec_sql RPC call must be gated behind an import.meta.env.DEV check
    expect(content).toContain('import.meta.env.DEV')
    expect(content).toContain('exec_sql')
  })
})

// ---------------------------------------------------------------------------
// Permission Store Security Patterns
// ---------------------------------------------------------------------------

describe('Permission Store Security Patterns', () => {
  it('permissionStore should implement fail-closed during loading', () => {
    const content = readSrcFile('stores/permissionStore.ts')
    // Must check isLoading and return false (fail-closed) — not true (fail-open)
    expect(content).toContain('isLoading')
    // Should NOT contain a pattern that grants access while loading
    expect(content).not.toMatch(/if\s*\(\s*isLoading\s*\)\s*return\s+true/)
  })

  it('permissionStore should deny when currentUserId is null', () => {
    const content = readSrcFile('stores/permissionStore.ts')
    // The guard: if (!currentUserId) return false
    expect(content).toContain('if (!currentUserId) return false')
  })

  it('permissionStore should register with rbacCacheManager', () => {
    const content = readSrcFile('stores/permissionStore.ts')
    expect(content).toContain('rbacCacheManager.registerCacheLayer')
  })
})

// ---------------------------------------------------------------------------
// Python Auth Hardening Markers
// ---------------------------------------------------------------------------

describe('Python Auth Hardening Markers', () => {
  it('settings.py should not contain hardcoded API tokens', () => {
    const content = readProjectFile('api/config/settings.py')
    // Should use os.environ.get for secrets
    expect(content).toContain('os.environ.get')
    // Should NOT have a hardcoded long alphanumeric token in the smartsheet field
    expect(content).not.toMatch(
      /smartsheet_access_token:\s*str\s*=\s*"[A-Za-z0-9]{20,}"/
    )
  })

  it('settings.py should default JWT fallback to disabled', () => {
    const content = readProjectFile('api/config/settings.py')
    // rust_core_fallback must default to "false"
    expect(content).toMatch(/rust_core_fallback.*"false"/)
  })

  it('supabase_auth.py should block fallback in production', () => {
    const content = readProjectFile('api/auth/supabase_auth.py')
    // Must have an explicit production guard
    expect(content).toContain('production')
    expect(content).toContain('SECURITY WARNING')
  })

  it('supabase_auth.py should implement _is_fallback_enabled with production check', () => {
    const content = readProjectFile('api/auth/supabase_auth.py')
    // The function must exist and check environment via settings.environment
    expect(content).toContain('_is_fallback_enabled')
    expect(content).toContain('settings.environment')
  })

  it('supabase_auth.py should have require_admin_role that checks roles table', () => {
    const content = readProjectFile('api/auth/supabase_auth.py')
    // Must have the admin role verification based on role names, not email domains
    expect(content).toContain('require_admin_role')
    expect(content).toContain('_verify_admin_role')
    // Should NOT use the old insecure email domain check in executable code.
    // The string may appear in comments documenting the security fix, which is fine.
    // We check that no Python comparison uses the domain literally:
    expect(content).not.toMatch(/endswith\(["']@j\.ai["']\)/)
    expect(content).not.toMatch(/==\s*["']@j\.ai["']/)
  })
})

// Created and developed by Jai Singh
