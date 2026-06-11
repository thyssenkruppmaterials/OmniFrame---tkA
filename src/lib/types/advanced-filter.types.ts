// Created and developed by Jai Singh
/**
 * Advanced Filter Types for Delivery Status
 * Created: November 9, 2025
 *
 * Comprehensive filtering system with support for:
 * - All database columns
 * - Multiple operators (includes, excludes, equals, not equals, greater than, less than, between, etc.)
 * - Filter presets (save/load)
 * - Combination logic (AND/OR)
 */
import type { DeliveryStatusData } from '@/lib/supabase/delivery-status.service'

/**
 * Filter operator types
 */
export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'includes'
  | 'not_includes'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal'
  | 'between'
  | 'is_empty'
  | 'is_not_empty'
  | 'in_list'
  | 'not_in_list'

/**
 * Data type for each field
 */
export type FieldDataType =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'boolean'
  | 'select'

/**
 * Single filter condition
 */
export interface FilterCondition {
  id: string
  field: keyof DeliveryStatusData
  operator: FilterOperator
  value: string | string[] | number | boolean | null
  value2?: string | number // For 'between' operator
  dataType: FieldDataType
}

/**
 * Filter group with combination logic
 */
export interface FilterGroup {
  id: string
  combineWith: 'AND' | 'OR'
  conditions: FilterCondition[]
}

/**
 * Complete advanced filter configuration
 */
export interface AdvancedFilterConfig {
  groups: FilterGroup[]
  globalCombineWith: 'AND' | 'OR' // How to combine groups
}

/**
 * Saved filter preset
 */
export interface FilterPreset {
  id: string
  name: string
  description?: string
  config: AdvancedFilterConfig
  createdAt: string
  updatedAt: string
}

/**
 * Field definition for filter UI
 */
export interface FilterFieldDefinition {
  key: keyof DeliveryStatusData
  label: string
  dataType: FieldDataType
  operators: FilterOperator[]
  hasOptions?: boolean // If true, get unique values from data
}

/**
 * All available filterable fields with their definitions
 */
