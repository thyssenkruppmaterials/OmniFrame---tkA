// Created and developed by Jai Singh
/**
 * PropertiesPanel — typing safety regression tests
 *
 * The critical bug these guard against:
 *
 * The builder rebuilds the local `sections` array (and therefore the
 * `item` reference passed into PropertiesPanel) every time TanStack Query
 * refetches `standard-work-items` after a debounced field save. If
 * PropertiesPanel reset its local editor state whenever the `item` prop
 * reference changed, the user would lose keystrokes typed during the
 * network round-trip.
 *
 * The fix is to sync local state from props ONLY when the item id changes
 * (i.e. a different item was selected). These tests pin that behaviour.
 */
import { useState } from 'react'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StandardWorkItem } from '@/hooks/use-standard-work'
import { PropertiesPanel } from '../properties-panel'

function makeItem(overrides: Partial<StandardWorkItem> = {}): StandardWorkItem {
  return {
    id: 'item-1',
    organization_id: 'org-1',
    template_id: 'tmpl-1',
    item_title: 'Original title',
    item_type: 'text',
    section_name: undefined,
    display_order: 0,
    is_required: false,
    validation_rules: {},
    options: [],
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('PropertiesPanel', () => {
  it('renders an empty hint when no item is selected', () => {
    render(
      <PropertiesPanel item={null} onItemChange={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText(/Select an item to edit/i)).toBeInTheDocument()
  })

  it('does NOT reset local title when the parent passes a fresh item reference with the same id', () => {
    // Simulates the refetch storm: the parent passes a brand-new object
    // reference for the same item id while the user is mid-keystroke.
    function Harness() {
      const [bump, setBump] = useState(0)
      const item = makeItem({ item_title: 'Original title' })
      return (
        <div>
          <button
            type='button'
            data-testid='simulate-refetch'
            onClick={() => setBump((b) => b + 1)}
          >
            refetch {bump}
          </button>
          <PropertiesPanel
            // Same id, brand new object reference on every render.
            item={{ ...item }}
            onItemChange={vi.fn()}
            onClose={vi.fn()}
          />
        </div>
      )
    }

    render(<Harness />)

    const titleInput = screen.getByLabelText(/Title/i) as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: 'Hello' } })
    expect(titleInput.value).toBe('Hello')

    // Trigger a parent re-render with a fresh `item` object reference --
    // mirrors what happens after a TanStack Query refetch.
    fireEvent.click(screen.getByTestId('simulate-refetch'))
    expect(titleInput.value).toBe('Hello')

    // Type more characters AFTER the simulated refetch -- prior to the
    // fix this would lose the existing 'Hello' as the useEffect reset
    // localItem to the server value.
    fireEvent.change(titleInput, { target: { value: 'Hello World' } })
    expect(titleInput.value).toBe('Hello World')

    // Yet another simulated refetch — local edits must persist.
    fireEvent.click(screen.getByTestId('simulate-refetch'))
    expect(titleInput.value).toBe('Hello World')
  })

  it('DOES reset local state when the item id changes (different item selected)', () => {
    function Harness() {
      const [id, setId] = useState('item-1')
      const item = makeItem({
        id,
        item_title: id === 'item-1' ? 'First item' : 'Second item',
      })
      return (
        <div>
          <button
            type='button'
            data-testid='switch'
            onClick={() => setId(id === 'item-1' ? 'item-2' : 'item-1')}
          >
            switch
          </button>
          <PropertiesPanel
            item={item}
            onItemChange={vi.fn()}
            onClose={vi.fn()}
          />
        </div>
      )
    }

    render(<Harness />)

    const titleInput = screen.getByLabelText(/Title/i) as HTMLInputElement
    expect(titleInput.value).toBe('First item')

    fireEvent.click(screen.getByTestId('switch'))
    expect(titleInput.value).toBe('Second item')

    fireEvent.click(screen.getByTestId('switch'))
    expect(titleInput.value).toBe('First item')
  })

  it('preserves existing option keys when only labels change', () => {
    const onItemChange = vi.fn()
    const item = makeItem({
      item_type: 'select',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    })
    render(
      <PropertiesPanel
        item={item}
        onItemChange={onItemChange}
        onClose={vi.fn()}
      />
    )

    const optionsTextarea = screen.getByLabelText(
      /Options/i
    ) as HTMLTextAreaElement
    expect(optionsTextarea.value).toBe('Yes\nNo')

    fireEvent.change(optionsTextarea, {
      target: { value: 'Yes\nNo\nMaybe' },
    })

    const calls = onItemChange.mock.calls
    const lastCall = calls[calls.length - 1]?.[0] as StandardWorkItem
    expect(lastCall.options).toEqual([
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'maybe', label: 'Maybe' },
    ])
  })

  it('drops min from validation_rules when the user clears the field', () => {
    const onItemChange = vi.fn()
    const item = makeItem({
      item_type: 'number',
      validation_rules: { min: 5, max: 10 },
    })
    render(
      <PropertiesPanel
        item={item}
        onItemChange={onItemChange}
        onClose={vi.fn()}
      />
    )

    const minInput = screen.getByLabelText(/Min Value/i) as HTMLInputElement
    expect(minInput.value).toBe('5')
    fireEvent.change(minInput, { target: { value: '' } })

    const calls = onItemChange.mock.calls
    const lastCall = calls[calls.length - 1]?.[0] as StandardWorkItem
    expect(lastCall.validation_rules).toEqual({ max: 10 })
    expect('min' in (lastCall.validation_rules ?? {})).toBe(false)
  })

  it('accepts 0 as a legitimate min value', () => {
    const onItemChange = vi.fn()
    const item = makeItem({
      item_type: 'number',
      validation_rules: {},
    })
    render(
      <PropertiesPanel
        item={item}
        onItemChange={onItemChange}
        onClose={vi.fn()}
      />
    )

    const minInput = screen.getByLabelText(/Min Value/i) as HTMLInputElement
    fireEvent.change(minInput, { target: { value: '0' } })

    const calls = onItemChange.mock.calls
    const lastCall = calls[calls.length - 1]?.[0] as StandardWorkItem
    expect(lastCall.validation_rules).toEqual({ min: 0 })
  })

  it('shows a validation hint when the title is empty', () => {
    render(
      <PropertiesPanel
        item={makeItem({ item_title: '' })}
        onItemChange={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/title is required/i)
  })
})

// Created and developed by Jai Singh
