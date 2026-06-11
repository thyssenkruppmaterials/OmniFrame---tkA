// Created and developed by Jai Singh
/**
 * Unified post composer dialog — the single editor surface for all four
 * Production Boards content tabs (Announcements, HR News, Jobs, Safety
 * Alerts). Replaces the four ad-hoc per-board Sheet editors.
 *
 * The dialog is **resizable** (drag the bottom-right corner; size is
 * persisted to localStorage), uses a **side-by-side preview / controls**
 * layout (left aside = live preview, right pane = tabbed controls), and
 * exposes per-kind sections via a discriminator switch in the Details
 * tab.
 *
 * Pattern lineage: builds on
 *   - Patterns/Editable-Board-Dialogs.md § v12.3 (side-by-side recipe)
 *   - Patterns/Editable-Board-Dialogs.md § "Bordered sections + column headers"
 *   - Patterns/Editable-Board-Sheets.md § confirm-if-dirty exit
 *
 * Persistence: the dialog delegates to two hooks depending on `kind` —
 * `useBoardPosts(scope)` for the three post scopes, and `useJobPostings()`
 * for jobs. The hooks were extended in this slice to round-trip the new
 * fields (attachments, kind_data, priority, is_published,
 * reprompt_interval_minutes); see the hook files for the wire shape.
 *
 * Realtime: per `.cursor/rules/Master Rule.mdc` "Realtime Policy", no new
 * `supabase.channel(...)` callsites. The boards still poll at 60s; the
 * composer simply invalidates the relevant queryKey on save.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  IconBriefcase,
  IconClockHour4,
  IconLayoutSidebar,
  IconLayoutSidebarRightExpand,
  IconPlus,
  IconShieldExclamation,
  IconSpeakerphone,
  IconUsersGroup,
  type Icon,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ColorPickerInput } from '@/components/ui/color-picker-input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  useJobPostings,
  type JobPostingRow,
} from '../boards/jobs/hooks/use-job-postings'
import {
  useBoardPosts,
  type PostRow,
  type PostScope,
} from '../hooks/use-board-posts'
import { useBoardWorkingAreas } from '../hooks/use-board-working-areas'
import { useBranches } from '../hooks/use-branches'
import {
  parseCardVariant,
  parseVariantConfig,
  type VariantConfig,
} from './bento/card-variant'
import { BoardCardVariantPicker } from './bento/card-variant-picker'
import { ComposerAttachmentUploader } from './composer/composer-attachment-uploader'
import { ComposerDateTimePicker } from './composer/composer-date-time-picker'
import { ComposerPreview } from './composer/composer-preview'
import { ComposerResizableShell } from './composer/composer-resizable-shell'
import { TEMPLATES_BY_KIND } from './composer/composer-templates'
import {
  DEFAULT_COMPOSER_VALUES,
  KIND_LABEL,
  POST_PRIORITIES,
  SAFETY_SEVERITIES,
  defaultKindData,
  defaultsForKind,
  describeActiveWindow,
  deriveStatus,
  parseAttachments,
  parseKindData,
  type Attachment,
  type AnnouncementKindData,
  type ComposerValues,
  type HrNewsKindData,
  type JobKindData,
  type PostKind,
  type SafetyAlertKindData,
} from './composer/composer-types'
import { Section } from './composer/section'
import { AnnouncementSection } from './composer/sections/announcement-section'
import { HrNewsSection } from './composer/sections/hr-news-section'
import { JobSection } from './composer/sections/job-section'
import { SafetyAlertSection } from './composer/sections/safety-alert-section'

const KIND_ICON: Record<PostKind, Icon> = {
  announcement: IconSpeakerphone,
  hr_news: IconUsersGroup,
  job: IconBriefcase,
  safety_alert: IconShieldExclamation,
}

const NO_SELECTION = '__none__'

type TabId = 'details' | 'media' | 'schedule' | 'audience'

type ComposerMode =
  | { type: 'create' }
  | { type: 'edit'; post: PostRow }
  | { type: 'edit-job'; job: JobPostingRow }

export interface PostComposerDialogProps {
  open: boolean
  kind: PostKind
  mode: ComposerMode
  onClose: () => void
  onSaved?: () => void
}

function isPostScope(kind: PostKind): kind is PostScope {
  return kind !== 'job'
}

function buildValuesFromPost(post: PostRow, kind: PostKind): ComposerValues {
  // The shared `PostRow` only exposes a subset of the new columns we
  // persisted in migration 305; the hook was extended to surface them.
  // Where the hook hasn't surfaced a value yet, fall back to the
  // composer's defaults (the new fields are nullable / defaulted on the
  // DB, so this can't lose data).
  const v = post as unknown as Record<string, unknown>
  const attachments = parseAttachments(v.attachments)
  const kindData = parseKindData(kind, v.kindData ?? v.kind_data)
  const priority =
    typeof v.priority === 'string' &&
    ['low', 'normal', 'high', 'pinned'].includes(v.priority)
      ? (v.priority as ComposerValues['priority'])
      : 'normal'
  const isPublished = typeof v.isPublished === 'boolean' ? v.isPublished : true
  const repromptInterval =
    typeof v.repromptIntervalMinutes === 'number'
      ? v.repromptIntervalMinutes
      : null
  return {
    ...DEFAULT_COMPOSER_VALUES,
    kind,
    title: post.title ?? '',
    body: post.body ?? '',
    severity: post.severity,
    accentHex: post.colorHex ?? null,
    workingAreaId: post.workingAreaId ?? null,
    branchId: post.branchId ?? null,
    publishAt: post.publishedAt ?? null,
    expiresAt: post.expiresAt ?? null,
    acknowledgmentRequired: post.acknowledgedRequired ?? false,
    isPublished,
    priority,
    repromptIntervalMinutes: repromptInterval,
    attachments,
    kindData,
  }
}

function buildValuesFromJob(job: JobPostingRow): ComposerValues {
  const v = job as unknown as Record<string, unknown>
  const attachments = parseAttachments(v.attachments)
  const kindData = parseKindData('job', v.kindData ?? v.kind_data)
  const priority =
    typeof v.priority === 'string' &&
    ['low', 'normal', 'high', 'pinned'].includes(v.priority)
      ? (v.priority as ComposerValues['priority'])
      : 'normal'
  const isPublished = typeof v.isPublished === 'boolean' ? v.isPublished : true
  return {
    ...DEFAULT_COMPOSER_VALUES,
    kind: 'job',
    title: job.title ?? '',
    body: job.description ?? '',
    accentHex: job.colorHex ?? null,
    workingAreaId: job.workingAreaId ?? null,
    branchId: job.branchId ?? null,
    publishAt: job.postedAt ?? null,
    expiresAt: job.closesAt ?? null,
    jobDepartment: job.department ?? null,
    jobRequirements: job.requirements ?? null,
    jobApplyUrl: job.applyUrl ?? null,
    jobApplyEmail: job.applyEmail ?? null,
    jobIsInternal: job.isInternal ?? true,
    priority,
    isPublished,
    attachments,
    kindData,
  }
}

export function PostComposerDialog({
  open,
  kind,
  mode,
  onClose,
  onSaved,
}: PostComposerDialogProps) {
  const navigate = useNavigate()
  void navigate // reserved for future deep-link integration
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? ''
  const { workingAreas } = useBoardWorkingAreas()
  const { branches } = useBranches()

  // Discriminator: post-scoped hooks vs jobs hook. The composer always
  // calls the post hook (passing whatever scope makes sense — never used
  // for the job mode, but instantiating it here keeps the hook count
  // stable across renders so React's rules-of-hooks stay happy). The job
  // hook is always also instantiated for the same reason.
  const postScope: PostScope = isPostScope(kind) ? kind : 'announcement'
  const { createPost, updatePost, deletePost } = useBoardPosts(postScope)
  const { createJob, updateJob, deleteJob } = useJobPostings()

  const isEdit = mode.type === 'edit' || mode.type === 'edit-job'

  const isEditMode = mode.type === 'edit'

  // Stable draft id used as the storage-bucket scope so concurrent uploads
  // cluster under one folder; on edit we use the real row id so updates
  // co-locate with the originals.
  const [draftId] = useState<string>(() => crypto.randomUUID())
  const bucketScope =
    mode.type === 'edit'
      ? mode.post.id
      : mode.type === 'edit-job'
        ? mode.job.id
        : draftId

  const initial = useMemo<ComposerValues>(() => {
    if (mode.type === 'edit') return buildValuesFromPost(mode.post, kind)
    if (mode.type === 'edit-job') return buildValuesFromJob(mode.job)
    return defaultsForKind(kind)
    // mode is a discriminated union with a stable identity per open;
    // recomputing on kind/mode changes is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    kind,
    mode.type,
    mode.type === 'edit'
      ? mode.post.id
      : mode.type === 'edit-job'
        ? mode.job.id
        : 'create',
  ])

  const [values, setValues] = useState<ComposerValues>(initial)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmExitOpen, setConfirmExitOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('details')
  const [isSaving, setIsSaving] = useState(false)

  // Reset whenever the dialog re-opens against a different row.
  useEffect(() => {
    if (open) {
      setValues(initial)
      setIsDirty(false)
      setActiveTab('details')
    }
  }, [initial, open])

  const patch = useCallback((delta: Partial<ComposerValues>): void => {
    setValues((prev) => ({ ...prev, ...delta }))
    setIsDirty(true)
  }, [])

  const patchKindData = useCallback((next: unknown): void => {
    setValues((prev) => ({
      ...prev,
      kindData: next as ComposerValues['kindData'],
    }))
    setIsDirty(true)
  }, [])

  const attemptClose = useCallback((): void => {
    if (isDirty && !isSaving) {
      setConfirmExitOpen(true)
      return
    }
    onClose()
  }, [isDirty, isSaving, onClose])

  // Keyboard shortcuts: Cmd/Ctrl+S to save, Cmd/Ctrl+P to toggle preview.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      const isMod = e.metaKey || e.ctrlKey
      if (!isMod) return
      if (e.key === 's') {
        e.preventDefault()
        const form = document.querySelector<HTMLFormElement>(
          'form[data-composer-form="true"]'
        )
        form?.requestSubmit()
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPreviewVisible((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
    overrideIsPublished?: boolean
  ): Promise<void> => {
    event.preventDefault()
    if (!values.title.trim()) {
      toast.error('Title is required')
      return
    }
    setIsSaving(true)
    try {
      const isPublished = overrideIsPublished ?? values.isPublished
      const baseAttachments = renumberAttachments(values.attachments)
      if (kind === 'job') {
        await persistJob({
          values: { ...values, isPublished, attachments: baseAttachments },
          mode,
          createJob,
          updateJob,
        })
      } else {
        await persistPost({
          values: { ...values, isPublished, attachments: baseAttachments },
          scope: postScope,
          mode,
          createPost,
          updatePost,
        })
      }
      onSaved?.()
      setIsDirty(false)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    setIsSaving(true)
    try {
      if (mode.type === 'edit') {
        await deletePost.mutateAsync(mode.post.id)
      } else if (mode.type === 'edit-job') {
        await deleteJob.mutateAsync(mode.job.id)
      }
      setConfirmDeleteOpen(false)
      setIsDirty(false)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setIsSaving(false)
    }
  }

  const Icon = KIND_ICON[kind]
  const status = deriveStatus(values)
  const activeWindow = describeActiveWindow(values)

  const templates = TEMPLATES_BY_KIND[kind]
  const showBranchControl = kind === 'hr_news'
  const showWorkingAreaControl =
    kind === 'announcement' || kind === 'safety_alert' || kind === 'job'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) attemptClose()
      }}
    >
      <DialogContent
        // `w-auto max-w-none` is required so the dialog shrinks to the
        // resizable shell's intrinsic size. Without it, the base
        // `w-full max-w-[calc(100%-2rem)]` from the shadcn primitive
        // stretches DialogContent to fill the viewport, and the shell
        // (which has its own width/height style) ends up anchored to
        // the top-left of that container — visually appearing
        // top-left even though Radix's `translate-x/y[-50%]` is
        // technically centering the (now huge) wrapper.
        className='w-auto max-w-none gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none sm:max-w-none'
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <ComposerResizableShell
          storageKey={`omniframe.post-composer.${kind}`}
          defaultWidth={Math.min(
            1240,
            typeof window !== 'undefined' ? window.innerWidth - 80 : 1240
          )}
          defaultHeight={Math.min(
            780,
            typeof window !== 'undefined' ? window.innerHeight - 80 : 780
          )}
          minWidth={760}
          minHeight={520}
          className='bg-background border-border/60 flex flex-col overflow-hidden rounded-xl border shadow-2xl'
        >
          <DialogHeader className='border-border/40 shrink-0 border-b px-5 py-3'>
            <div className='flex items-center justify-between gap-3'>
              <div className='flex min-w-0 items-center gap-2'>
                <div className='bg-muted/60 flex h-9 w-9 shrink-0 items-center justify-center rounded-md'>
                  <Icon className='h-5 w-5' aria-hidden />
                </div>
                <div className='flex min-w-0 flex-col'>
                  <DialogTitle className='truncate text-base font-semibold'>
                    {isEdit
                      ? `Edit ${KIND_LABEL[kind].singular}`
                      : `New ${KIND_LABEL[kind].singular}`}
                  </DialogTitle>
                  <DialogDescription className='text-muted-foreground line-clamp-1 text-xs'>
                    {activeWindow}
                  </DialogDescription>
                </div>
              </div>
              <div className='flex items-center gap-2'>
                <Badge
                  variant='outline'
                  className={cn('text-xs', status.badgeClass)}
                >
                  {status.label}
                </Badge>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  onClick={() => setPreviewVisible((v) => !v)}
                  className='h-8 w-8'
                  aria-label={previewVisible ? 'Hide preview' : 'Show preview'}
                  title='Toggle preview (⌘P)'
                >
                  {previewVisible ? (
                    <IconLayoutSidebar className='h-4 w-4' aria-hidden />
                  ) : (
                    <IconLayoutSidebarRightExpand
                      className='h-4 w-4'
                      aria-hidden
                    />
                  )}
                </Button>
                {templates.length > 0 && (
                  <Select
                    value=''
                    onValueChange={(id) => {
                      const t = templates.find((tt) => tt.id === id)
                      if (!t) return
                      setValues((prev) => ({
                        ...prev,
                        ...t.patch,
                        kindData: {
                          ...prev.kindData,
                          ...((t.patch.kindData ?? {}) as object),
                        },
                      }))
                      setIsDirty(true)
                      toast.success(`Applied "${t.label}" template`)
                    }}
                  >
                    <SelectTrigger className='h-8 w-[180px] gap-1 text-xs'>
                      <IconPlus
                        className='h-3.5 w-3.5 opacity-70'
                        aria-hidden
                      />
                      <SelectValue placeholder='Start from template…' />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem
                          key={t.id}
                          value={t.id}
                          className='flex flex-col items-start gap-0.5'
                        >
                          <span className='text-sm font-medium'>{t.label}</span>
                          <span className='text-muted-foreground text-xs'>
                            {t.description}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='h-8 w-8'
                  onClick={attemptClose}
                  aria-label='Close composer'
                >
                  ×
                </Button>
              </div>
            </div>
          </DialogHeader>

          <form
            data-composer-form='true'
            onSubmit={(e) => void handleSubmit(e)}
            className='flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row'
          >
            {previewVisible && (
              <aside className='border-border/40 bg-muted/20 shrink-0 overflow-y-auto border-b px-4 py-4 md:w-[360px] md:border-r md:border-b-0'>
                <ComposerPreview values={values} />
                <p className='text-muted-foreground mt-3 text-[11px] leading-snug'>
                  Preview reflects unsaved changes. Press <kbd>⌘ P</kbd> to
                  collapse.
                </p>
              </aside>
            )}

            <div className='flex flex-1 flex-col md:min-w-0 md:overflow-hidden'>
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as TabId)}
                className='flex min-h-0 flex-1 flex-col'
              >
                <div className='border-border/40 shrink-0 border-b px-5 pt-3'>
                  <TabsList className='h-9'>
                    <TabsTrigger value='details'>Details</TabsTrigger>
                    <TabsTrigger value='media'>
                      Media
                      {values.attachments.length > 0 && (
                        <span className='bg-muted ml-2 rounded-full px-1.5 py-0.5 text-[10px]'>
                          {values.attachments.length}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value='schedule'>
                      <IconClockHour4
                        className='mr-1 h-3.5 w-3.5'
                        aria-hidden
                      />
                      Schedule
                    </TabsTrigger>
                    <TabsTrigger value='audience'>Audience</TabsTrigger>
                  </TabsList>
                </div>

                <div className='flex-1 overflow-y-auto px-5 py-4'>
                  <TabsContent
                    value='details'
                    className='m-0 flex flex-col gap-4'
                  >
                    <Section
                      title='Headline'
                      description='Shown on the public board card.'
                    >
                      <div className='flex flex-col gap-1.5'>
                        <Label htmlFor='composer-title'>Title</Label>
                        <Input
                          id='composer-title'
                          placeholder='Title'
                          value={values.title}
                          onChange={(e) => patch({ title: e.target.value })}
                          autoFocus={!isEdit}
                          required
                        />
                      </div>
                      <div className='flex flex-col gap-1.5'>
                        <Label htmlFor='composer-body'>
                          Body{' '}
                          <span className='text-muted-foreground text-xs font-normal'>
                            · line breaks preserved
                          </span>
                        </Label>
                        <Textarea
                          id='composer-body'
                          rows={5}
                          placeholder='Body…'
                          value={values.body}
                          onChange={(e) => patch({ body: e.target.value })}
                        />
                      </div>
                    </Section>

                    <Section
                      title='Card layout'
                      description='Choose how this post is displayed on the bento board.'
                    >
                      <BoardCardVariantPicker
                        value={parseCardVariant(
                          (values.kindData as Record<string, unknown>)
                            ?.card_variant
                        )}
                        onChange={(next) => {
                          patch({
                            kindData: {
                              ...(values.kindData as Record<string, unknown>),
                              card_variant: next,
                            } as ComposerValues['kindData'],
                          })
                        }}
                        config={parseVariantConfig(
                          parseCardVariant(
                            (values.kindData as Record<string, unknown>)
                              ?.card_variant
                          ),
                          (values.kindData as Record<string, unknown>)
                            ?.card_variant_config
                        )}
                        onConfigChange={(next: VariantConfig) => {
                          patch({
                            kindData: {
                              ...(values.kindData as Record<string, unknown>),
                              card_variant_config: next as Record<
                                string,
                                unknown
                              >,
                            } as ComposerValues['kindData'],
                          })
                        }}
                      />
                    </Section>

                    {kind !== 'job' && (
                      <Section
                        title='Severity & priority'
                        description='How prominent should this be on the board?'
                      >
                        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                          <div className='flex flex-col gap-1.5'>
                            <Label>Severity</Label>
                            <ToggleGroup
                              type='single'
                              value={values.severity}
                              onValueChange={(v) =>
                                v &&
                                patch({
                                  severity: v as ComposerValues['severity'],
                                })
                              }
                              className='flex flex-wrap justify-start gap-1.5'
                            >
                              {SAFETY_SEVERITIES.map((s) => (
                                <ToggleGroupItem
                                  key={s}
                                  value={s}
                                  className='h-8 px-3 text-xs capitalize'
                                >
                                  {s}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                          </div>
                          <div className='flex flex-col gap-1.5'>
                            <Label>Priority</Label>
                            <ToggleGroup
                              type='single'
                              value={values.priority}
                              onValueChange={(v) =>
                                v &&
                                patch({
                                  priority: v as ComposerValues['priority'],
                                })
                              }
                              className='flex flex-wrap justify-start gap-1.5'
                            >
                              {POST_PRIORITIES.map((p) => (
                                <ToggleGroupItem
                                  key={p}
                                  value={p}
                                  className='h-8 px-3 text-xs capitalize'
                                >
                                  {p}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                          </div>
                        </div>

                        <div className='flex flex-col gap-1.5'>
                          <Label htmlFor='composer-accent'>Accent color</Label>
                          <ColorPickerInput
                            value={values.accentHex ?? ''}
                            onChange={(v) => patch({ accentHex: v || null })}
                          />
                        </div>
                      </Section>
                    )}

                    {kind === 'announcement' && (
                      <AnnouncementSection
                        kindData={values.kindData as AnnouncementKindData}
                        onChange={patchKindData}
                      />
                    )}

                    {kind === 'hr_news' && (
                      <HrNewsSection
                        kindData={values.kindData as HrNewsKindData}
                        onChange={patchKindData}
                      />
                    )}

                    {kind === 'safety_alert' && (
                      <>
                        <Section
                          title='Acknowledgement'
                          description='Require associates to ack before the alert clears for them.'
                        >
                          <div className='border-border/40 bg-background flex items-center justify-between gap-2 rounded-md border p-3'>
                            <div>
                              <Label className='mt-0!'>
                                Require acknowledgement
                              </Label>
                              <p className='text-muted-foreground text-xs'>
                                Adds an &quot;Acknowledge&quot; button on the
                                card.
                              </p>
                            </div>
                            <Switch
                              checked={values.acknowledgmentRequired}
                              onCheckedChange={(v) =>
                                patch({ acknowledgmentRequired: v })
                              }
                            />
                          </div>
                          <div className='flex flex-col gap-1.5'>
                            <Label htmlFor='composer-reprompt'>
                              Re-prompt every N minutes (optional)
                            </Label>
                            <Input
                              id='composer-reprompt'
                              type='number'
                              min={5}
                              max={10080}
                              step={5}
                              placeholder='e.g. 60'
                              value={values.repromptIntervalMinutes ?? ''}
                              onChange={(e) => {
                                const n = Number(e.target.value)
                                patch({
                                  repromptIntervalMinutes:
                                    Number.isFinite(n) && n > 0 ? n : null,
                                })
                              }}
                              disabled={!values.acknowledgmentRequired}
                            />
                            <p className='text-muted-foreground text-xs'>
                              Floor TVs re-pulse the alert at this cadence until
                              each viewer acknowledges. 5–10080 minutes.
                            </p>
                          </div>
                        </Section>
                        <SafetyAlertSection
                          kindData={values.kindData as SafetyAlertKindData}
                          onChange={patchKindData}
                          workingAreaOptions={workingAreas.map((a) => ({
                            id: a.id,
                            label: a.areaName,
                          }))}
                        />
                      </>
                    )}

                    {kind === 'job' && (
                      <JobSection
                        values={values}
                        kindData={values.kindData as JobKindData}
                        onChange={patchKindData}
                        onShellChange={patch}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value='media' className='m-0'>
                    <Section
                      title='Attachments'
                      description='Up to 8 files: photos (JPG/PNG/WEBP/GIF) or PDF.'
                    >
                      <ComposerAttachmentUploader
                        value={values.attachments}
                        onChange={(next) => patch({ attachments: next })}
                        organizationId={organizationId}
                        bucketScope={bucketScope}
                      />
                    </Section>
                  </TabsContent>

                  <TabsContent
                    value='schedule'
                    className='m-0 flex flex-col gap-4'
                  >
                    <Section
                      title='Active window'
                      description='Leave Publish at empty to go live immediately on save.'
                    >
                      <div className='flex flex-col gap-1.5'>
                        <Label>Publish at</Label>
                        <ComposerDateTimePicker
                          value={values.publishAt}
                          onChange={(v) => patch({ publishAt: v })}
                        />
                      </div>
                      <div className='flex flex-col gap-1.5'>
                        <Label>Expires at</Label>
                        <ComposerDateTimePicker
                          value={values.expiresAt}
                          onChange={(v) => patch({ expiresAt: v })}
                          minDate={
                            values.publishAt
                              ? new Date(values.publishAt)
                              : new Date()
                          }
                        />
                        <p className='text-muted-foreground text-xs'>
                          {activeWindow}
                        </p>
                      </div>
                    </Section>

                    <Section
                      title='Publish state'
                      description='Draft posts are visible only to editors with admin filters on.'
                    >
                      <div className='border-border/40 bg-background flex items-center justify-between gap-2 rounded-md border p-3'>
                        <div>
                          <Label className='mt-0!'>Published</Label>
                          <p className='text-muted-foreground text-xs'>
                            Toggle off to keep this as a draft.
                          </p>
                        </div>
                        <Switch
                          checked={values.isPublished}
                          onCheckedChange={(v) => patch({ isPublished: v })}
                        />
                      </div>
                    </Section>
                  </TabsContent>

                  <TabsContent
                    value='audience'
                    className='m-0 flex flex-col gap-4'
                  >
                    <Section
                      title='Where this appears'
                      description='Working area / branch scoping filters the boards.'
                    >
                      {showWorkingAreaControl && (
                        <div className='flex flex-col gap-1.5'>
                          <Label htmlFor='composer-area'>Working area</Label>
                          <Select
                            value={values.workingAreaId ?? NO_SELECTION}
                            onValueChange={(v) =>
                              patch({
                                workingAreaId: v === NO_SELECTION ? null : v,
                              })
                            }
                          >
                            <SelectTrigger id='composer-area'>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_SELECTION}>
                                All areas
                              </SelectItem>
                              {workingAreas.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.areaName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {showBranchControl && (
                        <div className='flex flex-col gap-1.5'>
                          <Label htmlFor='composer-branch'>Branch</Label>
                          <Select
                            value={values.branchId ?? NO_SELECTION}
                            onValueChange={(v) =>
                              patch({
                                branchId: v === NO_SELECTION ? null : v,
                              })
                            }
                          >
                            <SelectTrigger id='composer-branch'>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_SELECTION}>
                                Company-wide
                              </SelectItem>
                              {branches.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                  {b.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {kind === 'job' && (
                        <div className='flex flex-col gap-1.5'>
                          <Label htmlFor='composer-job-branch'>Branch</Label>
                          <Select
                            value={values.branchId ?? NO_SELECTION}
                            onValueChange={(v) =>
                              patch({
                                branchId: v === NO_SELECTION ? null : v,
                              })
                            }
                          >
                            <SelectTrigger id='composer-job-branch'>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_SELECTION}>
                                All branches
                              </SelectItem>
                              {branches.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                  {b.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </Section>
                  </TabsContent>
                </div>

                <DialogFooter className='border-border/40 bg-background shrink-0 gap-2 border-t px-5 py-3 sm:flex-row sm:justify-between'>
                  <div className='flex items-center'>
                    {isEditMode || mode.type === 'edit-job' ? (
                      <Button
                        type='button'
                        variant='destructive'
                        size='sm'
                        disabled={isSaving}
                        onClick={() => setConfirmDeleteOpen(true)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                  <div className='flex items-center gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={attemptClose}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      type='button'
                      variant='secondary'
                      size='sm'
                      disabled={isSaving}
                      onClick={() => {
                        // Force `isPublished=false` on this save path so
                        // the "Save draft" button is meaningful even if
                        // the user previously toggled the Published switch
                        // on. Routes through the same handleSubmit so
                        // validation + mutation + dirty reset all stay
                        // consistent.
                        void handleSubmit(
                          {
                            preventDefault: () => {},
                          } as unknown as FormEvent<HTMLFormElement>,
                          false
                        )
                      }}
                    >
                      Save draft
                    </Button>
                    <Button type='submit' size='sm' disabled={isSaving}>
                      {isEdit ? 'Save changes' : KIND_LABEL[kind].verb}
                    </Button>
                  </div>
                </DialogFooter>
              </Tabs>
            </div>
          </form>
        </ComposerResizableShell>

        <ConfirmDialog
          isOpen={confirmExitOpen}
          title='Discard unsaved changes?'
          message='Your in-progress edits will be lost.'
          variant='warning'
          confirmText='Discard'
          cancelText='Keep editing'
          onCancel={() => setConfirmExitOpen(false)}
          onConfirm={() => {
            setConfirmExitOpen(false)
            setIsDirty(false)
            onClose()
          }}
        />
        <ConfirmDialog
          isOpen={confirmDeleteOpen}
          title={`Delete ${KIND_LABEL[kind].singular}?`}
          message='This permanently removes the post from the board.'
          variant='danger'
          confirmText='Delete'
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={() => {
            void handleDelete()
          }}
          isProcessing={isSaving}
        />
      </DialogContent>
    </Dialog>
  )
}

function renumberAttachments(items: Attachment[]): Attachment[] {
  return items.map((a, idx) => ({ ...a, display_order: idx }))
}

interface PersistPostArgs {
  values: ComposerValues
  scope: PostScope
  mode: ComposerMode
  createPost: ReturnType<typeof useBoardPosts>['createPost']
  updatePost: ReturnType<typeof useBoardPosts>['updatePost']
}

async function persistPost({
  values,
  scope,
  mode,
  createPost,
  updatePost,
}: PersistPostArgs): Promise<void> {
  // The hook layer accepts a superset of fields; new ones (attachments,
  // kindData, priority, isPublished, repromptIntervalMinutes) are
  // forwarded through the same upsert path. See hooks/use-board-posts.ts
  // for the column mapping.
  //
  // `production_board_posts.published_at` is NOT NULL. We default an
  // unset `publishAt` to "now" here (rather than relying on the column's
  // DB-side DEFAULT) so the three lifecycle modes have explicit,
  // testable semantics at the boundary: Publish-now → now, Save-draft →
  // now (`isPublished=false` is what hides it via v_active_board_posts),
  // Scheduled → user's chosen future timestamp.
  const publishedAt = values.publishAt ?? new Date().toISOString()
  const payload = {
    scope,
    title: values.title,
    body: values.body || null,
    severity: values.severity,
    workingAreaId: values.workingAreaId,
    branchId: values.branchId,
    colorHex: values.accentHex,
    imageUrl: values.attachments[0]?.storage_path ?? null,
    publishedAt,
    expiresAt: values.expiresAt,
    isPinned: values.priority === 'pinned',
    acknowledgedRequired: values.acknowledgmentRequired,
    isPublished: values.isPublished,
    priority: values.priority,
    attachments: values.attachments,
    kindData: (values.kindData ?? defaultKindData(scope as PostKind)) as Record<
      string,
      unknown
    >,
    repromptIntervalMinutes: values.repromptIntervalMinutes,
  }
  if (mode.type === 'edit') {
    await updatePost.mutateAsync({
      id: mode.post.id,
      patch: payload,
    })
    return
  }
  await createPost.mutateAsync(payload)
}

interface PersistJobArgs {
  values: ComposerValues
  mode: ComposerMode
  createJob: ReturnType<typeof useJobPostings>['createJob']
  updateJob: ReturnType<typeof useJobPostings>['updateJob']
}

async function persistJob({
  values,
  mode,
  createJob,
  updateJob,
}: PersistJobArgs): Promise<void> {
  // Mirrors the publishedAt defaulting in persistPost — jobs use
  // `posted_at` for the same NOT NULL "when did this go live" slot.
  const postedAt = values.publishAt ?? new Date().toISOString()
  const payload = {
    title: values.title,
    department: values.jobDepartment,
    workingAreaId: values.workingAreaId,
    branchId: values.branchId,
    description: values.body || null,
    requirements: values.jobRequirements,
    applyUrl: values.jobApplyUrl,
    applyEmail: values.jobApplyEmail,
    isInternal: values.jobIsInternal,
    colorHex: values.accentHex,
    closesAt: values.expiresAt,
    postedAt,
    isPublished: values.isPublished,
    priority: values.priority,
    attachments: values.attachments,
    kindData: (values.kindData ?? defaultKindData('job')) as Record<
      string,
      unknown
    >,
  }
  if (mode.type === 'edit-job') {
    await updateJob.mutateAsync({
      id: mode.job.id,
      patch: payload,
    })
    return
  }
  await createJob.mutateAsync(payload)
}

// Created and developed by Jai Singh
