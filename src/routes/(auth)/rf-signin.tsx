// Created and developed by Jai Singh
import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { rfPWAManager } from '@/lib/pwa/rf-pwa-manager'
import RFSignIn from '@/features/rf-interface/rf-signin'

// RF Sign-In component with PWA initialization
function RFSignInWithPWA() {
  useEffect(() => {
    // Initialize PWA for RF sign-in
    rfPWAManager.initializeRFPWA()

    // Cleanup PWA when component unmounts
    return () => {
      rfPWAManager.cleanup()
    }
  }, [])

  return <RFSignIn />
}

export const Route = createFileRoute('/(auth)/rf-signin')({
  component: RFSignInWithPWA,
})

// Created and developed by Jai Singh
