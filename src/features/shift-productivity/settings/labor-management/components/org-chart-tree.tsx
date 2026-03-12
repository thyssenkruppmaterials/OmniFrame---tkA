/**
 * Organizational Chart Tree Component
 * Displays hierarchical organizational structure with proper parent-child relationships
 * Created: December 29, 2025
 */
import { useMemo, useState, useCallback } from 'react'
import { ChevronDown, ChevronRight, Network, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

// Types for the organizational tree node from the database
export interface OrgTreeNode {
  user_id: string
  full_name: string
  email: string
  position_title: string | null
  level_in_tree: number
  supervisor_id: string | null
  path_text: string
  is_area_supervisor: boolean
}

// Tree node structure with children
interface TreeNode extends OrgTreeNode {
  children: TreeNode[]
}

interface OrgChartTreeProps {
  data: OrgTreeNode[]
}

interface OrgNodeProps {
  node: TreeNode
  isLast: boolean
  depth: number
  parentLines: boolean[]
}

// Build hierarchical tree from flat data
function buildTree(flatData: OrgTreeNode[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  // First pass: Create all nodes with empty children arrays
  flatData.forEach((node) => {
    nodeMap.set(node.user_id, { ...node, children: [] })
  })

  // Second pass: Build parent-child relationships
  flatData.forEach((node) => {
    const treeNode = nodeMap.get(node.user_id)!

    if (node.supervisor_id && nodeMap.has(node.supervisor_id)) {
      // Has a supervisor that exists in our data - add as child
      const parent = nodeMap.get(node.supervisor_id)!
      parent.children.push(treeNode)
    } else {
      // No supervisor or supervisor not in data - this is a root node
      roots.push(treeNode)
    }
  })

  // Sort children at each level: Area Leads first, then employees, alphabetically within each group
  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      const aIsAreaLead =
        a.position_title?.toLowerCase().includes('area lead') ||
        a.position_title?.toLowerCase().includes('team lead')
      const bIsAreaLead =
        b.position_title?.toLowerCase().includes('area lead') ||
        b.position_title?.toLowerCase().includes('team lead')

      // Area Leads come first
      if (aIsAreaLead && !bIsAreaLead) return -1
      if (!aIsAreaLead && bIsAreaLead) return 1

      // Within same category, sort alphabetically
      return (a.full_name || '').localeCompare(b.full_name || '')
    })
    nodes.forEach((node) => sortChildren(node.children))
  }
  sortChildren(roots)

  return roots
}

// Helper to determine role type from node data
function getRoleType(node: TreeNode): 'supervisor' | 'area-lead' | 'employee' {
  if (node.is_area_supervisor) return 'supervisor'
  // Check if position_title indicates an Area Lead
  if (
    node.position_title?.toLowerCase().includes('area lead') ||
    node.position_title?.toLowerCase().includes('team lead')
  ) {
    return 'area-lead'
  }
  return 'employee'
}

