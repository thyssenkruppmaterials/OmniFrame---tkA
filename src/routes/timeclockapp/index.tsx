import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { timeclockPWAManager } from '@/lib/pwa/timeclock-pwa-manager'
import TimeClockKiosk from '@/features/hr/time-clock-kiosk/time-clock-kiosk'

function TimeclockPage() {
  useEffect(() => {
    timeclockPWAManager.initialize()
    return () => {
      timeclockPWAManager.cleanup()
    }
  }, [])

  return <TimeClockKiosk />
}

export const Route = createFileRoute('/timeclockapp/')({
  component: TimeclockPage,
})
// Developer and Creator: Jai Singh
