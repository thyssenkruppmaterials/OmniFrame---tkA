import { AppearanceForm } from './appearance-form'

export default function SettingsAppearance() {
  return (
    <div className='flex flex-1 flex-col'>
      <div className='flex-none'>
        <h3 className='text-lg font-medium'>Appearance</h3>
        <p className='text-muted-foreground text-sm'>
          Customize the look and feel of your workspace. Changes are previewed
          live and applied when you save.
        </p>
      </div>
      <div className='separator my-4 flex-none border-b' />
      <div className='flex-1 overflow-y-auto pb-12 pr-2'>
        <AppearanceForm />
      </div>
    </div>
  )
}
