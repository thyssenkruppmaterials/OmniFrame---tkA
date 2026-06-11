// Created and developed by Jai Singh
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { uploadCycleCountEvidencePhotos } from '../cycle-count-photos.service'

/**
 * Exercises `uploadCycleCountEvidencePhotos`'s batching / partial-success
 * behavior with a stubbed Supabase client.
 */

const storageUpload = vi.fn()
const storageGetPublicUrl = vi.fn()
const rowSelect = vi.fn()
const rowUpdate = vi.fn()
const tableEqSelect = vi.fn()
const tableEqUpdate = vi.fn()
const tableMaybeSingle = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        upload: storageUpload,
        getPublicUrl: storageGetPublicUrl,
      })),
    },
    from: vi.fn(() => ({
      select: rowSelect,
      update: rowUpdate,
    })),
  },
}))

function makeFile(name: string, type = 'image/jpeg', size = 1024): File {
  const blob = new Blob(['x'.repeat(size)], { type })
  return new File([blob], name, { type })
}

describe('uploadCycleCountEvidencePhotos', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // .from('rr_cyclecount_data').select('evidence_photo_urls').eq('id', X).maybeSingle()
    tableMaybeSingle.mockResolvedValue({
      data: { evidence_photo_urls: ['https://existing/old.jpg'] },
      error: null,
    })
    tableEqSelect.mockReturnValue({ maybeSingle: tableMaybeSingle })
    rowSelect.mockReturnValue({ eq: tableEqSelect })

    // .from('rr_cyclecount_data').update({...}).eq('id', X)
    tableEqUpdate.mockResolvedValue({ error: null })
    rowUpdate.mockReturnValue({ eq: tableEqUpdate })

    storageUpload.mockResolvedValue({ error: null })
    storageGetPublicUrl.mockImplementation((path: string) => ({
      data: { publicUrl: `https://bucket/${path}` },
    }))
  })

  it('returns empty arrays when called with no files', async () => {
    const out = await uploadCycleCountEvidencePhotos({
      files: [],
      taskId: 't',
      organizationId: 'o',
    })
    expect(out.uploaded).toEqual([])
    expect(out.failed).toEqual([])
    expect(storageUpload).not.toHaveBeenCalled()
    expect(rowUpdate).not.toHaveBeenCalled()
  })

  it('rejects non-image files and oversize files', async () => {
    const files = [
      makeFile('a.jpg'),
      makeFile('doc.pdf', 'application/pdf'),
      makeFile('huge.jpg', 'image/jpeg', 6 * 1024 * 1024),
    ]
    const out = await uploadCycleCountEvidencePhotos({
      files,
      taskId: 't',
      organizationId: 'o',
    })
    expect(out.uploaded).toHaveLength(1)
    expect(out.failed).toHaveLength(2)
    expect(out.failed.map((f) => f.file.name).sort()).toEqual([
      'doc.pdf',
      'huge.jpg',
    ])
  })

  it('uploads successful files and merges URLs atomically', async () => {
    const files = [makeFile('a.jpg'), makeFile('b.jpg')]
    const out = await uploadCycleCountEvidencePhotos({
      files,
      taskId: 'task-123',
      organizationId: 'org-xyz',
    })
    expect(out.uploaded).toHaveLength(2)
    expect(out.failed).toHaveLength(0)
    expect(storageUpload).toHaveBeenCalledTimes(2)
    expect(rowUpdate).toHaveBeenCalledTimes(1)
    const updatePayload = rowUpdate.mock.calls[0][0] as {
      evidence_photo_urls: string[]
    }
    // Merges with existing URLs and dedupes via Set.
    expect(updatePayload.evidence_photo_urls).toHaveLength(3)
    expect(updatePayload.evidence_photo_urls[0]).toBe(
      'https://existing/old.jpg'
    )
  })

  it('skips the row update when no files uploaded successfully', async () => {
    const files = [makeFile('doc.pdf', 'application/pdf')]
    await uploadCycleCountEvidencePhotos({
      files,
      taskId: 't',
      organizationId: 'o',
    })
    expect(storageUpload).not.toHaveBeenCalled()
    expect(rowUpdate).not.toHaveBeenCalled()
  })

  it('returns per-file errors when upload fails in storage', async () => {
    storageUpload.mockResolvedValueOnce({ error: new Error('network') })
    storageUpload.mockResolvedValueOnce({ error: null })
    const files = [makeFile('a.jpg'), makeFile('b.jpg')]
    const out = await uploadCycleCountEvidencePhotos({
      files,
      taskId: 't',
      organizationId: 'o',
    })
    expect(out.uploaded).toHaveLength(1)
    expect(out.failed).toHaveLength(1)
    expect(out.failed[0].error.message).toBe('network')
    // Still writes the successful URL.
    expect(rowUpdate).toHaveBeenCalledTimes(1)
  })
})

// Created and developed by Jai Singh
