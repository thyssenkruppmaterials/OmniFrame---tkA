// Created and developed by Jai Singh
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RFStepPartNumberVerification } from '../rf-step-part-number-verification'
import type { StepProps } from '../types'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

function baseProps(overrides?: Partial<StepProps>): StepProps {
  return {
    step: {
      id: 's1',
      type: 'part_number_verification',
      label: 'Scan Part',
      required: true,
      order: 3,
      config: {},
    },
    taskData: {
      count_number: 'CC-1',
      material_number: 'PART-ABC-123',
      material_description: null,
      location: 'A1-01',
      warehouse: null,
      unit_of_measure: 'EA',
      system_quantity: 10,
      counted_quantity: null,
      count_type: 'part_verification',
      priority: 'normal',
    },
    stepResult: {},
    onComplete: vi.fn(),
    onBack: vi.fn(),
    isProcessing: false,
    ...overrides,
  }
}

describe('RFStepPartNumberVerification — match flow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders expected part + location', () => {
    render(<RFStepPartNumberVerification {...baseProps()} />)
    expect(screen.getByText('PART-ABC-123')).toBeDefined()
    expect(screen.getByText('A1-01')).toBeDefined()
  })

  it('match auto-completes without asking for quantity', () => {
    const onComplete = vi.fn()
    render(<RFStepPartNumberVerification {...baseProps({ onComplete })} />)
    const input = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input, { target: { value: 'PART-ABC-123' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText(/Part Matches/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Complete Count/i }))
    expect(onComplete).toHaveBeenCalledTimes(1)
    const payload = onComplete.mock.calls[0][0]
    expect(payload.match).toBe(true)
    expect(payload.shouldComplete).toBe(true)
    expect(payload.scannedParts).toHaveLength(1)
    expect(payload.scannedParts[0].quantity).toBe(10)
  })

  it('treats comparison as case-insensitive', () => {
    render(<RFStepPartNumberVerification {...baseProps()} />)
    const input = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input, { target: { value: 'part-abc-123' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText(/Part Matches/i)).toBeDefined()
  })
})

describe('RFStepPartNumberVerification — find-another-part after match', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows Find Another Part button on the match card', () => {
    render(<RFStepPartNumberVerification {...baseProps()} />)
    const input = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input, { target: { value: 'PART-ABC-123' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(
      screen.getByRole('button', { name: /Find Another Part/i })
    ).toBeDefined()
  })

  it('lets operator record matched part + extra wrong parts → variance', () => {
    const onComplete = vi.fn()
    render(<RFStepPartNumberVerification {...baseProps({ onComplete })} />)

    // Scan expected → match card.
    const input = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input, { target: { value: 'PART-ABC-123' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Tap "Find Another Part" — routes to qty capture with matched value
    // preserved and qty pre-filled to system_quantity (10).
    fireEvent.click(screen.getByRole('button', { name: /Find Another Part/i }))
    // Status card should now read "Expected Part Found" (green qty card).
    expect(screen.getByText(/Expected Part Found/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Record This Part/i }))

    // Back at list phase with 1 part; it's the matched one, so should
    // read "1 part recorded" (no variance yet).
    expect(screen.getByText(/1 part recorded/i)).toBeDefined()

    // Add another part — a wrong one this time.
    fireEvent.click(screen.getByRole('button', { name: /Add Another Part/i }))
    const input2 = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input2, { target: { value: 'WRONG-EXTRA' } })
    fireEvent.keyDown(input2, { key: 'Enter' })
    expect(screen.getByText(/Wrong Part at Location/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    fireEvent.click(screen.getByRole('button', { name: /Record This Part/i }))

    // List phase now shows variance header (one of two is wrong).
    expect(screen.getByText(/Part Variance · 2 parts found/i)).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: /Complete with Variance/i })
    )

    const payload = onComplete.mock.calls[0][0]
    expect(payload.match).toBe(false)
    expect(payload.scannedParts).toHaveLength(2)
    expect(payload.scannedParts[0].part_number).toBe('PART-ABC-123')
    expect(payload.scannedParts[0].quantity).toBe(10)
    expect(payload.scannedParts[1].part_number).toBe('WRONG-EXTRA')
    expect(payload.scannedParts[1].quantity).toBe(4)
    expect(payload.shouldComplete).toBe(true)
  })

  it('all-match multi-entry keeps match=true in the final payload', () => {
    const onComplete = vi.fn()
    render(<RFStepPartNumberVerification {...baseProps({ onComplete })} />)

    // First scan (match) → qty via Find Another Part.
    const input = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input, { target: { value: 'PART-ABC-123' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /Find Another Part/i }))
    fireEvent.click(screen.getByRole('button', { name: /Record This Part/i }))

    // Add another matching part (operator is capturing batches of the
    // same part number).
    fireEvent.click(screen.getByRole('button', { name: /Add Another Part/i }))
    const input2 = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input2, { target: { value: 'PART-ABC-123' } })
    fireEvent.keyDown(input2, { key: 'Enter' })
    // Because we're already in multi-part mode, scanning goes to qty card,
    // and since this value matches expected, the green "Expected Part
    // Found" header shows up.
    expect(screen.getByText(/Expected Part Found/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    fireEvent.click(screen.getByRole('button', { name: /Record This Part/i }))

    // List phase shows no-variance styling.
    expect(screen.getByText(/2 parts recorded/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /^Complete Count/i }))

    const payload = onComplete.mock.calls[0][0]
    expect(payload.match).toBe(true)
    expect(payload.scannedParts).toHaveLength(2)
  })
})

