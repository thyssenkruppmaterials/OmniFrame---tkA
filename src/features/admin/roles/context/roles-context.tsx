import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import type { RoleTemplate } from '../components/shared'
import { type Role } from '../data/schema'
import {
  getRoles,
  duplicateRole as duplicateRoleService,
  type DuplicateRoleResult,
} from '../services/role.service'

// Edit mode types
export type EditMode = 'wizard' | 'quick' | null

// Draft role interface for saving wizard progress
export interface DraftRole {
  step: number
  formData: {
    name?: string
    displayName?: string
    description?: string
  }
  permissions: string[]
  navigationItems: string[]
  tabPermissions: string[]
  savedAt: string
}

interface RolesState {
  // Role data
  roles: Role[]
  selectedRoles: Role[]
  setSelectedRoles: (roles: Role[]) => void
  currentRole: Role | null
  setCurrentRole: (role: Role | null) => void
  isLoading: boolean
  isDuplicating: boolean
  refreshRoles: () => Promise<void>

  // Edit mode
  editMode: EditMode
  setEditMode: (mode: EditMode) => void

  // Draft management
  draftRole: DraftRole | null
  saveDraftRole: (draft: DraftRole) => void
  loadDraftRole: () => DraftRole | null
  clearDraftRole: () => void

  // Comparison
  comparisonRole: Role | null
  setComparisonRole: (role: Role | null) => void

  // Templates
  templates: RoleTemplate[]
  loadTemplates: () => void
  saveTemplate: (template: Omit<RoleTemplate, 'id'>) => void

  // Role operations
  duplicateRole: (role: Role) => Promise<DuplicateRoleResult | null>
  exportRole: (role: Role) => void

  // Legacy dialogs (will be deprecated)
  isCreateDialogOpen: boolean
  setIsCreateDialogOpen: (open: boolean) => void
  isEditDialogOpen: boolean
  setIsEditDialogOpen: (open: boolean) => void
  isDeleteDialogOpen: boolean
  setIsDeleteDialogOpen: (open: boolean) => void
  isPermissionsDialogOpen: boolean
  setIsPermissionsDialogOpen: (open: boolean) => void
  isNavigationDialogOpen: boolean
  setIsNavigationDialogOpen: (open: boolean) => void
  isTabPermissionsDialogOpen: boolean
  setIsTabPermissionsDialogOpen: (open: boolean) => void

  // New dialogs
  isQuickEditDialogOpen: boolean
  setIsQuickEditDialogOpen: (open: boolean) => void
  isWizardEditDialogOpen: boolean
  setIsWizardEditDialogOpen: (open: boolean) => void
  isCompareDialogOpen: boolean
  setIsCompareDialogOpen: (open: boolean) => void
}

// Storage keys
const DRAFT_STORAGE_KEY = 'roleWizardDraft'
const TEMPLATES_STORAGE_KEY = 'roleTemplates'

const RolesContext = createContext<RolesState | undefined>(undefined)

export function useRoles() {
  const context = useContext(RolesContext)
  if (!context) {
    throw new Error('useRoles must be used within a RolesProvider')
  }
  return context
}

interface RolesProviderProps {
  children: ReactNode
}

