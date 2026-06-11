// Created and developed by Jai Singh
'use client'

import { useCallback, useRef } from 'react'
import { Moon, Sun } from 'lucide-react'
import { flushSync } from 'react-dom'
import { cn } from '@/lib/utils'
import { useTheme, type ThemeMode } from '@/context/theme-context'

interface AnimatedThemeTogglerProps extends React.ComponentPropsWithoutRef<'button'> {
  duration?: number
  targetTheme?: ThemeMode
  onThemeChange?: (theme: ThemeMode) => void
}

export const AnimatedThemeToggler = ({
  className,
  duration = 400,
  targetTheme,
  onThemeChange,
  ...props
}: AnimatedThemeTogglerProps) => {
  const { setTheme, resolvedTheme } = useTheme()
  const buttonRef = useRef<HTMLButtonElement>(null)

  const isDark = resolvedTheme === 'dark'

  const toggleTheme = useCallback(
    async (newTheme?: ThemeMode) => {
      if (!buttonRef.current) return

      const themeToSet = newTheme ?? targetTheme ?? (isDark ? 'light' : 'dark')

      if (!document.startViewTransition) {
        setTheme(themeToSet)
        onThemeChange?.(themeToSet)
        return
      }

      await document.startViewTransition(() => {
        flushSync(() => {
          setTheme(themeToSet)
          onThemeChange?.(themeToSet)
        })
      }).ready

      const { top, left, width, height } =
        buttonRef.current.getBoundingClientRect()
      const x = left + width / 2
      const y = top + height / 2
      const maxRadius = Math.hypot(
        Math.max(left, window.innerWidth - left),
        Math.max(top, window.innerHeight - top)
      )

      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${maxRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration,
          easing: 'ease-in-out',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    },
    [isDark, duration, targetTheme, setTheme, onThemeChange]
  )

  return (
    <button
      ref={buttonRef}
      onClick={() => toggleTheme()}
      className={cn(className)}
      {...props}
    >
      {isDark ? (
        <Sun className='size-[1.2rem]' />
      ) : (
        <Moon className='size-[1.2rem]' />
      )}
      <span className='sr-only'>Toggle theme</span>
    </button>
  )
}

export function useAnimatedThemeTransition() {
  const { setTheme } = useTheme()

  const transitionTo = useCallback(
    async (
      targetTheme: ThemeMode,
      buttonRef?: React.RefObject<HTMLButtonElement | null>,
      duration: number = 400
    ) => {
      if (!document.startViewTransition) {
        setTheme(targetTheme)
        return
      }

      await document.startViewTransition(() => {
        flushSync(() => {
          setTheme(targetTheme)
        })
      }).ready

      if (buttonRef?.current) {
        const { top, left, width, height } =
          buttonRef.current.getBoundingClientRect()
        const x = left + width / 2
        const y = top + height / 2
        const maxRadius = Math.hypot(
          Math.max(left, window.innerWidth - left),
          Math.max(top, window.innerHeight - top)
        )

        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${maxRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration,
            easing: 'ease-in-out',
            pseudoElement: '::view-transition-new(root)',
          }
        )
      }
    },
    [setTheme]
  )

  return { transitionTo }
}

// Created and developed by Jai Singh
