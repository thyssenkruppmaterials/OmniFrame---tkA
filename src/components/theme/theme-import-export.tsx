import { useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Clipboard,
  Download,
  FileUp,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  validateImportPayload,
  type AppearancePreferencesV2,
} from '@/lib/theme/appearance-preferences'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

interface ThemeImportExportProps {
  currentPrefs: AppearancePreferencesV2
  onImport: (prefs: AppearancePreferencesV2) => void
  className?: string
}

export function ThemeImportExport({
  currentPrefs,
  onImport,
  className,
}: ThemeImportExportProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [pendingImport, setPendingImport] =
    useState<AppearancePreferencesV2 | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleCopyToClipboard = async () => {
    const json = JSON.stringify(currentPrefs, null, 2)
    await navigator.clipboard.writeText(json)
    toast.success('Theme JSON copied to clipboard.')
  }

  const handleDownloadFile = () => {
    const json = JSON.stringify(currentPrefs, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `omniframe-theme-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Theme file downloaded.')
  }

  const processImport = (raw: string) => {
    setImportError(null)
    try {
      const parsed = JSON.parse(raw)
      const result = validateImportPayload(parsed)
      if (!result.valid) {
        setImportError(result.error)
        return
      }
      setPendingImport(result.prefs)
      setShowConfirm(true)
    } catch {
      setImportError('Invalid JSON format.')
    }
  }

  const handlePasteImport = () => {
    const text = textareaRef.current?.value
    if (!text?.trim()) {
      setImportError('Paste your theme JSON first.')
      return
    }
    processImport(text)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      processImport(text)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const confirmImport = () => {
    if (pendingImport) {
      onImport(pendingImport)
      toast.success('Theme imported. Click Apply to save.')
    }
    setShowConfirm(false)
    setPendingImport(null)
    if (textareaRef.current) textareaRef.current.value = ''
  }

  const diffSummary = pendingImport
    ? computeDiffSummary(currentPrefs, pendingImport)
    : []

  return (
    <>
      <Card className={className}>
        <CardHeader>
          <CardTitle className='text-base'>Import & Export</CardTitle>
          <CardDescription>Share or back up your theme settings</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {/* Export */}
          <div className='space-y-3'>
            <Label className='text-sm font-medium'>Export</Label>
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={handleCopyToClipboard}
              >
                <Clipboard className='mr-1.5 h-3.5 w-3.5' />
                Copy to Clipboard
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={handleDownloadFile}
              >
                <Download className='mr-1.5 h-3.5 w-3.5' />
                Download File
              </Button>
            </div>
          </div>

          <Separator />

          {/* Import */}
          <div className='space-y-3'>
            <Label className='text-sm font-medium'>Import</Label>
            <textarea
              ref={textareaRef}
              placeholder='Paste your theme JSON here...'
              className='border-input bg-background ring-ring/10 h-28 w-full rounded-md border px-3 py-2 font-mono text-xs focus:ring-2 focus:outline-none'
            />
            {importError && (
              <p className='flex items-center gap-1.5 text-sm text-red-500'>
                <AlertTriangle className='h-3.5 w-3.5' />
                {importError}
              </p>
            )}
            <div className='flex flex-wrap gap-2'>
              <Button variant='outline' size='sm' onClick={handlePasteImport}>
                <Upload className='mr-1.5 h-3.5 w-3.5' />
                Import from Paste
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className='mr-1.5 h-3.5 w-3.5' />
                Upload File
              </Button>
              <input
                ref={fileInputRef}
                type='file'
                accept='.json'
                onChange={handleFileUpload}
                className='hidden'
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import Theme?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace your current draft with the imported theme.
              You'll still need to click Apply to save.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {diffSummary.length > 0 && (
            <div className='bg-muted/50 max-h-40 overflow-y-auto rounded-md p-3'>
              <p className='mb-2 text-xs font-medium'>Changes:</p>
              <ul className='space-y-1'>
                {diffSummary.map((change, i) => (
                  <li key={i} className='text-muted-foreground text-xs'>
                    {change}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport}>
              <Check className='mr-1.5 h-3.5 w-3.5' />
              Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function computeDiffSummary(
  current: AppearancePreferencesV2,
  incoming: AppearancePreferencesV2
): string[] {
  const changes: string[] = []

  if (current.theme !== incoming.theme)
    changes.push(`Theme: ${current.theme} → ${incoming.theme}`)
  if (current.customBehavior !== incoming.customBehavior)
    changes.push(
      `Custom behavior: ${current.customBehavior} → ${incoming.customBehavior}`
    )
  if (current.font !== incoming.font)
    changes.push(`Font: ${current.font} → ${incoming.font}`)
  if (current.radius !== incoming.radius)
    changes.push(`Radius: ${current.radius} → ${incoming.radius}`)

  for (const mode of ['light', 'dark'] as const) {
    const cur = current.customPalettes[mode]
    const inc = incoming.customPalettes[mode]
    let tokenChanges = 0
    for (const key of Object.keys(cur) as (keyof typeof cur)[]) {
      if (cur[key] !== inc[key]) tokenChanges++
    }
    if (tokenChanges > 0) {
      changes.push(`${mode} palette: ${tokenChanges} color${tokenChanges > 1 ? 's' : ''} changed`)
    }
  }

  return changes
}
