// Created and developed by Jai Singh
import { test, expect } from 'playwright/test'
import {
  driveState,
  expandToPill,
  gotoAuthenticated,
  openOmnibeltPanel,
  openPanelMenu,
  selectSkin,
} from './helpers'

test.describe('OmniBelt skins', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAuthenticated(page, '/')
  })

  test('panel menu shows all three skin options', async ({ page }) => {
    await openPanelMenu(page)
    await expect(page.getByTestId('omnibelt-skin-option-pill')).toBeVisible()
    await expect(page.getByTestId('omnibelt-skin-option-orb')).toBeVisible()
    await expect(page.getByTestId('omnibelt-skin-option-skystrip')).toBeVisible()
  })

  test('switch to orb skin renders orb host', async ({ page }) => {
    await selectSkin(page, 'orb')
    await driveState(page, { collapseState: 'pill' })
    await expect(page.getByTestId('omnibelt-orb')).toBeVisible({ timeout: 15_000 })
  })

  test('switch to skystrip renders top strip', async ({ page }) => {
    await selectSkin(page, 'skystrip')
    // Skystrip hides while panel is open (it morphs INTO the panel).
    // Collapse back to pill state to see the strip itself.
    await driveState(page, { collapseState: 'pill' })
    await expect(page.getByTestId('omnibelt-skystrip')).toBeVisible({
      timeout: 30_000,
    })
  })

  test('switch back to pill skin', async ({ page }) => {
    await selectSkin(page, 'orb')
    await driveState(page, { collapseState: 'pill' })
    await expect(page.getByTestId('omnibelt-orb')).toBeVisible({ timeout: 30_000 })
    await selectSkin(page, 'pill')
    await expandToPill(page)
    await expect(page.getByTestId('omnibelt-pill')).toBeVisible()
  })

  test('skin preference persists after reload', async ({ page }) => {
    await selectSkin(page, 'orb')
    await driveState(page, { collapseState: 'pill' })
    await expect(page.getByTestId('omnibelt-orb')).toBeVisible({ timeout: 30_000 })
    // Reload WITHOUT re-running ensureOmnibeltVisible (which would reset
    // skin back to 'pill'). Direct reload preserves persisted state.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('omnibelt-orb')).toBeVisible({ timeout: 30_000 })
  })

  test('orb click opens radial fan', async ({ page }) => {
    await selectSkin(page, 'orb')
    await driveState(page, { collapseState: 'pill' })
    await expect(page.getByTestId('omnibelt-orb')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('omnibelt-radial-fan')).toBeHidden()
    await page.getByTestId('omnibelt-orb').click()
    await expect(page.getByTestId('omnibelt-radial-fan')).toBeVisible({
      timeout: 15_000,
    })
  })
})

test.describe('OmniBelt overlay z-index (bug fixes)', () => {
  test('panel menu renders above panel glass', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    await openPanelMenu(page)
    const menu = page.getByTestId('omnibelt-panel-menu')
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    expect(box?.width).toBeGreaterThan(100)
    await page.screenshot({
      path: 'tests/e2e/omnibelt/__screenshots__/panel-menu-visible.png',
    })
  })

  test('tool tile tooltip renders above panel', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    await openOmnibeltPanel(page)
    const tile = page.locator('[data-tool-id="quick_note"]')
    await tile.hover()
    const tooltip = page.locator('[data-slot="tooltip-content"]').first()
    await expect(tooltip).toBeVisible({ timeout: 5_000 })
    await page.screenshot({
      path: 'tests/e2e/omnibelt/__screenshots__/tooltip-above-panel.png',
    })
  })

  test('selecting skin from menu does not collapse panel', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    await openPanelMenu(page)
    await page.getByTestId('omnibelt-skin-option-orb').click()
    await expect(page.getByTestId('omnibelt-orb')).toBeVisible({ timeout: 15_000 })
  })
})

// Created and developed by Jai Singh
