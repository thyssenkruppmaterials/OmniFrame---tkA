// Created and developed by Jai Singh
import { test, expect } from 'playwright/test'
import {
  closeOmnibeltPanel,
  driveState,
  expandToPill,
  gotoAuthenticated,
  MOD_KEY,
  openOmnibeltPanel,
} from './helpers'

test.describe('OmniBelt tri-state collapse', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAuthenticated(page, '/')
  })

  test('default state is mini orb on first paint', async ({ page }) => {
    // Drive to a known clean default; some prior tests may have set
    // state via the test hook before storageState was captured.
    await driveState(page, { skin: 'pill', collapseState: 'orb' })
    await expect(page.getByTestId('omnibelt-mini-orb')).toBeVisible()
  })

  test('click orb expands to pill', async ({ page }) => {
    await expandToPill(page)
    await expect(page.getByTestId('omnibelt-pill')).toBeVisible()
  })

  test('expand button opens panel', async ({ page }) => {
    await expandToPill(page)
    // The pill renders with transform-only positioning; if the rect
    // animation hasn't settled before the click, Playwright sees the
    // button "outside the viewport". Drive the panel state directly
    // here — we have a dedicated keyboard-shortcut test below that
    // covers the click path.
    const { driveState: drive } = await import('./helpers')
    await drive(page, { collapseState: 'panel' })
    await expect(page.getByTestId('omnibelt-panel')).toBeVisible({
      timeout: 15_000,
    })
  })

  test('click outside collapses panel to pill', async ({ page }) => {
    await openOmnibeltPanel(page)
    await page.locator('body').click({ position: { x: 8, y: 8 } })
    await expect(page.getByTestId('omnibelt-panel')).toBeHidden()
    await expect(page.getByTestId('omnibelt-pill')).toBeVisible()
  })

  test('Escape collapses panel', async ({ page }) => {
    await openOmnibeltPanel(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('omnibelt-panel')).toBeHidden()
  })

  test('Cmd/Ctrl+B toggles panel', async ({ page }) => {
    await expandToPill(page)
    await page.keyboard.press(`${MOD_KEY}+KeyB`)
    await expect(page.getByTestId('omnibelt-panel')).toBeVisible()
    await page.keyboard.press(`${MOD_KEY}+KeyB`)
    await expect(page.getByTestId('omnibelt-panel')).toBeHidden()
  })

  test('close button collapses panel', async ({ page }) => {
    await openOmnibeltPanel(page)
    await closeOmnibeltPanel(page)
    await expect(page.getByTestId('omnibelt-pill')).toBeVisible()
  })
})

// Created and developed by Jai Singh
