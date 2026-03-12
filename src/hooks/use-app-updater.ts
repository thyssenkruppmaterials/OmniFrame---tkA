/**
 * useAppUpdater - React Hook for Application Update State
 *
 * Bridges the vanilla-JS AutoUpdater/VersionChecker services with React state.
 * Listens for DOM events emitted by those services and exposes reactive state
 * and actions for the AppUpdateBanner component.
 *
 * Usage:
 *   const { updateAvailable, buildInfo, updateNow, dismiss } = useAppUpdater()
 *
 * @module use-app-updater
 */
import { useState, useEffect, useCallback } from 'react'
import {
  SHOW_UPDATE_BANNER_EVENT,
  BEFORE_RELOAD_EVENT,
  autoUpdater,
} from '@/lib/version/auto-updater'
import {
  VERSION_UPDATE_EVENT,
  type BuildInfo,
  type VersionMismatchDetail,
} from '@/lib/version/version-checker'

export interface UseAppUpdaterReturn {
  /** Whether an update is available and the banner should be shown */
  updateAvailable: boolean
  /** The deployed build info (null until an update is detected) */
  buildInfo: BuildInfo | null
  /** The current running build hash */
  currentHash: string
  /** The deployed build hash */
  deployedHash: string | null
  /** Whether a reload is in progress */
  isReloading: boolean
  /** Trigger a graceful reload immediately */
  updateNow: () => void
  /** Dismiss the banner (update still happens on next navigation or idle) */
  dismiss: () => void
}

export function useAppUpdater(): UseAppUpdaterReturn {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null)
  const [deployedHash, setDeployedHash] = useState<string | null>(null)
  const [isReloading, setIsReloading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const currentHash =
    typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev'

  useEffect(() => {
    // Handler for when the banner should be shown
    const handleShowBanner = (e: Event) => {
      const detail = (e as CustomEvent<VersionMismatchDetail>).detail
      if (detail) {
        setBuildInfo(detail.buildInfo)
        setDeployedHash(detail.deployedHash)
      }
      setUpdateAvailable(true)
      setDismissed(false) // Reset dismissal on new update
    }

    // Handler for the raw update event (backup in case banner event is missed)
    const handleUpdateAvailable = (e: Event) => {
      const detail = (e as CustomEvent<VersionMismatchDetail>).detail
      if (detail) {
        setBuildInfo(detail.buildInfo)
        setDeployedHash(detail.deployedHash)
      }
    }

    // Handler for before-reload (to show loading state)
    const handleBeforeReload = () => {
      setIsReloading(true)
    }

    window.addEventListener(SHOW_UPDATE_BANNER_EVENT, handleShowBanner)
    window.addEventListener(VERSION_UPDATE_EVENT, handleUpdateAvailable)
    window.addEventListener(BEFORE_RELOAD_EVENT, handleBeforeReload)

    // Check if auto-updater already has a pending update (e.g., hook mounted late)
    if (autoUpdater.pendingUpdate && autoUpdater.mismatchDetail) {
      setBuildInfo(autoUpdater.mismatchDetail.buildInfo)
      setDeployedHash(autoUpdater.mismatchDetail.deployedHash)
      setUpdateAvailable(true)
    }

    return () => {
      window.removeEventListener(SHOW_UPDATE_BANNER_EVENT, handleShowBanner)
      window.removeEventListener(VERSION_UPDATE_EVENT, handleUpdateAvailable)
      window.removeEventListener(BEFORE_RELOAD_EVENT, handleBeforeReload)
    }
  }, [])

  const updateNow = useCallback(() => {
    autoUpdater.performGracefulReload()
  }, [])

  const dismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  return {
    updateAvailable: updateAvailable && !dismissed,
    buildInfo,
    currentHash,
    deployedHash,
    isReloading,
    updateNow,
    dismiss,
  }
}
