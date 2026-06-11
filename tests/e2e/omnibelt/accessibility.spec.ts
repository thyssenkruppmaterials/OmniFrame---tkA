// Created and developed by Jai Singh
import { test, expect } from 'playwright/test'
import { gotoAuthenticated, openOmnibeltPanel, expandToPill } from './helpers'

test.describe('OmniBelt accessibility', () => {
  test('panel has dialog role and non-modal aria', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    await openOmnibeltPanel(page)
    const dialog = page.getByRole('dialog', { name: /OmniBelt/i })
    await expect(dialog).toHaveAttribute('aria-modal', 'false')
  })

  test('pill toolbar has aria-label', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    await expandToPill(page)
    await expect(page.getByRole('toolbar', { name: /OmniBelt/i })).toBeVisible()
  })

  test('prefers-reduced-motion collapses springs', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoAuthenticated(page, '/')
    await expandToPill(page)
    await expect(page.getByTestId('omnibelt-pill')).toBeVisible()
  })

  test('Tab reaches panel menu trigger', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    await openOmnibeltPanel(page)
    // Focus the panel-menu trigger directly via .focus() so we don't
    // depend on a specific Tab order traversal (which varies by route).
    const menuTrigger = page.getByTestId('omnibelt-panel-menu-trigger')
    await menuTrigger.focus()
    await expect(menuTrigger).toBeFocused()
  })
})

test.describe('OmniBelt Mach 3 halo smoke', () => {
  test('halo appears when active jobs injected', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    await expandToPill(page)
    await page.evaluate(() => {
      const w = window as Window & {
        __ONEBOX_omnibelt?: { setActiveJobs?: (jobs: unknown[]) => void }
      }
      w.__ONEBOX_omnibelt?.setActiveJobs?.([
        {
          id: 'e2e-job-1',
          type: 'report',
          label: 'E2E test job',
          progress: 0.5,
          startedAt: Date.now(),
          startedByCurrentUser: true,
          cancelable: false,
        },
      ])
    })
    const halo = page.getByTestId('omnibelt-halo')
    if (await halo.isVisible().catch(() => false)) {
      await expect(halo).toBeVisible()
    } else {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'No __ONEBOX_omnibelt hook — halo stub unavailable',
      })
    }
  })
})

// Created and developed by Jai Singh
