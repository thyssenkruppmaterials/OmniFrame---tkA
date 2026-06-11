// Created and developed by Jai Singh
import { useState } from 'react'
import {
  IconActivity,
  IconApi,
  IconBell,
  IconClipboardList,
  IconDatabase,
  IconGauge,
  IconMail,
  IconPlugConnected,
  IconShield,
  IconTool,
  IconUser,
} from '@tabler/icons-react'
import { TabMenu } from '@/components/ui/tab-menu'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { APIConfigurationSettings } from './components/APIConfigurationSettings'
import { BackupRecoverySettings } from './components/BackupRecoverySettings'
import { EmailSettings } from './components/EmailSettings'
import { IntegrationSettings } from './components/IntegrationSettings'
import { LoggingAuditingSettings } from './components/LoggingAuditingSettings'
import { PerformanceSettings } from './components/PerformanceSettings'
import { SecuritySettings } from './components/SecuritySettings'
import { ServiceMonitoringSettings } from './components/ServiceMonitoringSettings'
import { SystemMaintenanceSettings } from './components/SystemMaintenanceSettings'
import { ToastNotificationSettingsEnhanced } from './components/ToastNotificationSettings-Enhanced'
import { UserDefaultsSettings } from './components/UserDefaultsSettings'

const systemSettingsTabs = [
  { id: 'toast-notifications', label: 'Toast Notifications' },
  { id: 'email-settings', label: 'Email Settings' },
  { id: 'security-settings', label: 'Security Settings' },
  { id: 'system-maintenance', label: 'System Maintenance' },
  { id: 'integration-settings', label: 'Integration Settings' },
  { id: 'performance-settings', label: 'Performance Settings' },
  { id: 'backup-recovery', label: 'Backup & Recovery' },
  { id: 'user-defaults', label: 'User Defaults' },
  { id: 'logging-auditing', label: 'Logging & Auditing' },
  { id: 'service-monitoring', label: 'Service Monitoring' },
  { id: 'api-configuration', label: 'API Configuration' },
]

/**
 * System Settings Page - Admin-only system-wide configuration settings
 */
export function SystemSettingsPage() {
  const [activeTab, setActiveTab] = useState('toast-notifications')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'toast-notifications':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconBell size={20} />
              Toast Notifications
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure toast notification settings for the entire system.
            </p>
            <ToastNotificationSettingsEnhanced />
          </div>
        )
      case 'email-settings':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconMail size={20} />
              Email Settings
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure email settings for the entire system.
            </p>
            <EmailSettings />
          </div>
        )
      case 'security-settings':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconShield size={20} />
              Security Settings
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure security settings for the entire system.
            </p>
            <SecuritySettings />
          </div>
        )
      case 'system-maintenance':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconTool size={20} />
              System Maintenance
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure system maintenance settings for the entire system.
            </p>
            <SystemMaintenanceSettings />
          </div>
        )
      case 'integration-settings':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconPlugConnected size={20} />
              Integration Settings
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure integration settings for the entire system.
            </p>
            <IntegrationSettings />
          </div>
        )
      case 'performance-settings':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconGauge size={20} />
              Performance Settings
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure performance settings for the entire system.
            </p>
            <PerformanceSettings />
          </div>
        )
      case 'backup-recovery':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconDatabase size={20} />
              Backup & Recovery
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure backup & recovery settings for the entire system.
            </p>
            <BackupRecoverySettings />
          </div>
        )
      case 'user-defaults':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconUser size={20} />
              User Defaults
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure user defaults settings for the entire system.
            </p>
            <UserDefaultsSettings />
          </div>
        )
      case 'logging-auditing':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconClipboardList size={20} />
              Logging & Auditing
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure logging & auditing settings for the entire system.
            </p>
            <LoggingAuditingSettings />
          </div>
        )
      case 'service-monitoring':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconActivity size={20} />
              Service Monitoring
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Live Railway service logs, deployment status, and error tracking.
            </p>
            <ServiceMonitoringSettings />
          </div>
        )
      case 'api-configuration':
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconApi size={20} />
              API Configuration
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure API configuration settings for the entire system.
            </p>
            <APIConfigurationSettings />
          </div>
        )
      default:
        return (
          <div className='space-y-4'>
            <h3 className='flex items-center gap-2 text-xl font-semibold'>
              <IconBell size={20} />
              Toast Notifications
            </h3>
            <p className='text-muted-foreground mb-6 text-sm'>
              Configure toast notification settings for the entire system.
            </p>
            <ToastNotificationSettingsEnhanced />
          </div>
        )
    }
  }

  return (
    <>
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-2 flex flex-wrap items-center justify-between space-y-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              System Settings
            </h2>
            <p className='text-muted-foreground'>
              Configure system-wide settings and manage global application
              preferences.
            </p>
          </div>
        </div>

        <div className='space-y-6'>
          <TabMenu
            tabs={systemSettingsTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showHiddenTabs={true}
            fallbackTab='toast-notifications'
          />

          <div className='bg-background rounded-lg border p-6'>
            {renderTabContent()}
          </div>
        </div>
      </Main>
    </>
  )
}

// Created and developed by Jai Singh
