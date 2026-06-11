// Created and developed by Jai Singh
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { test as setup, expect } from 'playwright/test'

const authFile = 'tests/e2e/.auth/user.json'

setup('authenticate admin', async ({ page }) => {
  const email = process.env.OMNIBELT_TEST_EMAIL
  const password = process.env.OMNIBELT_TEST_PASSWORD

  if (!email || !password) {
    setup.skip(
      true,
      'Set OMNIBELT_TEST_EMAIL and OMNIBELT_TEST_PASSWORD to run authenticated e2e tests'
    )
    return
  }

  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Login' }).click()

  await expect(page).not.toHaveURL(/sign-in/, { timeout: 30_000 })

  mkdirSync(dirname(authFile), { recursive: true })
  await page.context().storageState({ path: authFile })
})

// Created and developed by Jai Singh