export default function RolesProvider({ children }: RolesProviderProps) {
  // Role data
  const [roles, setRoles] = useState<Role[]>([])
  const [selectedRoles, setSelectedRoles] = useState<Role[]>([])
  const [currentRole, setCurrentRole] = useState<Role | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)

  // Edit mode
  const [editMode, setEditMode] = useState<EditMode>(null)

  // Draft management
  const [draftRole, setDraftRole] = useState<DraftRole | null>(null)

  // Comparison
  const [comparisonRole, setComparisonRole] = useState<Role | null>(null)

  // Templates
  const [templates, setTemplates] = useState<RoleTemplate[]>([])

  // Legacy dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isPermissionsDialogOpen, setIsPermissionsDialogOpen] = useState(false)
  const [isNavigationDialogOpen, setIsNavigationDialogOpen] = useState(false)
  const [isTabPermissionsDialogOpen, setIsTabPermissionsDialogOpen] =
    useState(false)

  // New dialog states
  const [isQuickEditDialogOpen, setIsQuickEditDialogOpen] = useState(false)
  const [isWizardEditDialogOpen, setIsWizardEditDialogOpen] = useState(false)
  const [isCompareDialogOpen, setIsCompareDialogOpen] = useState(false)

  // Load roles from Supabase on mount
  useEffect(() => {
    loadRolesInitial()
    loadTemplates()
    loadDraftFromStorage()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run on mount only; loaders would cause re-run every render if added
  }, [])

  const loadRolesInitial = async () => {
    setIsLoading(true)
    try {
      const roleData = await getRoles()

      // Convert RoleData to Role format for the table
      const formattedRoles: Role[] = roleData.map((role) => ({
        id: role.id,
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        isSystem: role.isSystem,
        isActive: role.isActive,
        permissions: role.permissions.map((p) => `${p.resource}:${p.action}`),
        userCount: role.userCount,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      }))

      setRoles(formattedRoles)
    } catch (error) {
      logger.error('Error loading roles:', error)
      toast.error('Failed to load roles from database')
    } finally {
      setIsLoading(false)
    }
  }

  const refreshRoles = async () => {
    await loadRolesInitial()
  }

  // Draft management functions
  const loadDraftFromStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (stored) {
        const draft = JSON.parse(stored) as DraftRole
        // Only load if draft is less than 24 hours old
        const draftAge = Date.now() - new Date(draft.savedAt).getTime()
        if (draftAge < 24 * 60 * 60 * 1000) {
          setDraftRole(draft)
          return draft
        } else {
          localStorage.removeItem(DRAFT_STORAGE_KEY)
        }
      }
    } catch (error) {
      logger.error('Error loading draft:', error)
    }
    return null
  }, [])

  const saveDraftRole = useCallback((draft: DraftRole) => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
      setDraftRole(draft)
      toast.success('Draft saved')
    } catch (error) {
      logger.error('Error saving draft:', error)
      toast.error('Failed to save draft')
    }
  }, [])

  const loadDraftRole = useCallback(() => {
    return loadDraftFromStorage()
  }, [loadDraftFromStorage])

  const clearDraftRole = useCallback(() => {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    setDraftRole(null)
  }, [])

  // Template management functions
  const loadTemplates = useCallback(() => {
    try {
      const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY)
      if (stored) {
        const customTemplates = JSON.parse(stored) as RoleTemplate[]
        setTemplates(customTemplates)
      }
    } catch (error) {
      logger.error('Error loading templates:', error)
    }
  }, [])

  const saveTemplate = useCallback(
    (template: Omit<RoleTemplate, 'id'>) => {
      try {
        const newTemplate: RoleTemplate = {
          ...template,
          id: `custom-${Date.now()}`,
        }
        const updatedTemplates = [...templates, newTemplate]
        localStorage.setItem(
          TEMPLATES_STORAGE_KEY,
          JSON.stringify(updatedTemplates)
        )
        setTemplates(updatedTemplates)
        toast.success(`Template "${template.displayName}" saved`)
      } catch (error) {
        logger.error('Error saving template:', error)
        toast.error('Failed to save template')
      }
    },
    [templates]
  )

  // Role operations
  /**
   * Duplicate a role with all its permissions, navigation, and tabs
   * BUG FIX (Jan 27, 2026): Now actually calls the service to duplicate all permission types
   */
  const duplicateRole = useCallback(
    async (role: Role): Promise<DuplicateRoleResult | null> => {
      setIsDuplicating(true)

      try {
        // Generate unique name for the copy
        const timestamp = Date.now()
        const newName = `${role.name}_copy_${timestamp}`
        const newDisplayName = `${role.displayName} (Copy)`

        logger.log(
          `[RolesContext] Duplicating role "${role.name}" as "${newName}"`
        )

        // Call the service to perform the actual duplication
        const result = await duplicateRoleService(
          role.id,
          newName,
          newDisplayName
        )

        if (!result) {
          toast.error('Failed to duplicate role', {
            description: 'The role could not be created. Please try again.',
          })
          return null
        }

        // Calculate totals for feedback
        const sourceTotal =
          result.sourcePermissionCount +
          result.sourceNavigationCount +
          result.sourceTabCount
        const copiedTotal =
          result.copiedPermissionCount +
          result.copiedNavigationCount +
          result.copiedTabCount

        // Show success toast with details
        if (result.warnings.length === 0) {
          toast.success('Role Duplicated Successfully', {
            description: `Created "${result.role.displayName}" with ${result.copiedPermissionCount} permissions, ${result.copiedNavigationCount} navigation items, and ${result.copiedTabCount} tabs.`,
            duration: 5000,
          })
        } else {
          // Show warning toast if there were issues
          toast.warning('Role Duplicated with Warnings', {
            description: `Created "${result.role.displayName}" but ${result.warnings.length} issue(s) occurred. Check console for details.`,
            duration: 8000,
          })
        }

        // Check if counts match and show additional warning if not
        if (copiedTotal !== sourceTotal) {
          toast.warning('Permission Count Mismatch', {
            description: `Source had ${sourceTotal} total items, copy has ${copiedTotal}. Some items may not have been copied.`,
            duration: 8000,
          })
        }

        // Refresh the roles list to show the new role
        await loadRoles()

        return result
      } catch (error) {
        logger.error('[RolesContext] Error duplicating role:', error)
        toast.error('Failed to Duplicate Role', {
          description:
            error instanceof Error
              ? error.message
              : 'An unexpected error occurred',
          duration: 5000,
        })
        return null
      } finally {
        setIsDuplicating(false)
      }
    },
    []
  )

  // Helper function to load roles (extracted for reuse)
  const loadRoles = async () => {
    setIsLoading(true)
    try {
      const roleData = await getRoles()

      // Convert RoleData to Role format for the table
      const formattedRoles: Role[] = roleData.map((role) => ({
        id: role.id,
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        isSystem: role.isSystem,
        isActive: role.isActive,
        permissions: role.permissions.map((p) => `${p.resource}:${p.action}`),
        userCount: role.userCount,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      }))

      setRoles(formattedRoles)
    } catch (error) {
      logger.error('Error loading roles:', error)
      toast.error('Failed to load roles from database')
    } finally {
      setIsLoading(false)
    }
  }

  const exportRole = useCallback((role: Role) => {
    try {
      const exportData = {
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        permissions: role.permissions,
        isSystem: role.isSystem,
        exportedAt: new Date().toISOString(),
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `role-${role.name}-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success(`Role "${role.displayName}" exported`)
    } catch (error) {
      logger.error('Error exporting role:', error)
      toast.error('Failed to export role')
    }
  }, [])

  const value: RolesState = {
    // Role data
    roles,
    selectedRoles,
    setSelectedRoles,
    currentRole,
    setCurrentRole,
    isLoading,
    isDuplicating,
    refreshRoles,

    // Edit mode
    editMode,
    setEditMode,

    // Draft management
    draftRole,
    saveDraftRole,
    loadDraftRole,
    clearDraftRole,

    // Comparison
    comparisonRole,
    setComparisonRole,

    // Templates
    templates,
    loadTemplates,
    saveTemplate,

    // Role operations
    duplicateRole,
    exportRole,

    // Legacy dialogs
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    isEditDialogOpen,
    setIsEditDialogOpen,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    isPermissionsDialogOpen,
    setIsPermissionsDialogOpen,
    isNavigationDialogOpen,
    setIsNavigationDialogOpen,
    isTabPermissionsDialogOpen,
    setIsTabPermissionsDialogOpen,

    // New dialogs
    isQuickEditDialogOpen,
    setIsQuickEditDialogOpen,
    isWizardEditDialogOpen,
    setIsWizardEditDialogOpen,
    isCompareDialogOpen,
    setIsCompareDialogOpen,
  }

  return <RolesContext.Provider value={value}>{children}</RolesContext.Provider>
}
