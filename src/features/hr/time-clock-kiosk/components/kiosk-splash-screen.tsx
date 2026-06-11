// Created and developed by Jai Singh
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface KioskSplashScreenProps {
  onComplete: () => void
  minimumDuration?: number
}

const PARTICLE_COUNT = 24

function generateParticles() {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    delay: Math.random() * 2,
    duration: Math.random() * 4 + 3,
    opacity: Math.random() * 0.4 + 0.1,
  }))
}

const particles = generateParticles()

export default function KioskSplashScreen({
  onComplete,
  minimumDuration = 3200,
}: KioskSplashScreenProps) {
  const [phase, setPhase] = useState<'enter' | 'hold' | 'exit'>('enter')
  const [visible, setVisible] = useState(true)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    const holdTimer = setTimeout(() => setPhase('hold'), 400)
    const exitTimer = setTimeout(() => {
      setPhase('exit')
      setTimeout(() => {
        setVisible(false)
        onCompleteRef.current()
      }, 800)
    }, minimumDuration)
    return () => {
      clearTimeout(holdTimer)
      clearTimeout(exitTimer)
    }
  }, [minimumDuration])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key='splash'
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
          className='fixed inset-0 z-9999 flex items-center justify-center overflow-hidden'
          style={{ background: '#06060a' }}
        >
          {/* Radial gradient backdrop */}
          <div
            className='absolute inset-0'
            style={{
              background:
                'radial-gradient(ellipse 60% 50% at 50% 45%, rgba(59,130,246,0.08) 0%, rgba(6,6,10,0) 70%)',
            }}
          />

          {/* Floating particles */}
          {particles.map((p) => (
            <motion.div
              key={p.id}
              className='absolute rounded-full'
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                height: p.size,
                background: `rgba(147, 180, 255, ${p.opacity})`,
              }}
              initial={{ opacity: 0, y: 0 }}
              animate={{
                opacity: [0, p.opacity, 0],
                y: [0, -40 - Math.random() * 60],
              }}
              transition={{
                duration: p.duration,
                delay: p.delay,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ))}

          {/* Main content container */}
          <motion.div
            className='relative flex flex-col items-center gap-0'
            animate={
              phase === 'exit'
                ? { scale: 1.1, opacity: 0, filter: 'blur(8px)' }
                : { scale: 1, opacity: 1, filter: 'blur(0px)' }
            }
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Outer glow ring */}
            <motion.div
              className='absolute'
              style={{
                width: 200,
                height: 200,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(59,130,246,0.12) 0%, rgba(59,130,246,0) 70%)',
              }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0, 1.8, 1.5], opacity: [0, 0.8, 0.4] }}
              transition={{ duration: 2, ease: 'easeOut', delay: 0.2 }}
            />

            {/* Orbiting ring */}
            <motion.div
              className='absolute'
              style={{
                width: 140,
                height: 140,
                borderRadius: '50%',
                border: '1px solid rgba(147, 180, 255, 0.15)',
              }}
              initial={{ scale: 0, opacity: 0, rotate: 0 }}
              animate={{ scale: 1, opacity: 1, rotate: 360 }}
              transition={{
                scale: { duration: 1.2, ease: 'easeOut', delay: 0.3 },
                opacity: { duration: 1.2, ease: 'easeOut', delay: 0.3 },
                rotate: {
                  duration: 12,
                  ease: 'linear',
                  repeat: Infinity,
                },
              }}
            >
              <motion.div
                className='absolute -top-[3px] left-1/2 -translate-x-1/2'
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'rgba(147, 180, 255, 0.6)',
                  boxShadow: '0 0 12px 3px rgba(99, 149, 255, 0.4)',
                }}
              />
            </motion.div>

            {/* Logo container with glow */}
            <motion.div
              className='relative z-10 mb-8'
              initial={{ scale: 0.3, opacity: 0, rotate: -90 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{
                duration: 1.2,
                ease: [0.22, 1, 0.36, 1],
                delay: 0.1,
              }}
            >
              <motion.div
                className='absolute inset-0 rounded-3xl'
                style={{
                  background:
                    'radial-gradient(circle, rgba(59,130,246,0.3) 0%, transparent 70%)',
                  filter: 'blur(20px)',
                }}
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{
                  duration: 3,
                  ease: 'easeInOut',
                  repeat: Infinity,
                }}
              />
              <motion.img
                src='/images/OneBoxLogoX.png'
                alt='OmniFrame'
                className='relative h-20 w-20 object-contain drop-shadow-2xl'
                animate={{ rotate: 360 }}
                transition={{
                  duration: 8,
                  ease: 'linear',
                  repeat: Infinity,
                }}
              />
            </motion.div>

            {/* Brand name */}
            <motion.div className='relative z-10 flex flex-col items-center'>
              <motion.h1
                className='bg-linear-to-r from-white via-blue-100 to-white bg-clip-text text-4xl font-bold tracking-tight text-transparent'
                initial={{ opacity: 0, y: 20, letterSpacing: '0.3em' }}
                animate={{ opacity: 1, y: 0, letterSpacing: '0.05em' }}
                transition={{
                  duration: 1,
                  ease: [0.22, 1, 0.36, 1],
                  delay: 0.5,
                }}
              >
                OmniFrame
              </motion.h1>

              {/* Decorative line */}
              <motion.div
                className='mt-3 h-px rounded-full'
                style={{
                  background:
                    'linear-gradient(90deg, transparent, rgba(147,180,255,0.5), transparent)',
                }}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 180, opacity: 1 }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: 1.0 }}
              />

              {/* Subtitle */}
              <motion.p
                className='mt-3 text-sm font-medium tracking-[0.25em] uppercase'
                style={{ color: 'rgba(147, 180, 255, 0.7)' }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: 1.2 }}
              >
                Employee Time Clock
              </motion.p>
            </motion.div>

            {/* Loading indicator */}
            <motion.div
              className='mt-12 flex flex-col items-center gap-3'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.6, duration: 0.6 }}
            >
              {/* Dot pulse loader */}
              <div className='flex items-center gap-2'>
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className='rounded-full'
                    style={{
                      width: 5,
                      height: 5,
                      background: 'rgba(147, 180, 255, 0.6)',
                    }}
                    animate={{
                      scale: [1, 1.6, 1],
                      opacity: [0.4, 1, 0.4],
                    }}
                    transition={{
                      duration: 1.2,
                      delay: i * 0.2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                ))}
              </div>

              <motion.p
                className='text-xs font-medium tracking-widest uppercase'
                style={{ color: 'rgba(255,255,255,0.25)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2.0, duration: 0.5 }}
              >
                Initializing
              </motion.p>
            </motion.div>
          </motion.div>

          {/* Bottom gradient bar */}
          <motion.div
            className='absolute bottom-0 left-0 h-1'
            style={{
              background:
                'linear-gradient(90deg, rgba(59,130,246,0.8), rgba(147,180,255,0.9), rgba(59,130,246,0.8))',
              boxShadow: '0 0 20px 2px rgba(59,130,246,0.3)',
            }}
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{
              duration: minimumDuration / 1000 - 0.5,
              ease: [0.4, 0, 0.2, 1],
              delay: 0.3,
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Created and developed by Jai Singh
