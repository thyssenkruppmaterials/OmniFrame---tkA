// Created and developed by Jai Singh
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { CinematicLogo } from '@/components/ui/cinematic-logo'
import { Typewriter } from '@/components/ui/typewriter'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

export default function Dashboard() {
  const { authState } = useUnifiedAuth()
  const { user, profile } = authState

  // Generate user display name with fallbacks (matching ProfileDropdown pattern)
  const getUserDisplayName = () => {
    if (profile?.full_name) return profile.full_name
    if (profile?.first_name && profile?.last_name) {
      return `${profile.first_name} ${profile.last_name}`.trim()
    }
    if (profile?.first_name) return profile.first_name
    if (profile?.username) return profile.username
    if (user?.email) return user.email.split('@')[0]
    return 'Guest User'
  }

  const displayName = getUserDisplayName()

  // Typewriter messages with user's name
  const typewriterMessages = [
    `Welcome ${displayName}`,
    'to OmniFrame',
    'Single Solution Provider',
    'Super Intelligent',
  ]

  return (
    <>
      {/* ===== Top Heading ===== */}
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      {/* ===== Main Welcome Content ===== */}
      <Main>
        <div className='flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center space-y-8 px-4'>
          <div className='flex justify-center'>
            <CinematicLogo />
          </div>

          {/* Typewriter Welcome Message */}
          <div className='text-center'>
            <Typewriter
              text={typewriterMessages}
              className='text-foreground text-2xl font-bold lg:text-4xl'
              speed={35}
              initialDelay={1000}
              waitTime={3000}
              deleteSpeed={35}
              loop={true}
              showCursor={true}
              cursorChar='|'
              cursorClassName='ml-2 text-primary animate-pulse'
            />
          </div>

          {/* Subtitle */}
          <div className='max-w-2xl text-center'>
            <p className='text-muted-foreground text-lg leading-relaxed'>
              Welcome to your unified logistics and warehouse management
              platform. Everything you need in one place.
            </p>
          </div>
        </div>
      </Main>
    </>
  )
}

// Created and developed by Jai Singh
