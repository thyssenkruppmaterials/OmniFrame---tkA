/**
 * Theme Testing Component
 *
 * Provides a visual testing interface for all theme tokens and custom theme functionality.
 * Use this component to verify theme consistency and color accessibility.
 *
 * Usage:
 * ```tsx
 * import { ThemeTest } from '@/lib/testing/theme-test'
 *
 * function DevTools() {
 *   return <ThemeTest />
 * }
 * ```
 */
import { useState } from 'react'
import { useTheme } from '@/context/theme-context'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

export function ThemeTest() {
  const { theme, setTheme, customColors, setCustomColors } = useTheme()
  const [testColors, setTestColors] = useState(customColors)

  const handleColorChange = (key: keyof typeof testColors, value: string) => {
    setTestColors((prev) => ({ ...prev, [key]: value }))
  }

  const applyCustomTheme = () => {
    setCustomColors(testColors)
    setTheme('custom')
  }

  return (
    <div className='mx-auto max-w-7xl space-y-8 p-8'>
      <div>
        <h1 className='mb-2 text-4xl font-bold'>Theme Testing Laboratory</h1>
        <p className='text-muted-foreground'>
          Test all theme tokens and verify OKLCH color conversion
        </p>
      </div>

      <Separator />

      {/* Current Theme Info */}
      <Card>
        <CardHeader>
          <CardTitle>Current Theme: {theme}</CardTitle>
          <CardDescription>
            {theme === 'custom'
              ? 'Using custom colors with OKLCH conversion'
              : 'Using standard theme colors'}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex gap-2'>
          <Button
            onClick={() => setTheme('light')}
            variant={theme === 'light' ? 'default' : 'outline'}
          >
            Light
          </Button>
          <Button
            onClick={() => setTheme('dark')}
            variant={theme === 'dark' ? 'default' : 'outline'}
          >
            Dark
          </Button>
          <Button
            onClick={() => setTheme('system')}
            variant={theme === 'system' ? 'default' : 'outline'}
          >
            System
          </Button>
          <Button
            onClick={() => setTheme('custom')}
            variant={theme === 'custom' ? 'default' : 'outline'}
          >
            Custom
          </Button>
        </CardContent>
      </Card>

      {/* Custom Theme Builder */}
      <Card>
        <CardHeader>
          <CardTitle>Custom Theme Builder</CardTitle>
          <CardDescription>
            Design your own theme. Colors will be converted to OKLCH for
            perceptual uniformity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4'>
            {Object.entries(testColors).map(([key, value]) => (
              <div key={key} className='space-y-2'>
                <Label htmlFor={key} className='capitalize'>
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </Label>
                <div className='flex items-center gap-2'>
                  <Input
                    id={key}
                    type='color'
                    value={value}
                    onChange={(e) =>
                      handleColorChange(
                        key as keyof typeof testColors,
                        e.target.value
                      )
                    }
                    className='h-10 w-16 cursor-pointer'
                  />
                  <Input
                    type='text'
                    value={value}
                    onChange={(e) =>
                      handleColorChange(
                        key as keyof typeof testColors,
                        e.target.value
                      )
                    }
                    className='flex-1 font-mono text-sm'
                    placeholder='#000000'
                  />
                </div>
              </div>
            ))}
          </div>
          <Button onClick={applyCustomTheme} className='mt-6 w-full'>
            Apply Custom Theme (with OKLCH Conversion)
          </Button>
        </CardContent>
      </Card>

      {/* Color Tokens Grid */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
        {/* Background & Foreground */}
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Background</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='bg-background text-foreground rounded border p-4'>
              Background with Foreground text
            </div>
          </CardContent>
        </Card>

        {/* Primary */}
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Primary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='bg-primary text-primary-foreground rounded p-4'>
              Primary with Primary Foreground
            </div>
          </CardContent>
        </Card>

        {/* Secondary */}
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Secondary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='bg-secondary text-secondary-foreground rounded p-4'>
              Secondary with Secondary Foreground
            </div>
          </CardContent>
        </Card>

        {/* Muted */}
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Muted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='bg-muted text-muted-foreground rounded p-4'>
              Muted with Muted Foreground
            </div>
          </CardContent>
        </Card>

        {/* Accent */}
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Accent</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='bg-accent text-accent-foreground rounded p-4'>
              Accent with Accent Foreground
            </div>
          </CardContent>
        </Card>

        {/* Destructive */}
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Destructive</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='bg-destructive rounded p-4 text-white'>
              Destructive (Danger/Error)
            </div>
          </CardContent>
        </Card>

        {/* Card */}
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Card</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='bg-card text-card-foreground rounded border p-4'>
              Card with Card Foreground
            </div>
          </CardContent>
        </Card>

        {/* Popover */}
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Popover</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='bg-popover text-popover-foreground rounded border p-4 shadow-lg'>
              Popover with Popover Foreground
            </div>
          </CardContent>
        </Card>

        {/* Border & Input */}
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Border & Input</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            <div className='border-border rounded border-2 p-2'>
              Border Token
            </div>
            <Input placeholder='Input with border and ring' />
          </CardContent>
        </Card>
      </div>

      {/* Component Examples */}
      <Card>
        <CardHeader>
          <CardTitle>Component Examples</CardTitle>
          <CardDescription>
            Verify components work correctly with current theme
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex flex-wrap gap-2'>
            <Button>Default Button</Button>
            <Button variant='secondary'>Secondary</Button>
            <Button variant='outline'>Outline</Button>
            <Button variant='ghost'>Ghost</Button>
            <Button variant='destructive'>Destructive</Button>
            <Button variant='link'>Link</Button>
          </div>

          <div className='space-y-2'>
            <Input placeholder='Text input field' />
            <Input type='email' placeholder='Email input' />
          </div>
        </CardContent>
      </Card>

      {/* Technical Info */}
      <Card>
        <CardHeader>
          <CardTitle>Technical Information</CardTitle>
          <CardDescription>Theme implementation details</CardDescription>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          <p>
            <strong>Color Space:</strong> OKLCH (Oklab with Lightness, Chroma,
            Hue)
          </p>
          <p>
            <strong>Benefits:</strong> Perceptually uniform colors, consistent
            brightness across hues
          </p>
          <p>
            <strong>Custom Theme:</strong> Hex colors converted to OKLCH
            automatically
          </p>
          <p>
            <strong>Theme Mode:</strong> {theme}
          </p>
          {theme === 'custom' && (
            <div className='bg-muted mt-4 rounded-lg p-4'>
              <p className='mb-2 font-semibold'>Active Custom Colors:</p>
              <pre className='overflow-x-auto font-mono text-xs'>
                {JSON.stringify(customColors, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default ThemeTest
