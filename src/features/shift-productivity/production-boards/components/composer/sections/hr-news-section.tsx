// Created and developed by Jai Singh
/**
 * HR News-specific extras section.
 *
 * Three extras:
 *   - Author byline (name + optional avatar URL — small image preview).
 *   - Category (Benefits / Culture / Policy / Other) via ToggleGroup so
 *     the choice is one click instead of a dropdown.
 */
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { HR_NEWS_CATEGORIES, type HrNewsKindData } from '../composer-types'
import { Section } from '../section'

interface HrNewsSectionProps {
  kindData: HrNewsKindData
  onChange: (next: HrNewsKindData) => void
  disabled?: boolean
}

export function HrNewsSection({
  kindData,
  onChange,
  disabled,
}: HrNewsSectionProps) {
  const patch = (delta: Partial<HrNewsKindData>): void => {
    onChange({ ...kindData, ...delta })
  }
  return (
    <Section
      title='HR news details'
      description='Author, category, and optional display date.'
    >
      <div className='flex flex-col gap-1.5'>
        <Label>Category</Label>
        <ToggleGroup
          type='single'
          value={kindData.category ?? ''}
          onValueChange={(v) =>
            v
              ? patch({
                  category: v as HrNewsKindData['category'],
                })
              : patch({ category: undefined })
          }
          disabled={disabled}
          className='flex flex-wrap justify-start gap-1.5'
        >
          {HR_NEWS_CATEGORIES.map((c) => (
            <ToggleGroupItem
              key={c}
              value={c}
              className='h-8 px-3 text-xs capitalize'
            >
              {c}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='hr-author-name'>Author name</Label>
          <Input
            id='hr-author-name'
            placeholder='Jane Smith'
            value={kindData.author_name ?? ''}
            onChange={(e) =>
              patch({ author_name: e.target.value || undefined })
            }
            disabled={disabled}
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='hr-author-avatar'>Author avatar URL</Label>
          <Input
            id='hr-author-avatar'
            placeholder='https://…'
            value={kindData.author_avatar_url ?? ''}
            onChange={(e) =>
              patch({ author_avatar_url: e.target.value || undefined })
            }
            disabled={disabled}
          />
        </div>
      </div>
    </Section>
  )
}

// Created and developed by Jai Singh
