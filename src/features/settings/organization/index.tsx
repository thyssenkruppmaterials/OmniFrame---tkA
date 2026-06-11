// Created and developed by Jai Singh
import ContentSection from '../components/content-section'
import { OrganizationForm } from './organization-form'

export default function OrganizationSettings() {
  return (
    <ContentSection
      title='Organization'
      desc='Configure organization-wide settings including default user roles.'
    >
      <OrganizationForm />
    </ContentSection>
  )
}

// Created and developed by Jai Singh
