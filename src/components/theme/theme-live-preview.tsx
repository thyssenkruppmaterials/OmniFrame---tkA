// Created and developed by Jai Singh
import * as React from 'react'
import {
  computeDerivedTokens,
  type ThemeTokens,
} from '@/lib/theme/appearance-preferences'
import { cn } from '@/lib/utils'
import { hexToOklch } from '@/lib/utils/color-conversion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

const TOKEN_CSS_MAP: Record<keyof ThemeTokens, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  primary: '--primary',
  secondary: '--secondary',
  accent: '--accent',
  muted: '--muted',
  border: '--border',
  ring: '--ring',
  destructive: '--destructive',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
}

export interface ThemeLivePreviewProps {
  tokens: ThemeTokens
  mode: 'light' | 'dark'
  font?: string
  radius?: string
  className?: string
}

export function ThemeLivePreview({
  tokens,
  mode,
  font,
  radius,
  className,
}: ThemeLivePreviewProps) {
  const derived = computeDerivedTokens(tokens)

  const style = React.useMemo(() => {
    const vars: Record<string, string> = {}

    for (const [key, cssVar] of Object.entries(TOKEN_CSS_MAP)) {
      const value = tokens[key as keyof ThemeTokens]
      if (value) vars[cssVar] = hexToOklch(value)
    }

    for (const [key, value] of Object.entries(derived)) {
      vars[`--${key}`] = hexToOklch(value)
    }

    if (radius) vars['--radius'] = radius
    if (font) vars['fontFamily'] = font

    return vars as React.CSSProperties
  }, [tokens, derived, radius, font])

  return (
    <div
      aria-hidden='true'
      tabIndex={-1}
      role='presentation'
      className={cn('min-h-[320px] rounded-lg border p-6', mode, className)}
      style={style}
    >
      <div className='flex flex-col gap-6'>
        <Card className='py-4'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>Sample Card</CardTitle>
            <CardDescription>
              This card demonstrates background, foreground, and border tokens.
            </CardDescription>
          </CardHeader>
        </Card>

        <div className='flex flex-wrap gap-2'>
          <Button variant='default' size='sm' disabled tabIndex={-1}>
            Primary
          </Button>
          <Button variant='secondary' size='sm' disabled tabIndex={-1}>
            Secondary
          </Button>
          <Button variant='outline' size='sm' disabled tabIndex={-1}>
            Outline
          </Button>
          <Button variant='ghost' size='sm' disabled tabIndex={-1}>
            Ghost
          </Button>
          <Button variant='destructive' size='sm' disabled tabIndex={-1}>
            Destructive
          </Button>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='preview-input'>Sample input</Label>
          <Input
            id='preview-input'
            placeholder='Type here...'
            disabled
            tabIndex={-1}
          />
        </div>

        <div className='flex flex-wrap gap-2'>
          <Badge>Active</Badge>
          <Badge variant='secondary'>Pending</Badge>
          <Badge variant='destructive'>Error</Badge>
        </div>

        <Alert>
          <AlertDescription>
            Theme changes apply instantly in this preview.
          </AlertDescription>
        </Alert>

        <div className='flex gap-2'>
          <div
            className='size-6 shrink-0 rounded'
            style={{ backgroundColor: 'var(--chart-1)' }}
          />
          <div
            className='size-6 shrink-0 rounded'
            style={{ backgroundColor: 'var(--chart-2)' }}
          />
          <div
            className='size-6 shrink-0 rounded'
            style={{ backgroundColor: 'var(--chart-3)' }}
          />
          <div
            className='size-6 shrink-0 rounded'
            style={{ backgroundColor: 'var(--chart-4)' }}
          />
          <div
            className='size-6 shrink-0 rounded'
            style={{ backgroundColor: 'var(--chart-5)' }}
          />
        </div>

        <p className='text-muted-foreground text-sm'>
          Muted text sample for secondary content.
        </p>

        <div
          className='rounded-md border p-3'
          style={{
            backgroundColor: 'var(--sidebar)',
            color: 'var(--sidebar-foreground)',
            borderColor: 'var(--sidebar-border)',
          }}
        >
          <span className='text-sm font-medium'>Sidebar panel</span>
          <Separator className='my-2 opacity-50' />
          <p className='text-xs opacity-90'>
            Background and foreground preview.
          </p>
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
