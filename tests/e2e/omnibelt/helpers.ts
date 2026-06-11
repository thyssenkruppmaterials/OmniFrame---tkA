// Created and developed by Jai Singh
import type { Page } from 'playwright/test'
import { expect } from 'playwright/test'

const MOD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control'

type OmnibeltTestHook = {
  setCollapseState: (v: 'orb' | 'pill' | 'panel' | 'nub') => void
  setSkin: (v: 'pill' | 'orb' | 'skystrip') => void
  setUserHidden: (v: boolean) => void
  setActiveJobs: (jobs: unknown[]) => void
  getState: () => Record<string, unknown>
}

/** Default goto — clears `userHidden` but does NOT touch `skin` /
 *  `collapseState`. Tests that need a specific skin/state should call
 *  `driveState(...)` after `gotoAuthenticated(...)`. */
export async function ensureOmnibeltVisible(page: Page) {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('omniframe.omnibelt.') && key.endsWith('.v1')) {
        try {
          const raw = localStorage.getItem(key)
          if (!raw) continue
          const parsed = JSON.parse(raw) as {
            state?: { userHidden?: boolean }
          }
          if (!parsed.state) continue
          if (parsed.state.userHidden) {
            parsed.state.userHidden = false
            localStorage.setItem(key, JSON.stringify(parsed))
          }
        } catch {
          /* ignore */
        }
      }
    }
  })
}

/** Aggressively clear ALL OmniBelt persisted state (including userHidden).
 *  Use at the start of each test to guarantee a clean baseline. */
export async function resetOmnibeltState(page: Page) {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('omniframe.omnibelt.') && key.endsWith('.v1')) {
        localStorage.removeItem(key)
      }
    }
  })
}

async function waitForHook(page: Page) {
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __ONEBOX_omnibelt?: OmnibeltTestHook })
          .__ONEBOX_omnibelt
      ),
    null,
    { timeout: 30_000 }
  )
}

export async function driveState(
  page: Page,
  patch: Partial<{
    collapseState: 'orb' | 'pill' | 'panel' | 'nub'
    skin: 'pill' | 'orb' | 'skystrip'
    userHidden: boolean
  }>
) {
  await waitForHook(page)
  await page.evaluate((p) => {
    const hook = (window as unknown as { __ONEBOX_omnibelt: OmnibeltTestHook })
      .__ONEBOX_omnibelt
    if (p.skin !== undefined) hook.setSkin(p.skin)
    if (p.collapseState !== undefined) hook.setCollapseState(p.collapseState)
    if (p.userHidden !== undefined) hook.setUserHidden(p.userHidden)
  }, patch)
}

export async function expandToPill(page: Page) {
  await driveState(page, { skin: 'pill', collapseState: 'pill' })
  await expect(page.getByTestId('omnibelt-pill')).toBeVisible({ timeout: 15_000 })
}

/** Open the shared panel via the store hook so tests don't depend on Cmd+B. */
export async function openOmnibeltPanel(page: Page) {
  await driveState(page, { skin: 'pill', collapseState: 'panel' })
  await expect(page.getByTestId('omnibelt-panel')).toBeVisible({ timeout: 15_000 })
}

export async function closeOmnibeltPanel(page: Page) {
  const closeBtn = page.getByRole('button', { name: 'Close OmniBelt panel' })
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click()
    await expect(page.getByTestId('omnibelt-panel')).toBeHidden()
    return
  }
  await driveState(page, { collapseState: 'pill' })
  await expect(page.getByTestId('omnibelt-panel')).toBeHidden()
}

export async function openPanelMenu(page: Page) {
  await openOmnibeltPanel(page)
  await page.getByTestId('omnibelt-panel-menu-trigger').click()
  await expect(page.getByTestId('omnibelt-panel-menu')).toBeVisible()
}

export async function selectSkin(
  page: Page,
  skin: 'pill' | 'orb' | 'skystrip'
) {
  await openPanelMenu(page)
  await page.getByTestId(`omnibelt-skin-option-${skin}`).click()
  await expect(page.getByTestId('omnibelt-panel-menu')).toBeHidden()
}

export async function gotoAuthenticated(page: Page, path: string) {
  await ensureOmnibeltVisible(page)
  await page.goto(path)
  await page.waitForLoadState('domcontentloaded')
  // OmniBelt mounts after auth resolves and the visibility gate passes —
  // wait on the test hook (host has mounted + store inited). Throw if it
  // doesn't appear so callers see a clear failure rather than racing.
  await waitForHook(page)
}

export { MOD_KEY }

// Created and developed by Jai Singh
