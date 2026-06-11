// Created and developed by Jai Singh
import { test, expect } from 'playwright/test'
import { gotoAuthenticated } from './helpers'

test.describe('OmniBelt admin dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAuthenticated(page, '/admin/omnibelt')
  })

  test('loads overview tab by default', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/omnibelt/)
    await expect(page.getByRole('tab', { name: /Overview/i })).toBeVisible()
  })

  test('all five tabs are present', async ({ page }) => {
    await expect(page.getByRole('tab', { name: /Overview/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Tools & Allow-list/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Role Defaults/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Analytics/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Audit/i })).toBeVisible()
  })

  test('Tools tab loads allow-list UI', async ({ page }) => {
    await page.getByRole('tab', { name: /Tools & Allow-list/i }).click()
    await expect(page.getByText(/allow|tool/i).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('Audit tab renders table shell', async ({ page }) => {
    await page.getByRole('tab', { name: /Audit/i }).click()
    await expect(page.getByRole('table').or(page.getByText(/audit|log/i).first())).toBeVisible({
      timeout: 15_000,
    })
  })
})

// Created and developed by Jai Singh
