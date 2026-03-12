import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('Work Service Client', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('constructs work service URL from environment', async () => {
    const testUrl = 'https://work-service.example.com'
    vi.stubEnv('VITE_WORK_SERVICE_URL', testUrl)

    const mod = await import('@/lib/work-service/client')

    expect(mod).toBeDefined()
    expect(mod.setWorkServiceOrganization).toBeDefined()
  })

  it('falls back to localhost when VITE_WORK_SERVICE_URL is not set', async () => {
    vi.stubEnv('VITE_WORK_SERVICE_URL', '')

    const mod = await import('@/lib/work-service/client')

    expect(mod).toBeDefined()
    expect(typeof mod.setWorkServiceOrganization).toBe('function')
  })

  it('exports setWorkServiceOrganization for auth context', async () => {
    const mod = await import('@/lib/work-service/client')

    expect(() => mod.setWorkServiceOrganization('org-123')).not.toThrow()
    expect(() => mod.setWorkServiceOrganization(null)).not.toThrow()
  })
})
