interface Props {
  children: React.ReactNode
}

export default function AuthLayout({ children }: Props) {
  return (
    <div className='bg-primary-foreground container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:w-[480px] sm:p-8'>
        <div className='mb-4 flex flex-col items-center justify-center space-y-4'>
          <div className='relative flex h-48 w-48 items-center justify-center overflow-hidden'>
            {/* Ripple Effect Rings - Starting from logo size and expanding outward */}
            <div className='absolute h-24 w-24 rounded-full border-2 border-blue-500/40 motion-safe:animate-[ripple_2.5s_ease-out_infinite]'></div>
            <div className='absolute h-24 w-24 rounded-full border-2 border-blue-400/30 motion-safe:animate-[ripple_2.5s_ease-out_infinite] motion-safe:[animation-delay:0.5s]'></div>
            <div className='absolute h-24 w-24 rounded-full border-2 border-blue-300/25 motion-safe:animate-[ripple_2.5s_ease-out_infinite] motion-safe:[animation-delay:1s]'></div>
            <div className='absolute h-24 w-24 rounded-full border-2 border-blue-200/20 motion-safe:animate-[ripple_2.5s_ease-out_infinite] motion-safe:[animation-delay:1.5s]'></div>

            {/* Main Logo */}
            <img
              src='/images/favicon.svg'
              alt='OmniFrame Logo'
              className='relative z-10 h-24 w-24 motion-safe:animate-[pulse_6s_ease-in-out_infinite] motion-safe:animate-[spin_3s_linear_infinite]'
            />
          </div>
          <h1 className='text-xl font-medium'>OmniFrame</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
