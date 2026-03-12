/**
 * Unit Tests for RF Cycle Count Service
 * Testing the Quick Win fixes
 */
import { describe, expect, it } from 'vitest'
import { rfCycleCountService } from '../rf-cycle-count.service'

describe('RFCycleCountService - Variance Calculation Fix', () => {
  describe('validateCycleCount', () => {
    it('should handle zero system quantity with zero counted quantity', () => {
      const result = rfCycleCountService.validateCycleCount(0, 0)

      expect(result.isValid).toBe(true)
      expect(result.varianceCalculation?.variance).toBe(0)
      expect(result.varianceCalculation?.variancePercentage).toBe(0)
      expect(result.varianceCalculation?.requiresReview).toBe(false)
      expect(result.warnings).toHaveLength(0)
    })

    it('should handle zero system quantity with positive counted quantity', () => {
      const result = rfCycleCountService.validateCycleCount(0, 100)

      expect(result.isValid).toBe(true)
      expect(result.varianceCalculation?.variance).toBe(100)
      expect(result.varianceCalculation?.variancePercentage).toBe(Infinity)
      expect(result.varianceCalculation?.requiresReview).toBe(true)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings?.[0]).toContain('Zero system quantity')
    })

    it('should calculate normal variance correctly', () => {
      const result = rfCycleCountService.validateCycleCount(100, 110)

      expect(result.isValid).toBe(true)
      expect(result.varianceCalculation?.variance).toBe(10)
      expect(result.varianceCalculation?.variancePercentage).toBe(10)
      expect(result.varianceCalculation?.requiresReview).toBe(false)
    })

    it('should require review for variance > 10%', () => {
      const result = rfCycleCountService.validateCycleCount(100, 115)

      expect(result.isValid).toBe(true)
      expect(result.varianceCalculation?.variance).toBe(15)
      expect(result.varianceCalculation?.variancePercentage).toBe(15)
      expect(result.varianceCalculation?.requiresReview).toBe(true)
      expect(result.warnings).toHaveLength(1)
    })

    it('should handle negative variance', () => {
      const result = rfCycleCountService.validateCycleCount(100, 80)

      expect(result.isValid).toBe(true)
      expect(result.varianceCalculation?.variance).toBe(-20)
      expect(result.varianceCalculation?.variancePercentage).toBe(-20)
      expect(result.varianceCalculation?.requiresReview).toBe(true)
    })

    it('should warn for variance > 5% but not require review for variance <= 10%', () => {
      const result = rfCycleCountService.validateCycleCount(100, 107)

      expect(result.isValid).toBe(true)
      expect(result.varianceCalculation?.variance).toBe(7)
      expect(result.varianceCalculation?.variancePercentage).toBeCloseTo(7, 10)
      expect(result.varianceCalculation?.requiresReview).toBe(false)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings?.[0]).toContain('7.00%')
    })

    it('should handle large positive variance', () => {
      const result = rfCycleCountService.validateCycleCount(10, 1000)

      expect(result.isValid).toBe(true)
      expect(result.varianceCalculation?.variance).toBe(990)
      expect(result.varianceCalculation?.variancePercentage).toBe(9900)
      expect(result.varianceCalculation?.requiresReview).toBe(true)
    })

    it('should handle decimal quantities', () => {
      const result = rfCycleCountService.validateCycleCount(10.5, 11.5)

      expect(result.isValid).toBe(true)
      expect(result.varianceCalculation?.variance).toBeCloseTo(1, 2)
      expect(result.varianceCalculation?.variancePercentage).toBeCloseTo(
        9.52,
        1
      )
      expect(result.varianceCalculation?.requiresReview).toBe(false)
    })

    it('should handle perfect match (no variance)', () => {
      const result = rfCycleCountService.validateCycleCount(100, 100)

      expect(result.isValid).toBe(true)
      expect(result.varianceCalculation?.variance).toBe(0)
      expect(result.varianceCalculation?.variancePercentage).toBe(0)
      expect(result.varianceCalculation?.requiresReview).toBe(false)
      expect(result.warnings).toHaveLength(0)
    })

    it('should handle very small quantities', () => {
      const result = rfCycleCountService.validateCycleCount(0.001, 0.002)

      expect(result.isValid).toBe(true)
      expect(result.varianceCalculation?.variance).toBeCloseTo(0.001, 3)
      expect(result.varianceCalculation?.variancePercentage).toBe(100)
      expect(result.varianceCalculation?.requiresReview).toBe(true)
    })
  })
})
