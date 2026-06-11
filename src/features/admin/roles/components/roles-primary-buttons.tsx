// Created and developed by Jai Singh
import { useState, useRef } from 'react'
import {
  PlusCircle,
  Upload,
  Download,
  ChevronDown,
  FileJson,
} from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { useRoles } from '../context/roles-context'

export function RolesPrimaryButtons() {
  const { setIsCreateDialogOpen, selectedRoles, exportRole, roles } = useRoles()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isExporting, setIsExporting] = useState(false)

  const handleCreateRole = () => {
    setIsCreateDialogOpen(true)
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const importedRole = JSON.parse(text)

      // Validate the imported data
      if (!importedRole.name || !importedRole.displayName) {
        toast.error('Invalid role file: missing required fields')
        return
      }

      // TODO: Implement actual import with backend
      toast.info(
        'Role import feature coming soon. File validated successfully.'
      )
      logger.log('Imported role data:', importedRole)
    } catch (error) {
      logger.error('Error importing role:', error)
      toast.error('Failed to import role: Invalid JSON file')
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleExportSelected = async () => {
    if (selectedRoles.length === 0) {
      toast.error('No roles selected for export')
      return
    }

    setIsExporting(true)
    try {
      for (const role of selectedRoles) {
        exportRole(role)
      }
      toast.success(`Exported ${selectedRoles.length} role(s)`)
    } catch (error) {
      logger.error('Error exporting roles:', error)
      toast.error('Failed to export some roles')
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportAll = async () => {
    if (roles.length === 0) {
      toast.error('No roles to export')
      return
    }

    setIsExporting(true)
    try {
      // Export all roles as a single file
      const allRolesData = roles.map((role) => ({
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        permissions: role.permissions,
        isSystem: role.isSystem,
      }))

      const blob = new Blob([JSON.stringify(allRolesData, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `all-roles-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success(`Exported ${roles.length} roles`)
    } catch (error) {
      logger.error('Error exporting all roles:', error)
      toast.error('Failed to export roles')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className='flex flex-wrap items-center gap-2'>
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type='file'
        accept='.json'
        onChange={handleFileChange}
        className='hidden'
      />

      {/* Create Role Button */}
      <PermissionGuard resource='roles' action='create'>
        <Button onClick={handleCreateRole} className='gap-2'>
          <PlusCircle className='h-4 w-4' />
          Create Role
        </Button>
      </PermissionGuard>

      {/* Import Button */}
      <PermissionGuard resource='roles' action='create'>
        <Button variant='outline' onClick={handleImportClick} className='gap-2'>
          <Upload className='h-4 w-4' />
          Import
        </Button>
      </PermissionGuard>

      {/* Export Dropdown */}
      <PermissionGuard resource='roles' action='read'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='outline' className='gap-2' disabled={isExporting}>
              <Download className='h-4 w-4' />
              Export
              {selectedRoles.length > 0 && (
                <span className='ml-1'>({selectedRoles.length})</span>
              )}
              <ChevronDown className='ml-1 h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              onClick={handleExportSelected}
              disabled={selectedRoles.length === 0}
            >
              <FileJson className='mr-2 h-4 w-4' />
              Export Selected ({selectedRoles.length})
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleExportAll}>
              <Download className='mr-2 h-4 w-4' />
              Export All Roles
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PermissionGuard>
    </div>
  )
}

// Created and developed by Jai Singh
