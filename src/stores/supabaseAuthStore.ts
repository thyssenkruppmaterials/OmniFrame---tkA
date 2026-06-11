// Created and developed by Jai Singh
import type { User } from '@supabase/supabase-js'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { supabase } from '@/lib/supabase/client'
import type { AuthState, AuthUser, UserProfile } from '@/lib/supabase/types'
import { logger } from '@/lib/utils/logger'

export const useSupabaseAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      session: null,
      profile: null,
      isLoading: true,
      isAuthenticated: false,

      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setSession: (session) => set({ session }),
      setProfile: (profile) => set({ profile }),
      setLoading: (isLoading) => set({ isLoading }),

      signIn: async (email, password) => {
        set({ isLoading: true })
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) throw error

        set({
          user: data.user,
          session: data.session,
          isAuthenticated: true,
        })

        await get().fetchProfile()
        set({ isLoading: false })
      },

      signUp: async (email, password, metadata = {}) => {
        set({ isLoading: true })
        const { getAppUrl } = await import('@/lib/utils/app-url')
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: metadata,
            emailRedirectTo: `${getAppUrl()}/auth/callback`,
          },
        })

        if (error) throw error

        set({
          user: data.user,
          session: data.session,
          isAuthenticated: !!data.session,
        })

        // Profile creation is handled automatically by database trigger 'on_auth_user_created'
        // The handle_new_user() function creates the user_profiles record automatically
        // No manual intervention needed - the trigger uses metadata from auth.users.raw_user_meta_data

        if (data.session) {
          await get().fetchProfile()
        }

        set({ isLoading: false })
      },

      signOut: async () => {
        set({ isLoading: true })

        try {
          // Clear Supabase session
          await supabase.auth.signOut()

          // Clear all auth state immediately
          set({
            user: null,
            session: null,
            profile: null,
            isAuthenticated: false,
            isLoading: false,
          })

          // Clear any cached user data from localStorage
          localStorage.removeItem('supabase-auth-store')

          logger.log('User successfully logged out')
        } catch (error) {
          logger.error('Error during logout:', error)
          // Even if there's an error, clear local state to ensure user is logged out
          set({
            user: null,
            session: null,
            profile: null,
            isAuthenticated: false,
            isLoading: false,
          })
        }
      },

      resetPassword: async (email) => {
        const { getAppUrl } = await import('@/lib/utils/app-url')
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${getAppUrl()}/auth/reset-password`,
        })
        if (error) throw error
      },

      updatePassword: async (newPassword) => {
        const { error } = await supabase.auth.updateUser({
          password: newPassword,
        })
        if (error) throw error
      },

      signInWithProvider: async (provider) => {
        const { getAppUrl } = await import('@/lib/utils/app-url')
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: `${getAppUrl()}/auth/callback`,
          },
        })
        if (error) throw error
      },

      fetchProfile: async () => {
        const { user } = get()
        if (!user) return

        try {
          // The profile should exist due to the handle_new_user trigger
          // Retry a few times to allow for trigger completion
          let retryCount = 0
          let profile = null

          while (retryCount < 3) {
            const { data, error } = await supabase
              .from('user_profiles')
              .select('*')
              .eq('id', user.id)
              .single()

            if (!error && data) {
              profile = data as UserProfile
              break
            } else if (error?.code === 'PGRST116') {
              // Profile not found, wait and retry
              await new Promise((resolve) => setTimeout(resolve, 500))
              retryCount++
            } else {
              throw error
            }
          }

          if (profile) {
            set({ profile })
          } else {
            logger.warn(
              'Profile not found after trigger execution, this indicates a database trigger issue'
            )
            // This should not happen if the trigger is working correctly
            throw new Error('User profile not created by database trigger')
          }
        } catch (error) {
          logger.error('Profile fetch error:', error)
          logger.error(
            'This indicates the handle_new_user trigger may not be working correctly'
          )
          throw error // Don't create fallback profiles - the trigger should handle this
        }
      },

      updateProfile: async (updates) => {
        const { user } = get()
        if (!user) throw new Error('No user logged in')

        const { data, error } = await supabase
          .from('user_profiles')
          .update(updates)
          .eq('id', user.id)
          .select()
          .single()

        if (error) throw error
        set({ profile: data as UserProfile })
      },

      refreshSession: async () => {
        const { data, error } = await supabase.auth.refreshSession()
        if (!error && data.session) {
          set({ session: data.session })
        }
      },

      checkSession: async () => {
        logger.log('checkSession called - setting loading true')
        set({ isLoading: true })
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession()

          if (session) {
            logger.log('Session found in checkSession:', session.user.email)
            set({
              user: session.user,
              session,
              isAuthenticated: true,
            })
            await get().fetchProfile()
          } else {
            logger.log('No session found in checkSession')
            // Clear auth state if no session
            set({
              user: null,
              session: null,
              profile: null,
              isAuthenticated: false,
            })
          }
        } catch (error) {
          logger.error('Session check error:', error)
          // Clear auth state on error
          set({
            user: null,
            session: null,
            profile: null,
            isAuthenticated: false,
          })
        } finally {
          logger.log('checkSession complete - setting loading false')
          set({ isLoading: false })
        }
      },

      // Legacy compatibility layer for existing codebase
      auth: {
        user: null,
        setUser: (authUser: AuthUser | null) => {
          // Convert AuthUser to User and update state
          if (authUser) {
            const mockUser = {
              id: authUser.id,
              email: authUser.email,
              aud: '',
              role: '',
              email_confirmed_at: '',
              phone_confirmed_at: '',
              created_at: '',
              updated_at: '',
              confirmation_sent_at: '',
              recovery_sent_at: '',
              email_change_sent_at: '',
              new_email: '',
              invited_at: '',
              action_link: '',
              email_change: '',
              phone_change: '',
              phone: '',
              confirmed_at: '',
              email_change_confirm_status: 0,
              phone_change_confirm_status: 0,
              banned_until: '',
              is_super_admin: false,
              app_metadata: {},
              user_metadata: {},
              factors: [],
              identities: [],
            } as User
            set({ user: mockUser, isAuthenticated: true })
          } else {
            set({ user: null, isAuthenticated: false })
          }
        },
        accessToken: '',
        setAccessToken: (token: string) => {
          // In Supabase, access tokens are managed automatically
          // This is for backward compatibility only
          set((state) => ({
            auth: { ...state.auth, accessToken: token },
          }))
        },
        resetAccessToken: () => {
          set((state) => ({
            auth: { ...state.auth, accessToken: '' },
          }))
        },
        reset: async () => {
          await get().signOut()
        },
      },
    }),
    {
      name: 'supabase-auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist profile data - let Supabase handle session persistence
        // This prevents conflicts between Zustand and Supabase storage
        profile: state.profile,
        // Explicitly exclude user, session, isLoading and isAuthenticated
        // - user/session will be restored from Supabase on app load
        // - isLoading should always start as true on app initialization
        // - isAuthenticated will be derived from session/user presence
      }),
    }
  )
)

// Export legacy compatibility
export const useAuthStore = create((_set) => {
  const supabaseStore = useSupabaseAuth.getState()

  return {
    auth: {
      user: supabaseStore.profile
        ? {
            accountNo: supabaseStore.profile.id,
            email: supabaseStore.profile.email,
            role: (supabaseStore.profile as any)?.roles?.name
              ? [(supabaseStore.profile as any).roles.name]
              : [],
            exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
          }
        : null,
      setUser: supabaseStore.auth.setUser,
      accessToken: supabaseStore.auth.accessToken,
      setAccessToken: supabaseStore.auth.setAccessToken,
      resetAccessToken: supabaseStore.auth.resetAccessToken,
      reset: supabaseStore.auth.reset,
    },
  }
})

// Helper hook for easier access
export const useAuth = () => {
  const { user, profile, isAuthenticated, isLoading } = useSupabaseAuth()

  // Create legacy-compatible auth object
  const legacyUser: AuthUser | null = profile
    ? {
        id: profile.id,
        email: profile.email,
        role: profile?.role ? [profile.role] : [],
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        profile,
      }
    : null

  return {
    user: legacyUser,
    profile,
    isAuthenticated,
    isLoading,
    supabaseUser: user,
  }
}

// Created and developed by Jai Singh
