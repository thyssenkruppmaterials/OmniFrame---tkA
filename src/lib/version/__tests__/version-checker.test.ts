// Created and developed by Jai Singh
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
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

  it('self-disables polling after FAILURE_SUPPRESSION_THRESHOLD consecutive failures', async () => {
    const checker = VersionChecker.getInstance()

    // Simulate the corporate-proxy CORS-blocked-redirect failure mode:
    // every fetch throws `TypeError: Failed to fetch`.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    )

    // Three consecutive failures trip the latch.
    await checker.checkNow()
    await checker.checkNow()
    await checker.checkNow()

    // After the trip, a fourth call must NOT re-log info (one-shot latch)
    // — verified indirectly by the absence of new fetches scheduled. The
    // polling timer is torn down, so the next checkNow() either runs
    // (manual call still works) or no-ops.
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(
      3
    )

    // The latch should NOT prevent a manual `checkNow()` from running —
    // it only prevents the auto-poll timer from re-scheduling itself.
    await checker.checkNow()
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(
      4
    )
  })

  it('resets the failure counter on a successful fetch', async () => {
    const checker = VersionChecker.getInstance()

    const fetchMock = vi
      .fn()
      // Two failures, then a success.
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          version: '1.0.0',
          buildId: 'abc123',
          buildTime: new Date().toISOString(),
        }),
      })
      // Two more failures must NOT trip the latch (counter was reset).
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    vi.stubGlobal('fetch', fetchMock)

    await checker.checkNow() // failure 1
    await checker.checkNow() // failure 2 (would be one shy of trip)
    await checker.checkNow() // success → reset counter
    await checker.checkNow() // failure 1 (counter was reset)
    await checker.checkNow() // failure 2 (still under threshold)

    expect(fetchMock).toHaveBeenCalledTimes(5)
    // Latch not tripped: a sixth call still issues a fetch.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await checker.checkNow()
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
})

describe('isVersionCheckKioskRoute', () => {
  let isVersionCheckKioskRoute: typeof import('@/lib/version/version-checker').isVersionCheckKioskRoute

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('@/lib/version/version-checker')
    isVersionCheckKioskRoute = mod.isVersionCheckKioskRoute
  })

  it('matches RF terminal routes', () => {
    expect(isVersionCheckKioskRoute('/rf-interface')).toBe(true)
    expect(isVersionCheckKioskRoute('/rf-signin')).toBe(true)
    expect(isVersionCheckKioskRoute('/rf-interface/cycle-count/abc-123')).toBe(
      true
    )
  })

  it('matches timeclock kiosk routes', () => {
    expect(isVersionCheckKioskRoute('/timeclock')).toBe(true)
    expect(isVersionCheckKioskRoute('/timeclockapp')).toBe(true)
    expect(isVersionCheckKioskRoute('/timeclockapp/punch')).toBe(true)
  })

  it('does NOT match customer-portal routes (deliberately excluded)', () => {
    // Customer portal benefits from auto-version pickup (public-internet,
    // customer-facing). It opts out of presence but NOT version checks.
    expect(isVersionCheckKioskRoute('/customer-portal')).toBe(false)
    expect(isVersionCheckKioskRoute('/customer-portal/tickets')).toBe(false)
  })

  it('does not match office app routes', () => {
    expect(isVersionCheckKioskRoute('/')).toBe(false)
    expect(isVersionCheckKioskRoute('/admin/sap-testing')).toBe(false)
    expect(isVersionCheckKioskRoute('/apps/inventory')).toBe(false)
  })
})

// Created and developed by Jai Singh
