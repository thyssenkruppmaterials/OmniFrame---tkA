import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
  },
}))

describe('VersionChecker', () => {
  let VersionChecker: typeof import('@/lib/version/version-checker').VersionChecker
  let VERSION_UPDATE_EVENT: string

  beforeEach(async () => {
    vi.resetModules()

    vi.stubGlobal('__BUILD_HASH__', 'abc123')

    const mod = await import('@/lib/version/version-checker')
    VersionChecker = mod.VersionChecker
    VERSION_UPDATE_EVENT = mod.VERSION_UPDATE_EVENT
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('detects when a new version is available', async () => {
    const checker = VersionChecker.getInstance()

    const newBuildInfo = {
      version: '2.0.0',
      buildId: 'xyz789',
      buildTime: new Date().toISOString(),
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(newBuildInfo),
      })
    )

    const eventFired = new Promise<CustomEvent>((resolve) => {
      window.addEventListener(
        VERSION_UPDATE_EVENT,
        ((e: CustomEvent) => {
          resolve(e)
        }) as EventListener,
        { once: true }
      )
    })

    const hasUpdate = await checker.checkNow()

    expect(hasUpdate).toBe(true)
    expect(checker.isUpdateAvailable).toBe(true)

    const event = await eventFired
    expect(event.detail.currentHash).toBe('abc123')
    expect(event.detail.deployedHash).toBe('xyz789')
  })

  it('does not trigger update when version matches', async () => {
    const checker = VersionChecker.getInstance()

    const sameBuildInfo = {
      version: '1.0.0',
      buildId: 'abc123',
      buildTime: new Date().toISOString(),
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(sameBuildInfo),
      })
    )

    const eventSpy = vi.fn()
    window.addEventListener(VERSION_UPDATE_EVENT, eventSpy)

    const hasUpdate = await checker.checkNow()

    expect(hasUpdate).toBe(false)
    expect(eventSpy).not.toHaveBeenCalled()

    window.removeEventListener(VERSION_UPDATE_EVENT, eventSpy)
  })
})
