// Created and developed by Jai Singh
import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface SidebarNavItem {
  id: string
  title: string
  shortTitle?: string
  description?: string
  icon: LucideIcon
  accent?: string
}

export interface SidebarNavGroup {
  id: string
  label: string
  description?: string
  items: SidebarNavItem[]
}

interface SidebarNavProps {
  groups: SidebarNavGroup[]
  activeSection: string
  onSectionChange: (section: string) => void
  className?: string
}

export default function SidebarNav({
  groups,
  activeSection,
  onSectionChange,
  className,
}: SidebarNavProps) {
  return (
    <>
      <div className='md:hidden'>
        <Select value={activeSection} onValueChange={onSectionChange}>
          <SelectTrigger className='h-11 w-full'>
            <SelectValue placeholder='Select section' />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectGroup key={group.id}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <SelectItem key={item.id} value={item.id}>
                      <div className='flex items-center gap-3'>
                        <Icon className='size-4' />
                        <span>{item.shortTitle ?? item.title}</span>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav
        aria-label='Settings sections'
        className={cn('hidden md:flex md:flex-col md:gap-5', className)}
      >
        {groups.map((group, groupIndex) => (
          <div key={group.id} className='flex flex-col gap-1.5'>
            <div className='flex items-center gap-2 px-2 pt-1'>
              <span className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
                {group.label}
              </span>
              <span className='border-border/60 h-px flex-1 border-t border-dashed' />
              <span className='text-muted-foreground/60 text-[10px] tabular-nums'>
                {group.items.length}
              </span>
            </div>

            <ul className='flex flex-col gap-0.5'>
              {group.items.map((item) => {
                const Icon = item.icon
                const active = activeSection === item.id
                return (
                  <li key={item.id}>
                    <button
                      type='button'
                      onClick={() => onSectionChange(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-all',
                        active
                          ? 'bg-muted/80 text-foreground'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full transition-all',
                          active
                            ? 'bg-primary opacity-100'
                            : 'bg-transparent opacity-0'
                        )}
                      />
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
                          active
                            ? (item.accent ?? 'bg-primary/10 text-primary')
                            : 'bg-muted text-muted-foreground group-hover:bg-muted-foreground/10'
                        )}
                      >
                        <Icon className='size-3.5' />
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate font-medium'>
                          {item.shortTitle ?? item.title}
                        </span>
                      </span>
                      {active && (
                        <span
                          aria-hidden
                          className='bg-primary size-1.5 shrink-0 rounded-full'
                        />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>

            {groupIndex < groups.length - 1 && (
              <span aria-hidden className='sr-only' />
            )}
          </div>
        ))}
      </nav>
    </>
  )
}

// Created and developed by Jai Singh