// Individual org chart node component
function OrgNode({ node, isLast, depth, parentLines }: OrgNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  const roleType = getRoleType(node)

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  return (
    <div className='relative'>
      {/* Node content */}
      <div className='flex items-start'>
        {/* Tree lines for this node */}
        {depth > 0 && (
          <div className='flex items-start'>
            {/* Render vertical continuation lines for each parent level */}
            {parentLines.map((showLine, index) => (
              <div key={index} className='relative h-full w-6 flex-shrink-0'>
                {showLine && (
                  <div className='bg-border absolute top-0 bottom-0 left-3 w-px' />
                )}
              </div>
            ))}
            {/* Connector for current node */}
            <div className='relative h-8 w-6 flex-shrink-0'>
              {/* Vertical line from above */}
              <div
                className={cn(
                  'bg-border absolute left-3 w-px',
                  isLast ? 'top-0 h-4' : 'top-0 bottom-0'
                )}
              />
              {/* Horizontal line to node */}
              <div className='bg-border absolute top-4 left-3 h-px w-3' />
            </div>
          </div>
        )}

        {/* Node card */}
        <div className='min-w-0 flex-1'>
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border p-2 transition-colors',
              'bg-card hover:bg-accent/50',
              hasChildren && 'cursor-pointer'
            )}
            onClick={hasChildren ? toggleExpand : undefined}
          >
            {/* Expand/collapse icon for nodes with children */}
            {hasChildren ? (
              <button
                className='hover:bg-accent rounded p-0.5'
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpand()
                }}
              >
                {isExpanded ? (
                  <ChevronDown className='text-muted-foreground h-4 w-4' />
                ) : (
                  <ChevronRight className='text-muted-foreground h-4 w-4' />
                )}
              </button>
            ) : (
              <div className='flex h-5 w-5 items-center justify-center'>
                <User className='text-muted-foreground h-3 w-3' />
              </div>
            )}

            {/* Level/Role badge */}
            <Badge
              variant={
                roleType === 'supervisor' || roleType === 'area-lead'
                  ? 'default'
                  : 'outline'
              }
              className={cn(
                'flex-shrink-0',
                roleType === 'supervisor' &&
                  'bg-amber-500 text-white hover:bg-amber-600',
                roleType === 'area-lead' &&
                  'bg-blue-500 text-white hover:bg-blue-600',
                roleType === 'employee' &&
                  depth === 0 &&
                  'bg-primary/10 text-primary border-primary/20'
              )}
            >
              {roleType === 'supervisor'
                ? 'Supervisor'
                : roleType === 'area-lead'
                  ? 'Area Lead'
                  : depth === 0
                    ? 'Top'
                    : `L${node.level_in_tree}`}
            </Badge>

            {/* Name and details */}
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2 truncate text-sm font-medium'>
                {node.full_name}
                {roleType === 'supervisor' && (
                  <span className='text-xs font-normal text-amber-600 dark:text-amber-400'>
                    (Area Supervisor)
                  </span>
                )}
                {roleType === 'area-lead' && (
                  <span className='text-xs font-normal text-blue-600 dark:text-blue-400'>
                    (Area Lead)
                  </span>
                )}
                {hasChildren && (
                  <span className='text-muted-foreground text-xs font-normal'>
                    ({node.children.length} direct report
                    {node.children.length !== 1 ? 's' : ''})
                  </span>
                )}
              </div>
              <div className='text-muted-foreground truncate text-xs'>
                {node.position_title || 'No position'} • {node.email}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className='mt-1'>
          {node.children.map((child, index) => (
            <OrgNode
              key={child.user_id}
              node={child}
              isLast={index === node.children.length - 1}
              depth={depth + 1}
              parentLines={[...parentLines, !isLast]}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function OrgChartTree({ data }: OrgChartTreeProps) {
  // Build hierarchical tree from flat data
  const tree = useMemo(() => buildTree(data), [data])

  // Calculate stats
  const stats = useMemo(() => {
    const totalPeople = data.length
    const supervisors = data.filter((n) => n.is_area_supervisor).length
    const areaLeads = data.filter(
      (n) =>
        !n.is_area_supervisor &&
        (n.position_title?.toLowerCase().includes('area lead') ||
          n.position_title?.toLowerCase().includes('team lead'))
    ).length
    const maxLevel = Math.max(...data.map((n) => n.level_in_tree), 0)
    const topLevel = tree.length

    return { totalPeople, supervisors, areaLeads, maxLevel, topLevel }
  }, [data, tree])

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className='flex flex-col items-center justify-center py-12'>
          <Network className='text-muted-foreground mb-4 h-12 w-12' />
          <h3 className='mb-2 text-lg font-semibold'>
            No Hierarchy Established
          </h3>
          <p className='text-muted-foreground mb-4 text-center text-sm'>
            Assign supervisors to working areas or create assignments to build
            your organizational chart. Area supervisors are automatically
            included without needing performance tracking.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Stats bar */}
      <div className='bg-muted/50 flex flex-wrap gap-4 rounded-lg p-3'>
        <div className='text-sm'>
          <span className='text-muted-foreground'>Total People:</span>{' '}
          <span className='font-medium'>{stats.totalPeople}</span>
        </div>
        <div className='text-sm'>
          <span className='text-muted-foreground'>Supervisors:</span>{' '}
          <span className='font-medium text-amber-600'>
            {stats.supervisors}
          </span>
        </div>
        <div className='text-sm'>
          <span className='text-muted-foreground'>Area Leads:</span>{' '}
          <span className='font-medium text-blue-600'>{stats.areaLeads}</span>
        </div>
        <div className='text-sm'>
          <span className='text-muted-foreground'>Hierarchy Levels:</span>{' '}
          <span className='font-medium'>{stats.maxLevel}</span>
        </div>
        <div className='text-sm'>
          <span className='text-muted-foreground'>Top-Level Nodes:</span>{' '}
          <span className='font-medium'>{stats.topLevel}</span>
        </div>
      </div>

      {/* Tree view */}
      <Card>
        <CardContent className='p-4'>
          <div className='space-y-1'>
            {tree.map((rootNode, index) => (
              <OrgNode
                key={rootNode.user_id}
                node={rootNode}
                isLast={index === tree.length - 1}
                depth={0}
                parentLines={[]}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
