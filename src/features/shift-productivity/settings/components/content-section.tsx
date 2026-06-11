// Created and developed by Jai Singh
interface ContentSectionProps {
  title: string
  desc: string
  eyebrow?: string
  actions?: React.ReactNode
  children: React.ReactNode
}

export default function ContentSection({
  title,
  desc,
  eyebrow,
  actions,
  children,
}: ContentSectionProps) {
  return (
    <section className='flex min-h-0 flex-1 flex-col gap-5'>
      <header className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div className='min-w-0'>
          {eyebrow && (
            <p className='text-muted-foreground mb-1 text-[11px] font-semibold tracking-wider uppercase'>
              {eyebrow}
            </p>
          )}
          <h3 className='text-xl font-semibold tracking-tight'>{title}</h3>
          <p className='text-muted-foreground mt-1 max-w-3xl text-sm'>{desc}</p>
        </div>
        {actions && <div className='shrink-0'>{actions}</div>}
      </header>
      <div className='min-w-0'>{children}</div>
    </section>
  )
}

// Created and developed by Jai Singh
