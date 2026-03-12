/**
 * Idle Detection Service
 * Monitors user activity (mouse, keyboard, touch) and detects idle state.
 * Used to auto-set presence to "away" after inactivity.
 */

type IdleCallback = (isIdle: boolean) => void

export class IdleDetector {
  private idleTimeout: number
  private tabHiddenTimeout: number
  private isIdle = false
  private isTabHidden = false
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private tabHiddenTimer: ReturnType<typeof setTimeout> | null = null
  private callback: IdleCallback
  private boundHandleActivity: () => void
  private boundHandleVisibility: () => void
  private destroyed = false

  constructor(
    callback: IdleCallback,
    idleTimeout: number,
    tabHiddenTimeout: number
  ) {
    this.callback = callback
    this.idleTimeout = idleTimeout
    this.tabHiddenTimeout = tabHiddenTimeout
    this.boundHandleActivity = this.handleActivity.bind(this)
    this.boundHandleVisibility = this.handleVisibility.bind(this)
  }

  start(): void {
    if (this.destroyed) return

    // Activity events
    const events = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ]
    events.forEach((event) => {
      window.addEventListener(event, this.boundHandleActivity, {
        passive: true,
      })
    })

    // Visibility change
    document.addEventListener('visibilitychange', this.boundHandleVisibility)

    // Start idle timer
    this.resetIdleTimer()
  }

  stop(): void {
    this.destroyed = true

    const events = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ]
    events.forEach((event) => {
      window.removeEventListener(event, this.boundHandleActivity)
    })

    document.removeEventListener('visibilitychange', this.boundHandleVisibility)

    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.tabHiddenTimer) {
      clearTimeout(this.tabHiddenTimer)
      this.tabHiddenTimer = null
    }
  }

  getIsIdle(): boolean {
    return this.isIdle || this.isTabHidden
  }

  private handleActivity(): void {
    if (this.destroyed) return

    const wasIdle = this.isIdle
    this.isIdle = false

    if (wasIdle) {
      this.callback(false)
    }

    this.resetIdleTimer()
  }

  private handleVisibility(): void {
    if (this.destroyed) return

    if (document.hidden) {
      // Tab went hidden - start timer
      this.tabHiddenTimer = setTimeout(() => {
        if (this.destroyed) return
        this.isTabHidden = true
        this.callback(true)
      }, this.tabHiddenTimeout)
    } else {
      // Tab became visible - cancel hidden timer and mark active
      if (this.tabHiddenTimer) {
        clearTimeout(this.tabHiddenTimer)
        this.tabHiddenTimer = null
      }

      if (this.isTabHidden) {
        this.isTabHidden = false
        this.isIdle = false
        this.callback(false)
        this.resetIdleTimer()
      }
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }

    this.idleTimer = setTimeout(() => {
      if (this.destroyed) return
      this.isIdle = true
      this.callback(true)
    }, this.idleTimeout)
  }
}
