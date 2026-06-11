// Created and developed by Jai Singh
import ContentSection from '../components/content-section'
import { AccountForm } from './account-form'

export default function SettingsAccount() {
  return (
    <ContentSection
      title='Account'
      desc='Update your account settings. Set your preferred language and
          timezone.'
    >
      <AccountForm />
    </ContentSection>
  )
}

// Created and developed by Jai Singh
