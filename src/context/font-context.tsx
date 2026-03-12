import React, { createContext, useContext, useEffect, useState } from 'react'
import { fonts } from '@/config/fonts'

type Font = (typeof fonts)[number]

interface FontContextType {
  font: Font
  setFont: (font: Font) => void
}

const FontContext = createContext<FontContextType | undefined>(undefined)

export const FONT_FAMILY_MAP: Record<string, string> = {
  inter: "'Inter', sans-serif",
  manrope: "'Manrope', sans-serif",
  geist: "'Geist', sans-serif",
  'plus-jakarta-sans': "'Plus Jakarta Sans', sans-serif",
  'dm-sans': "'DM Sans', sans-serif",
  system: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
}

export const FontProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [font, _setFont] = useState<Font>(() => {
    const savedFont = localStorage.getItem('font')
    return fonts.includes(savedFont as Font) ? (savedFont as Font) : fonts[0]
  })

  useEffect(() => {
    const root = document.documentElement
    const family = FONT_FAMILY_MAP[font] || "'Inter', sans-serif"
    root.style.setProperty('font-family', family)
  }, [font])

  const setFont = (font: Font) => {
    localStorage.setItem('font', font)
    _setFont(font)
  }

  return <FontContext value={{ font, setFont }}>{children}</FontContext>
}

export const useFont = () => {
  const context = useContext(FontContext)
  if (!context) {
    throw new Error('useFont must be used within a FontProvider')
  }
  return context
}
