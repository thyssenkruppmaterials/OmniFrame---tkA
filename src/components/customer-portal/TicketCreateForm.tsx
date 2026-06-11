// Created and developed by Jai Singh
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import {
  TicketCategory,
  TicketPriority,
  useCreateTicket,
  type TicketCreate,
} from '@/lib/smartsheet/ticket-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export function TicketCreateForm() {
  const navigate = useNavigate()
  const createTicket = useCreateTicket()

  const [formData, setFormData] = useState<TicketCreate>({
    customer_id: '',
    email: '',
    subject: '',
    description: '',
    priority: TicketPriority.MEDIUM,
    category: TicketCategory.GENERAL,
  })

  const [errors, setErrors] = useState<
    Partial<Record<keyof TicketCreate, string>>
  >({})

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof TicketCreate, string>> = {}

    if (!formData.customer_id.trim()) {
      newErrors.customer_id = 'Customer ID is required'
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!formData.email.includes('@')) {
      newErrors.email = 'Please enter a valid email address'
    }

    if (!formData.subject.trim() || formData.subject.length < 3) {
      newErrors.subject = 'Subject must be at least 3 characters'
    }

    if (!formData.description.trim() || formData.description.length < 10) {
      newErrors.description = 'Description must be at least 10 characters'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      toast.error('Please fix the form errors')
      return
    }

    try {
      const result = await createTicket.mutateAsync(formData)

      if (result.success && result.ticket) {
        toast.success('Ticket created successfully!')
        // Navigate to the newly created ticket
        navigate({ to: `/customer-portal/${result.ticket.row_id}` })
      } else {
        toast.error(result.message || 'Failed to create ticket')
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create ticket'
      )
    }
  }

  const handleInputChange = (field: keyof TicketCreate, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }
  }

  return (
    <Card>
      <CardContent className='pt-6'>
        <form onSubmit={handleSubmit} className='space-y-6'>
          {/* Customer ID */}
          <div className='space-y-2'>
            <Label htmlFor='customer_id'>
              Customer ID <span className='text-destructive'>*</span>
            </Label>
            <Input
              id='customer_id'
              type='text'
              placeholder='Enter your customer ID'
              value={formData.customer_id}
              onChange={(e) => handleInputChange('customer_id', e.target.value)}
              className={errors.customer_id ? 'border-destructive' : ''}
            />
            {errors.customer_id && (
              <p className='text-destructive text-sm'>{errors.customer_id}</p>
            )}
          </div>

          {/* Email */}
          <div className='space-y-2'>
            <Label htmlFor='email'>
              Email Address <span className='text-destructive'>*</span>
            </Label>
            <Input
              id='email'
              type='email'
              placeholder='Enter your email address'
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className={errors.email ? 'border-destructive' : ''}
            />
            {errors.email && (
              <p className='text-destructive text-sm'>{errors.email}</p>
            )}
          </div>

          {/* Subject */}
          <div className='space-y-2'>
            <Label htmlFor='subject'>
              Subject <span className='text-destructive'>*</span>
            </Label>
            <Input
              id='subject'
              type='text'
              placeholder='Brief description of your issue'
              value={formData.subject}
              onChange={(e) => handleInputChange('subject', e.target.value)}
              className={errors.subject ? 'border-destructive' : ''}
            />
            {errors.subject && (
              <p className='text-destructive text-sm'>{errors.subject}</p>
            )}
          </div>

          {/* Description */}
          <div className='space-y-2'>
            <Label htmlFor='description'>
              Description <span className='text-destructive'>*</span>
            </Label>
            <Textarea
              id='description'
              placeholder='Provide a detailed description of your issue or request'
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              className={errors.description ? 'border-destructive' : ''}
              rows={6}
            />
            {errors.description && (
              <p className='text-destructive text-sm'>{errors.description}</p>
            )}
          </div>

          {/* Priority and Category */}
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            {/* Priority */}
            <div className='space-y-2'>
              <Label htmlFor='priority'>Priority</Label>
              <Select
                value={formData.priority}
                onValueChange={(value) =>
                  handleInputChange('priority', value as TicketPriority)
                }
              >
                <SelectTrigger id='priority'>
                  <SelectValue placeholder='Select priority' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TicketPriority.LOW}>Low</SelectItem>
                  <SelectItem value={TicketPriority.MEDIUM}>Medium</SelectItem>
                  <SelectItem value={TicketPriority.HIGH}>High</SelectItem>
                  <SelectItem value={TicketPriority.CRITICAL}>
                    Critical
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Category */}
            <div className='space-y-2'>
              <Label htmlFor='category'>Category</Label>
              <Select
                value={formData.category}
                onValueChange={(value) =>
                  handleInputChange('category', value as TicketCategory)
                }
              >
                <SelectTrigger id='category'>
                  <SelectValue placeholder='Select category' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TicketCategory.GENERAL}>
                    General
                  </SelectItem>
                  <SelectItem value={TicketCategory.TECHNICAL}>
                    Technical
                  </SelectItem>
                  <SelectItem value={TicketCategory.BILLING}>
                    Billing
                  </SelectItem>
                  <SelectItem value={TicketCategory.SHIPPING}>
                    Shipping
                  </SelectItem>
                  <SelectItem value={TicketCategory.PRODUCT}>
                    Product
                  </SelectItem>
                  <SelectItem value={TicketCategory.OTHER}>Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Submit Button */}
          <Button
            type='submit'
            className='w-full'
            disabled={createTicket.isPending}
          >
            {createTicket.isPending ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Creating Ticket...
              </>
            ) : (
              <>
                <Send className='mr-2 h-4 w-4' />
                Submit Ticket
              </>
            )}
          </Button>

          {/* Help Text */}
          <p className='text-muted-foreground text-center text-sm'>
            After submitting, you'll receive a ticket ID that you can use to
            track your request.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

// Created and developed by Jai Singh
