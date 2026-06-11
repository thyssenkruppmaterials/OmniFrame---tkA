// Created and developed by Jai Singh
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'

function renderDialog(size: 'sm' | 'md' | 'lg' | 'xl' | 'full' = 'md') {
  return render(
    <ResponsiveDialog open size={size}>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>Test title</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          Test description
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody>
        <p data-testid='body-content'>Body content</p>
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter>
        <button>Save</button>
      </ResponsiveDialogFooter>
    </ResponsiveDialog>
  )
}

describe('ResponsiveDialog', () => {
  it('renders title, body, and footer in the portal', () => {
    renderDialog()
    expect(screen.getByText('Test title')).toBeInTheDocument()
    expect(screen.getByTestId('body-content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('marks the body as the scrollport with min-h-0 + overflow-y-auto', () => {
    renderDialog()
    const body = document.querySelector('[data-slot="responsive-dialog-body"]')
    expect(body).not.toBeNull()
    expect(body?.className).toContain('min-h-0')
    expect(body?.className).toContain('min-w-0')
    expect(body?.className).toContain('flex-1')
    expect(body?.className).toContain('overflow-y-auto')
  })

  it('marks header and footer as shrink-0 so they do not scroll', () => {
    renderDialog()
    const header = document.querySelector(
      '[data-slot="responsive-dialog-header"]'
    )
    const footer = document.querySelector(
      '[data-slot="responsive-dialog-footer"]'
    )
    expect(header?.className).toContain('shrink-0')
    expect(footer?.className).toContain('shrink-0')
  })

  it('applies the xl size token (1280 max width) and clips overflow', () => {
    renderDialog('xl')
    const content = document.querySelector(
      '[data-slot="responsive-dialog-content"]'
    )
    expect(content).not.toBeNull()
    expect(content).toHaveAttribute('data-size', 'xl')
    expect(content?.className).toContain('w-[min(100vw-2rem,1280px)]')
    expect(content?.className).toContain('max-h-[90vh]')
    expect(content?.className).toContain('overflow-hidden')
    expect(content?.className).toContain('flex')
    expect(content?.className).toContain('flex-col')
  })

  it('uses the md size token (640 max width) by default', () => {
    renderDialog()
    const content = document.querySelector(
      '[data-slot="responsive-dialog-content"]'
    )
    expect(content).toHaveAttribute('data-size', 'md')
    expect(content?.className).toContain('w-[min(100vw-2rem,640px)]')
  })
})

// Created and developed by Jai Singh
