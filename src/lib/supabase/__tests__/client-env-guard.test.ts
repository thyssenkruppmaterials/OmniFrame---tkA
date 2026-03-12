import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('Supabase client env guard', () => {
  beforeEach(() => {
    vi.resetModules()
    if (typeof window !== 'undefined') {
      delete (window as any).__OMNIFRAME_SUPABASE_CLIENT__
      delete (window as any).__OMNIFRAME_SUPABASE_ADMIN__
      delete (window as any).__OMNIFRAME_CLIENT_INIT__
      delete (window as any).__OMNIFRAME_SERVICE_KEY_WARNED__
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not create admin client in browser environment', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.stubEnv('VITE_SUPABASE_SERVICE_ROLE_KEY', '')

    const { supabaseAdmin } = await import('@/lib/supabase/client')

    expect(supabaseAdmin).toBeNull()
  })

  it('warns when service role key is present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.stubEnv(
      'VITE_SUPABASE_SERVICE_ROLE_KEY',
      'service-role-key-should-not-be-here'
    )

    const { supabaseAdmin } = await import('@/lib/supabase/client')
    const { logger } = await import('@/lib/utils/logger')

    expect(supabaseAdmin).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('SECURITY WARNING')
    )
  })
})
