/**
 * Step 7: Certifications & Training
 * Add employee certifications and training records
 */
import { useState } from 'react'
import {
  Award,
  Plus,
  Edit2,
  Trash2,
  Calendar,
  Building,
  FileText,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useOnboarding } from '../../context/onboarding-context'
import type { CertificationData } from '../../types/onboarding.types'

const CERTIFICATION_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'safety', label: 'Safety' },
  { value: 'equipment', label: 'Equipment Operation' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'training', label: 'Training' },
  { value: 'forklift', label: 'Forklift' },
  { value: 'hazmat', label: 'Hazmat' },
  { value: 'first_aid', label: 'First Aid' },
  { value: 'osha', label: 'OSHA' },
]

const getEmptyCertification = (): CertificationData => ({
  certification_name: '',
  certification_type: 'general',
  issuing_authority: '',
  certification_number: '',
  issue_date: '',
  expiration_date: '',
  document_url: null,
  is_required: false,
  notes: '',
})

export function Step7Certifications() {
  const { state, addCertification, updateCertification, removeCertification } =
    useOnboarding()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [formData, setFormData] = useState<CertificationData>(
    getEmptyCertification()
  )

  const certifications = state.certifications || []

  const handleOpenDialog = (index?: number) => {
    if (index !== undefined && certifications[index]) {
      setEditingIndex(index)
      setFormData(certifications[index])
    } else {
      setEditingIndex(null)
      setFormData(getEmptyCertification())
    }
    setIsDialogOpen(true)
  }

  const handleSave = () => {
    if (!formData.certification_name) return

    if (editingIndex !== null) {
      updateCertification(editingIndex, formData)
    } else {
      addCertification(formData)
    }
    setIsDialogOpen(false)
    setFormData(getEmptyCertification())
    setEditingIndex(null)
  }

  const handleDelete = (index: number) => {
    removeCertification(index)
  }

  const getCertTypeColor = (type: string) => {
    switch (type) {
      case 'safety':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
      case 'forklift':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
      case 'hazmat':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      case 'first_aid':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'osha':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      default:
        return ''
    }
  }

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle className='flex items-center gap-2'>
                <Award className='h-5 w-5' />
                Certifications & Training
              </CardTitle>
              <CardDescription>
                Add any certifications, licenses, or training records
              </CardDescription>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => handleOpenDialog()}>
                  <Plus className='mr-2 h-4 w-4' />
                  Add Certification
                </Button>
              </DialogTrigger>
              <DialogContent className='max-w-md'>
                <DialogHeader>
                  <DialogTitle>
                    {editingIndex !== null
                      ? 'Edit Certification'
                      : 'Add Certification'}
                  </DialogTitle>
                  <DialogDescription>
                    Enter the certification details below
                  </DialogDescription>
                </DialogHeader>

                <div className='space-y-4 py-4'>
                  <div className='space-y-2'>
                    <Label>Certification Name *</Label>
                    <Input
                      placeholder='e.g., Forklift Operator License'
                      value={formData.certification_name}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          certification_name: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className='space-y-2'>
                    <Label>Type</Label>
                    <Select
                      value={formData.certification_type}
                      onValueChange={(value) =>
                        setFormData({ ...formData, certification_type: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CERTIFICATION_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='space-y-2'>
                    <Label>Issuing Authority</Label>
                    <Input
                      placeholder='e.g., OSHA, Company Training Dept'
                      value={formData.issuing_authority || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          issuing_authority: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className='space-y-2'>
                    <Label>Certification Number</Label>
                    <Input
                      placeholder='e.g., CERT-12345'
                      value={formData.certification_number || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          certification_number: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className='grid grid-cols-2 gap-4'>
                    <div className='space-y-2'>
                      <Label>Issue Date</Label>
                      <Input
                        type='date'
                        value={formData.issue_date || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            issue_date: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label>Expiration Date</Label>
                      <Input
                        type='date'
                        value={formData.expiration_date || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            expiration_date: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className='flex items-center gap-2'>
                    <Switch
                      checked={formData.is_required}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, is_required: checked })
                      }
                    />
                    <Label>Required for Position</Label>
                  </div>

                  <div className='space-y-2'>
                    <Label>Notes</Label>
                    <Textarea
                      placeholder='Additional notes...'
                      value={formData.notes || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, notes: e.target.value })
                      }
                      rows={2}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant='outline'
                    onClick={() => setIsDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={!formData.certification_name}
                  >
                    {editingIndex !== null ? 'Update' : 'Add'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {certifications.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center'>
              <Award className='mx-auto mb-4 h-12 w-12 opacity-50' />
              <p>No certifications added yet</p>
              <p className='text-sm'>
                Click "Add Certification" to add training records
              </p>
            </div>
          ) : (
            <div className='space-y-3'>
              {certifications.map((cert, index) => (
                <div
                  key={cert.id || index}
                  className='flex items-center justify-between rounded-lg border p-4'
                >
                  <div className='flex items-start gap-4'>
                    <div className='bg-primary/10 flex h-10 w-10 items-center justify-center rounded-full'>
                      <Award className='text-primary h-5 w-5' />
                    </div>
                    <div>
                      <div className='flex items-center gap-2'>
                        <h4 className='font-medium'>
                          {cert.certification_name}
                        </h4>
                        <Badge
                          variant='outline'
                          className={getCertTypeColor(cert.certification_type)}
                        >
                          {CERTIFICATION_TYPES.find(
                            (t) => t.value === cert.certification_type
                          )?.label || cert.certification_type}
                        </Badge>
                        {cert.is_required && (
                          <Badge variant='secondary'>Required</Badge>
                        )}
                      </div>
                      <div className='text-muted-foreground mt-1 flex items-center gap-4 text-sm'>
                        {cert.issuing_authority && (
                          <span className='flex items-center gap-1'>
                            <Building className='h-3 w-3' />
                            {cert.issuing_authority}
                          </span>
                        )}
                        {cert.expiration_date && (
                          <span className='flex items-center gap-1'>
                            <Calendar className='h-3 w-3' />
                            Expires:{' '}
                            {new Date(
                              cert.expiration_date
                            ).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => handleOpenDialog(index)}
                    >
                      <Edit2 className='h-4 w-4' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => handleDelete(index)}
                    >
                      <Trash2 className='text-destructive h-4 w-4' />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <FileText className='h-4 w-4' />
        <AlertDescription>
          Certification documents can be uploaded after the employee account is
          created. You can manage certifications and expiration reminders in the
          employee profile.
        </AlertDescription>
      </Alert>
    </div>
  )
}

export default Step7Certifications
