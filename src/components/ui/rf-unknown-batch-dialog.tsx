// Created and developed by Jai Singh
/**
 * RF Unknown Batch Dialog Component
 *
 * Multi-step dialog for capturing information about batches not in rr_sq01_data
 * Includes material number, serial number, notes, and photo capture
 */
import React, { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Camera,
  CheckCircle,
  FileText,
  Loader2,
  Package,
  ScanBarcode,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { QWERTYKeyboard } from '@/components/ui/qwerty-keyboard'
import { ScannerInput } from '@/components/ui/scanner-input'
import { Textarea } from '@/components/ui/textarea'

interface UnknownBatchData {
  batchNumber: string
  materialNumber: string
  serialNumber: string
  notes: string
  photo: File | null
}

interface RFUnknownBatchDialogProps {
  isOpen: boolean
  onClose: () => void
  batchNumber: string
  location: string
  onComplete: (data: UnknownBatchData) => Promise<void>
}

export const RFUnknownBatchDialog: React.FC<RFUnknownBatchDialogProps> = ({
  isOpen,
  onClose,
  batchNumber,
  location,
  onComplete,
}) => {
  const [currentStep, setCurrentStep] = useState(1)
  const [isProcessing, setIsProcessing] = useState(false)
  const [useKeyboard, setUseKeyboard] = useState(false)

  const [formData, setFormData] = useState<UnknownBatchData>({
    batchNumber: batchNumber,
    materialNumber: '',
    serialNumber: '',
    notes: '',
    photo: null,
  })

  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const materialInputRef = useRef<HTMLInputElement>(null)
  const serialInputRef = useRef<HTMLInputElement>(null)

  // Steps configuration
  const steps = [
    {
      id: 1,
      title: 'Material',
      icon: Package,
      description: 'Scan or type material number',
    },
    {
      id: 2,
      title: 'Serial',
      icon: ScanBarcode,
      description: 'Enter serial number',
    },
    {
      id: 3,
      title: 'Notes',
      icon: FileText,
      description: 'Additional information',
    },
    { id: 4, title: 'Photo', icon: Camera, description: 'Capture box photo' },
  ]

  // Animation variants
  const contentVariants = {
    hidden: { opacity: 0, x: 50 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -50, transition: { duration: 0.3 } },
  }

  const handleFieldChange = (
    field: keyof UnknownBatchData,
    value: string | File | null
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file')
        return
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image must be less than 5MB')
        return
      }

      handleFieldChange('photo', file)

      // Create preview
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)

      toast.success('Photo captured')
    }
  }

  const handleNext = () => {
    // Validation for each step
    if (currentStep === 1 && !formData.materialNumber.trim()) {
      toast.error('Please enter material number')
      return
    }

    if (currentStep < 4) {
      setCurrentStep(currentStep + 1)
      setUseKeyboard(false) // Reset keyboard on next step
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
      setUseKeyboard(false)
    }
  }

  const handleSubmit = async () => {
    setIsProcessing(true)

    try {
      await onComplete(formData)

      // Reset form
      setFormData({
        batchNumber: '',
        materialNumber: '',
        serialNumber: '',
        notes: '',
        photo: null,
      })
      setPhotoPreview(null)
      setCurrentStep(1)
      setUseKeyboard(false)
    } catch (error: unknown) {
      logger.error('Error submitting unknown batch:', error)
      toast.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      batchNumber: '',
      materialNumber: '',
      serialNumber: '',
      notes: '',
      photo: null,
    })
    setPhotoPreview(null)
    setCurrentStep(1)
    setUseKeyboard(false)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className='flex max-h-[90vh] max-w-md flex-col'>
        <DialogHeader>
          <DialogTitle className='flex items-center space-x-2'>
            <AlertCircle className='h-5 w-5 text-orange-500' />
            <span>Unknown Batch Found</span>
          </DialogTitle>
          <DialogDescription>
            Batch {batchNumber} not found in system. Please provide details.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className='py-2'>
          <div className='flex items-center justify-between'>
            {steps.map((step, index) => {
              const StepIcon = step.icon
              const isActive = currentStep === step.id
              const isCompleted = currentStep > step.id

              return (
                <div key={step.id} className='flex items-center'>
                  <div
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors',
                      isActive &&
                        'bg-primary border-primary text-primary-foreground',
                      isCompleted &&
                        'bg-primary border-primary text-primary-foreground',
                      !isActive && !isCompleted && 'border-muted bg-background'
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle className='h-3 w-3' />
                    ) : (
                      <StepIcon className='h-3 w-3' />
                    )}
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={cn(
                        'mx-0.5 h-0.5 w-6 transition-colors',
                        isCompleted ? 'bg-primary' : 'bg-muted'
                      )}
                    />
                  )}
                </div>
              )
            })}
          </div>
          <div className='mt-1 flex justify-between'>
            {steps.map((step) => (
              <span key={step.id} className='text-muted-foreground text-[10px]'>
                {step.title}
              </span>
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className='flex-1 overflow-y-auto'>
          <AnimatePresence mode='wait'>
            <motion.div
              key={currentStep}
              variants={contentVariants}
              initial='hidden'
              animate='visible'
              exit='exit'
              className='space-y-4'
            >
              {/* Step 1: Material Number */}
              {currentStep === 1 && (
                <div className='space-y-4'>
                  <Card className='border-orange-200 bg-orange-50 dark:bg-orange-950/20'>
                    <CardContent className='p-3'>
                      <p className='text-sm text-orange-800 dark:text-orange-200'>
                        <strong>Found at:</strong> {location}
                      </p>
                      <p className='mt-1 text-xs text-orange-600 dark:text-orange-400'>
                        This batch is not in the system. Please provide details.
                      </p>
                    </CardContent>
                  </Card>

                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>
                      Material Number {!useKeyboard && '(Scan or Type)'}
                    </Label>

                    {!useKeyboard ? (
                      <>
                        <ScannerInput
                          ref={materialInputRef}
                          type='text'
                          placeholder='Scan material barcode'
                          value={formData.materialNumber}
                          onChange={(e) =>
                            handleFieldChange('materialNumber', e.target.value)
                          }
                          className='text-center font-mono text-lg font-semibold'
                          autoFocus
                        />
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='w-full'
                          onClick={() => setUseKeyboard(true)}
                        >
                          Can't Scan? Use Keyboard
                        </Button>
                      </>
                    ) : (
                      <>
                        <QWERTYKeyboard
                          value={formData.materialNumber}
                          onChange={(value) =>
                            handleFieldChange('materialNumber', value)
                          }
                          placeholder='Type material number'
                        />
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='w-full'
                          onClick={() => setUseKeyboard(false)}
                        >
                          Switch to Scanner
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Serial Number */}
              {currentStep === 2 && (
                <div className='space-y-4'>
                  <Card className='bg-primary/5'>
                    <CardContent className='p-3'>
                      <p className='text-sm'>
                        <strong>Material:</strong> {formData.materialNumber}
                      </p>
                    </CardContent>
                  </Card>

                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>
                      Serial Number (Optional)
                    </Label>
                    <p className='text-muted-foreground text-xs'>
                      Enter serial number if available on the box
                    </p>

                    {!useKeyboard ? (
                      <>
                        <ScannerInput
                          ref={serialInputRef}
                          type='text'
                          placeholder='Scan or type serial number'
                          value={formData.serialNumber}
                          onChange={(e) =>
                            handleFieldChange('serialNumber', e.target.value)
                          }
                          className='text-center font-mono text-lg'
                          autoFocus
                        />
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='w-full'
                          onClick={() => setUseKeyboard(true)}
                        >
                          Use Keyboard
                        </Button>
                      </>
                    ) : (
                      <>
                        <QWERTYKeyboard
                          value={formData.serialNumber}
                          onChange={(value) =>
                            handleFieldChange('serialNumber', value)
                          }
                          placeholder='Type serial number'
                        />
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='w-full'
                          onClick={() => setUseKeyboard(false)}
                        >
                          Switch to Scanner
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Notes */}
              {currentStep === 3 && (
                <div className='space-y-4'>
                  <Card className='bg-primary/5'>
                    <CardContent className='p-3'>
                      <p className='text-sm'>
                        <strong>Material:</strong> {formData.materialNumber}
                      </p>
                      {formData.serialNumber && (
                        <p className='text-sm'>
                          <strong>Serial:</strong> {formData.serialNumber}
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>
                      Additional Notes (Optional)
                    </Label>
                    <p className='text-muted-foreground text-xs'>
                      Any other numbers or information found on the box
                    </p>
                    <Textarea
                      placeholder='Enter any additional information...'
                      value={formData.notes}
                      onChange={(e) =>
                        handleFieldChange('notes', e.target.value)
                      }
                      className='min-h-[100px]'
                      autoFocus
                    />
                  </div>
                </div>
              )}

              {/* Step 4: Photo */}
              {currentStep === 4 && (
                <div className='space-y-4'>
                  <Card className='bg-primary/5'>
                    <CardContent className='p-3'>
                      <p className='text-sm'>
                        <strong>Material:</strong> {formData.materialNumber}
                      </p>
                      {formData.serialNumber && (
                        <p className='text-sm'>
                          <strong>Serial:</strong> {formData.serialNumber}
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>
                      Box Photo (Optional)
                    </Label>
                    <p className='text-muted-foreground text-xs'>
                      Take a photo of the box for documentation
                    </p>

                    {photoPreview ? (
                      <div className='space-y-2'>
                        <div className='relative overflow-hidden rounded-lg border-2 border-green-500'>
                          <img
                            src={photoPreview}
                            alt='Box preview'
                            className='h-48 w-full object-cover'
                          />
                          <Badge className='absolute top-2 right-2 bg-green-600'>
                            <CheckCircle className='mr-1 h-3 w-3' />
                            Photo Captured
                          </Badge>
                        </div>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='w-full'
                          onClick={() => {
                            setPhotoPreview(null)
                            handleFieldChange('photo', null)
                            if (fileInputRef.current) {
                              fileInputRef.current.value = ''
                            }
                          }}
                        >
                          Retake Photo
                        </Button>
                      </div>
                    ) : (
                      <div className='space-y-2'>
                        <div className='relative'>
                          <input
                            ref={fileInputRef}
                            id='photo-upload'
                            type='file'
                            accept='image/*'
                            capture='environment'
                            onChange={handlePhotoCapture}
                            className='absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0'
                            title='Tap to capture photo'
                          />
                          <div className='hover:bg-accent hover:border-accent-foreground/20 pointer-events-none flex h-32 w-full items-center justify-center rounded-lg border-2 border-dashed transition-colors'>
                            <div className='flex flex-col items-center space-y-2'>
                              <Camera className='text-muted-foreground h-8 w-8' />
                              <span className='text-sm font-medium'>
                                Tap to Capture Photo
                              </span>
                            </div>
                          </div>
                        </div>
                        <p className='text-muted-foreground text-center text-xs'>
                          Camera will open when you tap the box above
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer actions */}
        <div className='flex space-x-2 border-t pt-4'>
          {currentStep > 1 && (
            <Button
              type='button'
              variant='outline'
              onClick={handleBack}
              disabled={isProcessing}
            >
              Back
            </Button>
          )}

          <Button
            type='button'
            variant='ghost'
            onClick={handleCancel}
            disabled={isProcessing}
            className='ml-auto'
          >
            Cancel
          </Button>

          {currentStep < 4 ? (
            <Button
              type='button'
              onClick={handleNext}
              disabled={
                isProcessing ||
                (currentStep === 1 && !formData.materialNumber.trim())
              }
            >
              Next
            </Button>
          ) : (
            <Button
              type='button'
              onClick={handleSubmit}
              disabled={isProcessing}
            >
              {isProcessing && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              Complete
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
