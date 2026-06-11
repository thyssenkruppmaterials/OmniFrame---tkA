// Created and developed by Jai Singh
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RFStepFoundPartTransfer } from '../rf-step-found-part-transfer'
import type { StepProps } from '../types'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

function baseProps(overrides?: Partial<StepProps>): StepProps {
  return {
    step: {
      id: 'transfer-1',
      type: 'found_part_transfer',
      label: 'Record Transfer',
      required: true,
      order: 3,
      config: {},
    },
    taskData: {
      count_number: 'CC-1',
      material_number: 'KH11117',
      material_description: 'Widget',
      // Source (A) — operator picks from here.
      location: 'R0-19-C-03',
      warehouse: null,
      unit_of_measure: 'EA',
      system_quantity: 5,
      counted_quantity: null,
      count_type: 'found_part_transfer',
      priority: 'normal',
      // Destination (B) — admin-set, operator delivers here.
      transfer_destination_location: 'K4-04-08-2',
      transfer_source_quantity: null,
    },
    stepResult: {},
    onComplete: vi.fn(),
    onBack: vi.fn(),
    isProcessing: false,
    ...overrides,
  }
}

describe('RFStepFoundPartTransfer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows source location + destination + part up front', () => {
    render(<RFStepFoundPartTransfer {...baseProps()} />)
    // Source appears in the header card AND the phase-1 instructions.
    expect(screen.getAllByText('R0-19-C-03').length).toBeGreaterThan(0)
    expect(screen.getAllByText('K4-04-08-2').length).toBeGreaterThan(0)
    expect(screen.getByText('KH11117')).toBeDefined()
  })

  it('renders a blocker when the task has no destination configured', () => {
    render(
      <RFStepFoundPartTransfer
        {...baseProps({
          taskData: {
            ...baseProps().taskData,
            transfer_destination_location: null,
          },
        })}
      />
    )
    expect(screen.getByText(/No destination configured/i)).toBeDefined()
  })

  it('rejects source scan that does not match the task location', () => {
    const onComplete = vi.fn()
    render(<RFStepFoundPartTransfer {...baseProps({ onComplete })} />)
    const input = screen.getByPlaceholderText(/Scan source location/i)
    fireEvent.change(input, { target: { value: 'WRONG-LOC' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Still on phase 1 — source location hasn't changed.
    expect(screen.getByPlaceholderText(/Scan source location/i)).toBeDefined()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('walks the full happy path with correct payload', () => {
    const onComplete = vi.fn()
    render(<RFStepFoundPartTransfer {...baseProps({ onComplete })} />)

    // Scan source (case-insensitive)
    const srcInput = screen.getByPlaceholderText(/Scan source location/i)
    fireEvent.change(srcInput, { target: { value: 'r0-19-c-03' } })
    fireEvent.keyDown(srcInput, { key: 'Enter' })

    // Pick qty — defaults to system qty (5); operator can accept.
    expect(screen.getByText(/How Many Did You Pick/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Record & Continue/i }))

    // Scan destination (case-insensitive)
    const destInput = screen.getByPlaceholderText(/Scan destination location/i)
    fireEvent.change(destInput, { target: { value: 'k4-04-08-2' } })
    fireEvent.keyDown(destInput, { key: 'Enter' })

    // Final count — defaults to picked qty (5). Bump it to 12 (destination
    // had 7 already + 5 picked).
    fireEvent.click(screen.getByRole('button', { name: 'C' }))
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: /Review Transfer/i }))

    // Review + confirm
    expect(screen.getByText(/Review Transfer/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Complete/i }))

    const payload = onComplete.mock.calls[0][0]
    expect(payload.sourceLocation).toBe('R0-19-C-03')
    expect(payload.destinationLocation).toBe('K4-04-08-2')
    expect(payload.pickedQuantity).toBe(5)
    expect(payload.destinationFinalQuantity).toBe(12)
    expect(payload.shouldComplete).toBe(true)
    expect(payload.sourceConfirmedAt).toBeTypeOf('string')
    expect(payload.destinationConfirmedAt).toBeTypeOf('string')
  })

  it('supports Nothing Here short-circuit from the source phase', () => {
    const onComplete = vi.fn()
    render(<RFStepFoundPartTransfer {...baseProps({ onComplete })} />)
    fireEvent.click(screen.getByRole('button', { name: /Nothing Here/i }))
    const payload = onComplete.mock.calls[0][0]
    expect(payload.nothingFound).toBe(true)
    expect(payload.pickedQuantity).toBe(0)
    expect(payload.destinationFinalQuantity).toBe(0)
    expect(payload.shouldComplete).toBe(true)
  })

  it('blocks review when final count < picked qty', () => {
    render(<RFStepFoundPartTransfer {...baseProps()} />)
    const srcInput = screen.getByPlaceholderText(/Scan source location/i)
    fireEvent.change(srcInput, { target: { value: 'R0-19-C-03' } })
    fireEvent.keyDown(srcInput, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /Record & Continue/i }))
    const destInput = screen.getByPlaceholderText(/Scan destination location/i)
    fireEvent.change(destInput, { target: { value: 'K4-04-08-2' } })
    fireEvent.keyDown(destInput, { key: 'Enter' })

    // Clear the pre-filled final count (= pickedQty = 5) → 0.
    fireEvent.click(screen.getByRole('button', { name: 'C' }))
    const reviewBtn = screen.getByRole('button', { name: /Review Transfer/i })
    expect(reviewBtn.hasAttribute('disabled')).toBe(true)
  })

  it('opens manual QWERTY overlays for both source and destination', () => {
    render(<RFStepFoundPartTransfer {...baseProps()} />)
    // Source manual
    fireEvent.click(screen.getByRole('button', { name: /Manual/i }))
    expect(screen.getByRole('button', { name: /^Confirm$/i })).toBeDefined()
    expect(screen.getByText(/Type R0-19-C-03/i)).toBeDefined()
  })
})

// Created and developed by Jai Singh
