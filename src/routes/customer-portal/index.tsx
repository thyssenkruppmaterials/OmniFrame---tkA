// Created and developed by Jai Singh
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { TabMenu } from '@/components/ui/tab-menu'
import { PublicHeader } from '@/components/customer-portal/PublicHeader'
import { TicketCreateForm } from '@/components/customer-portal/TicketCreateForm'
import { TicketLookupForm } from '@/components/customer-portal/TicketLookupForm'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'

const portalTabs = [
  { id: 'lookup', label: 'Find My Tickets' },
  { id: 'create', label: 'Create Ticket' },
]

function CustomerPortalLanding() {
  const [activeTab, setActiveTab] = useState('lookup')

  return (
    <>
      <PublicHeader fixed>
        <div className='flex items-center space-x-4'>
          <h1 className='text-lg font-semibold'>OmniFrame Support Portal</h1>
        </div>
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
        </div>
      </PublicHeader>

      <Main>
        <div className='mb-6 flex flex-wrap items-center justify-between space-y-2'>
          <div>
            <h2 className='text-3xl font-bold tracking-tight'>
              Customer Support Portal
            </h2>
            <p className='text-muted-foreground mt-2'>
              Submit support tickets and track your existing requests
            </p>
          </div>
        </div>

        <div className='space-y-4'>
          <TabMenu
            tabs={portalTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showHiddenTabs={true}
            fallbackTab='lookup'
          />

          <div className='bg-background rounded-lg border p-4'>
            {activeTab === 'lookup' && (
              <div className='space-y-4'>
                <div>
                  <h3 className='mb-2 text-xl font-semibold'>
                    Find Your Tickets
                  </h3>
                  <p className='text-muted-foreground text-sm'>
                    Enter your email address or customer ID to view your support
                    tickets
                  </p>
                </div>
                <TicketLookupForm />
              </div>
            )}

            {activeTab === 'create' && (
              <div className='space-y-4'>
                <div>
                  <h3 className='mb-2 text-xl font-semibold'>
                    Create a Support Ticket
                  </h3>
                  <p className='text-muted-foreground text-sm'>
                    Fill out the form below to submit a new support request
                  </p>
                </div>
                <TicketCreateForm />
              </div>
            )}
          </div>
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute('/customer-portal/')({
  component: CustomerPortalLanding,
})

// Created and developed by Jai Singh
