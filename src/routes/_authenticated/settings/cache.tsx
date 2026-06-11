// Created and developed by Jai Singh
import { createFileRoute } from '@tanstack/react-router'
import CacheManagement from '@/components/settings/cache-management'
import ContentSection from '@/features/settings/components/content-section'

export const Route = createFileRoute('/_authenticated/settings/cache')({
  component: SettingsCache,
})

function SettingsCache() {
  return (
    <ContentSection
      title='Cache Management'
      desc='Manage browser caches and resolve caching issues that may prevent you from seeing the latest version of OmniFrame.'
    >
      <CacheManagement />
    </ContentSection>
  )
}

// Created and developed by Jai Singh
