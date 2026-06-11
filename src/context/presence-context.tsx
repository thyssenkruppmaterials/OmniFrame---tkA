// Created and developed by Jai Singh
/**
 * Presence Context Provider
 * Provides presence state to the entire app via React context.
 * Mount usePresenceTracker once here, consume with usePresence() anywhere.
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { PresenceContextType } from '@/lib/presence/types'
import { usePresenceTracker } from '@/hooks/use-presence-tracker'

const PresenceContext = createContext<PresenceContextType | null>(null)

export function PresenceProvider({ children }: { children: ReactNode }) {
  const presenceValue = usePresenceTracker()

  return (
    <PresenceContext.Provider value={presenceValue}>
      {children}
    </PresenceContext.Provider>
  )
}

/**
 * Hook to consume presence context from any component.
 * Must be used within PresenceProvider.
 */
export function usePresence(): PresenceContextType {
  const context = useContext(PresenceContext)
  if (!context) {
    throw new Error('usePresence must be used within a PresenceProvider')
  }
  return context
}

/**
 * Optional hook that returns null instead of throwing if outside provider.
 * Useful for components that may or may not be in a presence context.
 */
export function usePresenceOptional(): PresenceContextType | null {
  return useContext(PresenceContext)
}

// Created and developed by Jai Singh
