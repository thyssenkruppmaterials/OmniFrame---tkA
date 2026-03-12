import { useRef } from 'react'
import { Check, Moon, Sun, Monitor, Palette } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme, type ThemeMode } from '@/context/theme-context'
import { useAnimatedThemeTransition } from '@/components/ui/animated-theme-toggler'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ThemeSwitch() {
  const { theme } = useTheme()
  const { transitionTo } = useAnimatedThemeTransition()
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleThemeChange = (newTheme: ThemeMode) => {
    transitionTo(newTheme, buttonRef)
  }

  const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'custom', label: 'Custom', icon: Palette },
  ]

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={buttonRef}
          variant='ghost'
          size='icon'
          className='scale-95 rounded-full'
        >
          <Sun className='size-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90' />
          <Moon className='absolute size-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0' />
          <span className='sr-only'>Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => handleThemeChange(value)}
            className='flex items-center gap-2'
          >
            <Icon size={14} />
            {label}
            <Check
              size={14}
              className={cn('ml-auto', theme !== value && 'hidden')}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