export const DELIVERY_FILTER_FIELDS: FilterFieldDefinition[] = [
  // Core delivery information
  {
    key: 'delivery',
    label: 'Delivery Number',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'starts_with',
      'ends_with',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'delivery_priority',
    label: 'Delivery Priority',
    dataType: 'select',
    operators: [
      'equals',
      'not_equals',
      'in_list',
      'not_in_list',
      'is_empty',
      'is_not_empty',
    ],
    hasOptions: true,
  },
  {
    key: 'delivery_block',
    label: 'Delivery Block',
    dataType: 'select',
    operators: [
      'equals',
      'not_equals',
      'in_list',
      'not_in_list',
      'is_empty',
      'is_not_empty',
    ],
    hasOptions: true,
  },

  // Location information
  {
    key: 'warehouse_number',
    label: 'Warehouse Number',
    dataType: 'select',
    operators: [
      'equals',
      'not_equals',
      'in_list',
      'not_in_list',
      'is_empty',
      'is_not_empty',
    ],
    hasOptions: true,
  },
  {
    key: 'shipping_point',
    label: 'Shipping Point',
    dataType: 'select',
    operators: [
      'equals',
      'not_equals',
      'in_list',
      'not_in_list',
      'is_empty',
      'is_not_empty',
    ],
    hasOptions: true,
  },
  {
    key: 'receiving_point',
    label: 'Receiving Point',
    dataType: 'select',
    operators: [
      'equals',
      'not_equals',
      'in_list',
      'not_in_list',
      'is_empty',
      'is_not_empty',
    ],
    hasOptions: true,
  },
  {
    key: 'sales_organization',
    label: 'Sales Organization',
    dataType: 'select',
    operators: [
      'equals',
      'not_equals',
      'in_list',
      'not_in_list',
      'is_empty',
      'is_not_empty',
    ],
    hasOptions: true,
  },

  // Customer information
  {
    key: 'ship_to_party',
    label: 'Ship to Party',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'starts_with',
      'ends_with',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'customer_name',
    label: 'Customer Name',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'starts_with',
      'ends_with',
      'is_empty',
      'is_not_empty',
    ],
  },

  // Date fields
  {
    key: 'delivery_creation_date',
    label: 'Delivery Creation Date',
    dataType: 'date',
    operators: [
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'greater_than_or_equal',
      'less_than_or_equal',
      'between',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'delivery_change_date',
    label: 'Delivery Change Date',
    dataType: 'date',
    operators: [
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'greater_than_or_equal',
      'less_than_or_equal',
      'between',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'actual_goods_movement_date',
    label: 'Actual Goods Movement Date',
    dataType: 'date',
    operators: [
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'greater_than_or_equal',
      'less_than_or_equal',
      'between',
      'is_empty',
      'is_not_empty',
    ],
  },

  // Time fields
  {
    key: 'delivery_create_time',
    label: 'Delivery Create Time',
    dataType: 'time',
    operators: [
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'is_empty',
      'is_not_empty',
    ],
  },

  // User information
  {
    key: 'delivery_created_by',
    label: 'Delivery Created By',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'delivery_created_name',
    label: 'Delivery Created Name',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'delivery_change_by',
    label: 'Delivery Changed By',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'delivery_changed_by_name',
    label: 'Delivery Changed By Name',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'is_empty',
      'is_not_empty',
    ],
  },

  // Transfer Order information
  {
    key: 'transfer_order_number',
    label: 'Transfer Order Number',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'starts_with',
      'ends_with',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'transfer_order_create_date',
    label: 'Transfer Order Create Date',
    dataType: 'date',
    operators: [
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'greater_than_or_equal',
      'less_than_or_equal',
      'between',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'transfer_order_create_time',
    label: 'Transfer Order Create Time',
    dataType: 'time',
    operators: [
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'transfer_order_confirm_date',
    label: 'Transfer Order Confirm Date',
    dataType: 'date',
    operators: [
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'greater_than_or_equal',
      'less_than_or_equal',
      'between',
      'is_empty',
      'is_not_empty',
    ],
  },

  // Shipment information
  {
    key: 'shipment_number',
    label: 'Shipment Number',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'starts_with',
      'ends_with',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'shipment_create_date',
    label: 'Shipment Create Date',
    dataType: 'date',
    operators: [
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'greater_than_or_equal',
      'less_than_or_equal',
      'between',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'shipment_create_by',
    label: 'Shipment Created By',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'is_empty',
      'is_not_empty',
    ],
  },
  {
    key: 'shipment_created_name',
    label: 'Shipment Created Name',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'is_empty',
      'is_not_empty',
    ],
  },

  // Status and movement
  {
    key: 'goods_movement_status',
    label: 'Goods Movement Status',
    dataType: 'select',
    operators: [
      'equals',
      'not_equals',
      'in_list',
      'not_in_list',
      'is_empty',
      'is_not_empty',
    ],
    hasOptions: true,
  },
  {
    key: 'status',
    label: 'Outbound Status',
    dataType: 'select',
    operators: [
      'equals',
      'not_equals',
      'in_list',
      'not_in_list',
      'is_empty',
      'is_not_empty',
    ],
    hasOptions: true,
  },

  // Additional fields
  {
    key: 'external_identification_1',
    label: 'External Identification 1',
    dataType: 'text',
    operators: [
      'equals',
      'not_equals',
      'includes',
      'not_includes',
      'starts_with',
      'ends_with',
      'is_empty',
      'is_not_empty',
    ],
  },

  // Calculated fields
  {
    key: 'days_open',
    label: 'Days Open',
    dataType: 'number',
    operators: [
      'equals',
      'not_equals',
      'greater_than',
      'less_than',
      'greater_than_or_equal',
      'less_than_or_equal',
      'between',
      'is_empty',
      'is_not_empty',
    ],
  },

  // Disposition
  {
    key: 'dispositions',
    label: 'Disposition',
    dataType: 'select',
    operators: [
      'equals',
      'not_equals',
      'in_list',
      'not_in_list',
      'is_empty',
      'is_not_empty',
    ],
    hasOptions: true,
  },
]

/**
 * Operator display labels
 */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: 'Equals',
  not_equals: 'Does Not Equal',
  includes: 'Includes',
  not_includes: 'Does Not Include',
  starts_with: 'Starts With',
  ends_with: 'Ends With',
  greater_than: 'Greater Than',
  less_than: 'Less Than',
  greater_than_or_equal: 'Greater Than or Equal',
  less_than_or_equal: 'Less Than or Equal',
  between: 'Between',
  is_empty: 'Is Empty',
  is_not_empty: 'Is Not Empty',
  in_list: 'In List',
  not_in_list: 'Not In List',
}

/**
 * Check if operator requires a value input
 */
export function operatorRequiresValue(operator: FilterOperator): boolean {
  return !['is_empty', 'is_not_empty'].includes(operator)
}

/**
 * Check if operator requires two value inputs (e.g., 'between')
 */
export function operatorRequiresTwoValues(operator: FilterOperator): boolean {
  return operator === 'between'
}

/**
 * Check if operator requires multi-value input (e.g., 'in_list')
 */
export function operatorRequiresMultiValue(operator: FilterOperator): boolean {
  return ['in_list', 'not_in_list'].includes(operator)
}

// Created and developed by Jai Singh
