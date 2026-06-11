// Created and developed by Jai Singh
import { test, expect } from 'playwright/test'
import { gotoAuthenticated, expandToPill, openOmnibeltPanel } from './helpers'

test.describe('OmniBelt panel UI', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAuthenticated(page, '/')
    await openOmnibeltPanel(page)
  })

  test('shows four tabs', async ({ page }) => {
    await expect(page.getByRole('tab', { name: /Pinned/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^All$/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Recent/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Running/i })).toBeVisible()
  })

  test('search filters tools', async ({ page }) => {
    await page.getByPlaceholder('Search tools…').fill('build')
    await expect(page.locator('[data-tool-id="build_info"]')).toBeVisible()
    await expect(page.locator('[data-tool-id="quick_pick"]')).toHaveCount(0)
  })

  test('navigation tool routes and closes panel', async ({ page }) => {
    await page.locator('[data-tool-id="help_docs"]').click()
    await expect(page).toHaveURL(/help-center/, { timeout: 15_000 })
    await expect(page.getByTestId('omnibelt-panel')).toBeHidden()
  })

  test('inline shell opens for quick note', async ({ page }) => {
    await page.locator('[data-tool-id="quick_note"]').click()
    await expect(page.getByText(/All tools/i)).toBeVisible()
    await expect(page.getByRole('textbox').first()).toBeVisible()
  })

  test('build info shell shows build metadata', async ({ page }) => {
    await page.locator('[data-tool-id="build_info"]').click()
    await expect(page.getByText(/build|hash|sha/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})

test.describe('OmniBelt anchors', () => {
  test('right-click opens move-to-corner menu', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    await expandToPill(page)
    const pill = page.getByTestId('omnibelt-pill')
    await pill.click({ button: 'right' })
    await expect(page.getByTestId('omnibelt-position-menu')).toBeVisible()
    await expect(page.getByTestId('omnibelt-position-menu-TL')).toBeVisible()
    await expect(page.getByTestId('omnibelt-position-menu-BR')).toBeVisible()
  })

  test('pin toggles via position menu', async ({ page }) => {
    await gotoAuthenticated(page, '/')
    await expandToPill(page)
    await page.getByTestId('omnibelt-pill').click({ button: 'right' })
    await page.getByTestId('omnibelt-position-menu-pin').click()
    await expect(page.getByTestId('omnibelt-pill-pin')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})

// Created and developed by Jai Singh
