// Created and developed by Jai Singh
import { CinematicLogo, MachineTitle } from '@/components/ui/cinematic-logo'

interface Props {
  children: React.ReactNode
}

export default function AuthLayout({ children }: Props) {
  return (
    <div className='bg-primary-foreground container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:w-[480px] sm:p-8'>
        <div className='mb-4 flex flex-col items-center justify-center space-y-4'>
          <CinematicLogo />
          <MachineTitle />
        </div>
        {children}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
