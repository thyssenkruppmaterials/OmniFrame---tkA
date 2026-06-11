// Created and developed by Jai Singh
import { test, expect } from 'playwright/test'
import { gotoAuthenticated } from './helpers'

test.describe('OmniBelt visibility / kill-switch', () => {
  test('renders on authenticated dashboard', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    // Wait for any OmniBelt host element to appear — default skin is
    // pill, default state is orb, so `omnibelt-mini-orb` is expected.
    const anyHost = page
      .getByTestId('omnibelt-mini-orb')
      .or(page.getByTestId('omnibelt-pill'))
      .or(page.getByTestId('omnibelt-orb'))
      .or(page.getByTestId('omnibelt-skystrip'))
    await expect(anyHost.first()).toBeVisible({ timeout: 30_000 })
  })

  test('does not render on sign-in', async ({ page }) => {
    await page.goto('/sign-in')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('omnibelt-pill')).toHaveCount(0)
    await expect(page.getByTestId('omnibelt-mini-orb')).toHaveCount(0)
    await expect(page.getByTestId('omnibelt-panel')).toHaveCount(0)
  })

  test('does not render on rf-interface', async ({ page }) => {
    await gotoAuthenticated(page, '/rf-interface')
    await expect(page.getByTestId('omnibelt-pill')).toHaveCount(0)
    await expect(page.getByTestId('omnibelt-mini-orb')).toHaveCount(0)
  })

  test('does not render on 404', async ({ page }) => {
    await gotoAuthenticated(page, '/404')
    await expect(page.getByTestId('omnibelt-pill')).toHaveCount(0)
    await expect(page.getByTestId('omnibelt-mini-orb')).toHaveCount(0)
  })

  test('hide via panel menu persists across navigation', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    const { openOmnibeltPanel } = await import('./helpers')
    await openOmnibeltPanel(page)
    await page.getByTestId('omnibelt-panel-menu-trigger').click()
    await page.getByRole('menuitemcheckbox', { name: /Hide OmniBelt/i }).click()
    await expect(page.getByTestId('omnibelt-panel')).toBeHidden()
    // Second goto would normally re-run the init script — call goto
    // directly to leave `userHidden=true` intact, then confirm the
    // visibility gate keeps OmniBelt hidden.
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('omnibelt-pill')).toHaveCount(0)
    await expect(page.getByTestId('omnibelt-mini-orb')).toHaveCount(0)
  })
})

// Created and developed by Jai Singh
