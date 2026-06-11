// Created and developed by Jai Singh
/**
 * Announcement-specific extras section. Mounted by `<PostComposerDialog>`
 * inside the "Details" tab when `kind === 'announcement'`.
 *
 * Three extras over the shared shell:
 *   - Marquee toggle (large scrolling banner on TV mode — consumer hook
 *     reads `kindData.marquee` and renders accordingly).
 *   - CTA URL + label pair (renders an "Apply"/"Learn more"-style button
 *     on the public PostCard if both are set).
 */
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { AnnouncementKindData } from '../composer-types'
import { Section } from '../section'

interface AnnouncementSectionProps {
  kindData: AnnouncementKindData
  onChange: (next: AnnouncementKindData) => void
  disabled?: boolean
}

export function AnnouncementSection({
  kindData,
  onChange,
  disabled,
}: AnnouncementSectionProps) {
  const patch = (delta: Partial<AnnouncementKindData>): void => {
    onChange({ ...kindData, ...delta })
  }
  return (
    <Section
      title='Announcement details'
      description='Extras that only apply to announcement posts.'
    >
      <div className='border-border/40 bg-background flex items-center justify-between gap-2 rounded-md border p-3'>
        <div>
          <Label className='mt-0!'>Marquee on TV</Label>
          <p className='text-muted-foreground text-xs'>
            Scroll the title across the top of the TV view.
          </p>
        </div>
        <Switch
          checked={kindData.marquee ?? false}
          onCheckedChange={(v) => patch({ marquee: v })}
          disabled={disabled}
        />
      </div>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]'>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='announcement-cta-url'>Call-to-action URL</Label>
          <Input
            id='announcement-cta-url'
            placeholder='https://intranet.example.com/event'
            value={kindData.cta_url ?? ''}
            onChange={(e) => patch({ cta_url: e.target.value || undefined })}
            disabled={disabled}
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='announcement-cta-label'>Button label</Label>
          <Input
            id='announcement-cta-label'
            placeholder='Learn more'
            value={kindData.cta_label ?? ''}
            onChange={(e) => patch({ cta_label: e.target.value || undefined })}
            disabled={disabled}
          />
        </div>
      </div>
    </Section>
  )
}

// Created and developed by Jai Singh