describe('RFStepPartNumberVerification — variance flow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('captures a single wrong part with quantity', () => {
    const onComplete = vi.fn()
    render(<RFStepPartNumberVerification {...baseProps({ onComplete })} />)
    const input = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input, { target: { value: 'PART-XYZ-999' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText(/Wrong Part at Location/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    fireEvent.click(screen.getByRole('button', { name: /Record This Part/i }))
    expect(screen.getByText(/Part Variance · 1 part found/i)).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: /Complete with Variance/i })
    )
    const payload = onComplete.mock.calls[0][0]
    expect(payload.match).toBe(false)
    expect(payload.scannedMaterial).toBe('PART-XYZ-999')
    expect(payload.scannedParts).toHaveLength(1)
    expect(payload.scannedParts[0]).toMatchObject({
      part_number: 'PART-XYZ-999',
      quantity: 5,
      method: 'scan',
    })
  })

  it('captures multiple different wrong parts in the same location', () => {
    const onComplete = vi.fn()
    render(<RFStepPartNumberVerification {...baseProps({ onComplete })} />)

    const input1 = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input1, { target: { value: 'WRONG-1' } })
    fireEvent.keyDown(input1, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    fireEvent.click(screen.getByRole('button', { name: /Record This Part/i }))

    fireEvent.click(screen.getByRole('button', { name: /Add Another Part/i }))
    const input2 = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input2, { target: { value: 'WRONG-2' } })
    fireEvent.keyDown(input2, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: '7' }))
    fireEvent.click(screen.getByRole('button', { name: /Record This Part/i }))

    expect(screen.getByText(/Part Variance · 2 parts found/i)).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: /Complete with Variance/i })
    )
    const payload = onComplete.mock.calls[0][0]
    expect(payload.scannedParts).toHaveLength(2)
    expect(payload.scannedMaterial).toBe('WRONG-1')
  })

  it('allows removing a captured part before finalizing', () => {
    const onComplete = vi.fn()
    render(<RFStepPartNumberVerification {...baseProps({ onComplete })} />)
    const input1 = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input1, { target: { value: 'WRONG-1' } })
    fireEvent.keyDown(input1, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: /Record This Part/i }))
    fireEvent.click(screen.getByRole('button', { name: /Add Another Part/i }))
    const input2 = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input2, { target: { value: 'WRONG-2' } })
    fireEvent.keyDown(input2, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: /Record This Part/i }))
    fireEvent.click(screen.getByRole('button', { name: /Remove WRONG-1/i }))
    fireEvent.click(
      screen.getByRole('button', { name: /Complete with Variance/i })
    )
    const payload = onComplete.mock.calls[0][0]
    expect(payload.scannedParts).toHaveLength(1)
    expect(payload.scannedParts[0].part_number).toBe('WRONG-2')
  })

  it('disables Record This Part until a positive quantity is entered', () => {
    render(<RFStepPartNumberVerification {...baseProps()} />)
    const input = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input, { target: { value: 'WRONG' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const btn = screen.getByRole('button', { name: /Record This Part/i })
    expect(btn.hasAttribute('disabled')).toBe(true)
  })
})

describe('RFStepPartNumberVerification — location empty flow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('short-circuits on Location Empty', () => {
    const onComplete = vi.fn()
    render(<RFStepPartNumberVerification {...baseProps({ onComplete })} />)
    fireEvent.click(screen.getByRole('button', { name: /Location Empty/i }))
    expect(screen.getByText(/Location Reported Empty/i)).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: /Confirm Empty & Complete/i })
    )
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        locationEmpty: true,
        scannedMaterial: null,
        match: null,
        shouldComplete: true,
        scannedParts: [],
      })
    )
  })

  it('disables Location Empty once at least one part has been captured', () => {
    render(<RFStepPartNumberVerification {...baseProps()} />)
    const input = screen.getByPlaceholderText(/Scan part barcode/i)
    fireEvent.change(input, { target: { value: 'WRONG' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    fireEvent.click(screen.getByRole('button', { name: /Record This Part/i }))
    fireEvent.click(screen.getByRole('button', { name: /Add Another Part/i }))
    const btn = screen.getByRole('button', { name: /Location Empty/i })
    expect(btn.hasAttribute('disabled')).toBe(true)
  })
})

describe('RFStepPartNumberVerification — manual entry flow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens QWERTY overlay on Manual Entry', () => {
    render(<RFStepPartNumberVerification {...baseProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /Manual Entry/i }))
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDefined()
  })
})

// Created and developed by Jai Singh
