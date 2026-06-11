// Created and developed by Jai Singh
/**
 * Employee Printouts Component
 * Created: December 27, 2025
 * Purpose: Printable documents for onboarding completion
 * - Shift Details Sheet: Employee info, shift schedule, supervisor
 * - ID Card: Logo, name, QR codes for username and password
 */
import {
  Printer,
  CreditCard,
  FileText,
  Clock,
  User,
  Briefcase,
  Coffee,
} from 'lucide-react'
import type { ShiftSchedule } from '@/lib/supabase/labor-management.service'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type {
  PersonalInfoData,
  PositionAssignmentData,
  ShiftScheduleData,
  GeneratedCredentials,
} from '../../types/onboarding.types'

interface EmployeePrintoutsProps {
  personalInfo: PersonalInfoData | null
  positionAssignment: PositionAssignmentData | null
  shiftSchedule: ShiftScheduleData | null
  shiftTemplate?: ShiftSchedule | null
  credentials: GeneratedCredentials
}

const DAYS_OF_WEEK = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const formatTime = (time: string) => {
  if (!time) return ''
  const [hours, minutes] = time.split(':').map(Number)
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const displayHour = hours % 12 || 12
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${ampm}`
}

const formatEmploymentType = (assignmentType: string | undefined): string => {
  switch (assignmentType) {
    case 'permanent':
      return 'Full-Time'
    case 'temporary':
      return 'Temporary'
    case 'seasonal':
      return 'Seasonal'
    case 'contractor':
      return 'Contractor'
    default:
      return 'Associate'
  }
}

export function EmployeePrintouts({
  personalInfo,
  positionAssignment,
  shiftSchedule,
  shiftTemplate,
  credentials,
}: EmployeePrintoutsProps) {
  const employeeName =
    `${personalInfo?.first_name || ''} ${personalInfo?.last_name || ''}`.trim()
  const workingDaysText =
    shiftSchedule?.working_days?.map((d) => DAYS_OF_WEEK[d]).join(', ') ||
    'Not set'

  // Print Shift Details Sheet - Compact single-page layout
  const handlePrintShiftDetails = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Shift Details - ${employeeName}</title>
          <style>
            @page {
              size: letter;
              margin: 0.5in 0.6in;
            }
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.3;
              color: #1a1a1a;
              font-size: 11px;
              padding: 10px 20px;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding-bottom: 8px;
              border-bottom: 2px solid #2563eb;
              margin-bottom: 10px;
            }
            .logo-section {
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .logo-section img {
              height: 28px;
              width: auto;
            }
            .company-name {
              font-size: 18px;
              font-weight: 700;
              color: #2563eb;
            }
            .doc-title {
              font-size: 11px;
              color: #666;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .employee-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 10px 14px;
              background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
              border-radius: 6px;
              margin-bottom: 10px;
            }
            .employee-info-main {
              display: flex;
              flex-direction: column;
            }
            .employee-name {
              font-size: 18px;
              font-weight: 700;
              color: #1e3a5f;
            }
            .employee-position {
              font-size: 12px;
              color: #4b5563;
            }
            .employment-type {
              background: #1e3a5f;
              color: white;
              padding: 4px 12px;
              border-radius: 12px;
              font-weight: 600;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.3px;
            }
            .content-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 10px;
            }
            .section {
              page-break-inside: avoid;
            }
            .section-title {
              display: flex;
              align-items: center;
              gap: 6px;
              font-size: 12px;
              font-weight: 600;
              color: #1e3a5f;
              margin-bottom: 6px;
              padding-bottom: 4px;
              border-bottom: 1px solid #e5e7eb;
            }
            .section-icon {
              width: 14px;
              height: 14px;
              fill: #2563eb;
            }
            .info-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 6px;
            }
            .info-grid.single-col {
              grid-template-columns: 1fr;
            }
            .info-item {
              display: flex;
              flex-direction: column;
              padding: 6px 8px;
              background: #f9fafb;
              border-radius: 4px;
              border-left: 3px solid #2563eb;
            }
            .info-label {
              font-size: 9px;
              color: #6b7280;
              text-transform: uppercase;
              letter-spacing: 0.3px;
            }
            .info-value {
              font-size: 12px;
              font-weight: 600;
              color: #1f2937;
            }
            .breaks-section {
              background: #fef3c7;
              border-radius: 4px;
              padding: 8px;
              margin-top: 6px;
            }
            .breaks-title {
              font-weight: 600;
              font-size: 11px;
              color: #92400e;
              margin-bottom: 4px;
              display: flex;
              align-items: center;
              gap: 4px;
            }
            .breaks-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 4px;
            }
            .break-item {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 4px 6px;
              background: rgba(255,255,255,0.6);
              border-radius: 3px;
              font-size: 10px;
            }
            .break-name {
              font-weight: 500;
            }
            .break-details {
              color: #78350f;
              font-size: 9px;
            }
            .full-width {
              grid-column: span 2;
            }
            .signature-section {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 30px;
              margin-top: 20px;
              padding-top: 10px;
            }
            .signature-box {
              text-align: center;
            }
            .signature-line {
              border-top: 1px solid #374151;
              margin-bottom: 4px;
            }
            .signature-label {
              font-size: 9px;
              color: #6b7280;
            }
            .footer {
              margin-top: 10px;
              padding-top: 6px;
              border-top: 1px solid #e5e7eb;
              text-align: center;
              color: #9ca3af;
              font-size: 9px;
              display: flex;
              justify-content: space-between;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo-section">
              <img src="/images/OneBoxLogoX.png" alt="OmniFrame Logo" />
              <span class="company-name">OmniFrame</span>
            </div>
            <div class="doc-title">Employee Shift Details</div>
          </div>

          <div class="employee-header">
            <div class="employee-info-main">
              <div class="employee-name">${employeeName}</div>
              <div class="employee-position">${positionAssignment?.position_title || 'Position Not Assigned'}</div>
            </div>
            <span class="employment-type">${formatEmploymentType(positionAssignment?.assignment_type)}</span>
          </div>

          <div class="content-grid">
            <div class="section">
              <div class="section-title">
                <svg class="section-icon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                Supervisor
              </div>
              <div class="info-grid single-col">
                <div class="info-item">
                  <span class="info-label">Reports To</span>
                  <span class="info-value">${positionAssignment?.supervisor_name || 'Not Assigned'}</span>
                </div>
                ${
                  positionAssignment?.team_lead_name
                    ? `
                <div class="info-item">
                  <span class="info-label">Team Lead</span>
                  <span class="info-value">${positionAssignment.team_lead_name}</span>
                </div>
                `
                    : ''
                }
              </div>
            </div>

            <div class="section">
              <div class="section-title">
                <svg class="section-icon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Targets
              </div>
              <div class="info-grid">
                <div class="info-item">
                  <span class="info-label">Productivity</span>
                  <span class="info-value">${shiftSchedule?.productivity_target || 100}%</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Quality</span>
                  <span class="info-value">${shiftSchedule?.quality_target || 95}%</span>
                </div>
              </div>
            </div>

            <div class="section full-width">
              <div class="section-title">
                <svg class="section-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Shift Schedule
              </div>
              <div class="info-grid" style="grid-template-columns: repeat(4, 1fr);">
                <div class="info-item">
                  <span class="info-label">Pattern</span>
                  <span class="info-value">${(shiftSchedule?.shift_pattern || 'fixed').charAt(0).toUpperCase() + (shiftSchedule?.shift_pattern || 'fixed').slice(1)}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Schedule</span>
                  <span class="info-value">${shiftTemplate?.schedule_name || 'Custom'}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Start</span>
                  <span class="info-value">${formatTime(shiftSchedule?.shift_start_time || '08:00')}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">End</span>
                  <span class="info-value">${formatTime(shiftSchedule?.shift_end_time || '17:00')}</span>
                </div>
              </div>
            </div>

            <div class="section full-width">
              <div class="section-title">
                <svg class="section-icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Working Days
              </div>
              <div class="info-grid single-col">
                <div class="info-item">
                  <span class="info-label">Scheduled Days</span>
                  <span class="info-value">${workingDaysText}</span>
                </div>
              </div>
            </div>

            ${
              shiftTemplate?.breaks && shiftTemplate.breaks.length > 0
                ? `
            <div class="section full-width">
              <div class="breaks-section">
                <div class="breaks-title">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#92400e" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/></svg>
                  Scheduled Breaks
                </div>
                <div class="breaks-grid">
                  ${shiftTemplate.breaks
                    .map(
                      (b) => `
                    <div class="break-item">
                      <span class="break-name">${b.break_name}</span>
                      <span class="break-details">${formatTime(b.start_time)} • ${b.duration_minutes}m${b.is_paid ? ' (P)' : ''}</span>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>
            </div>
            `
                : ''
            }
          </div>

          <div class="signature-section">
            <div class="signature-box">
              <div class="signature-line"></div>
              <div class="signature-label">Employee Signature</div>
            </div>
            <div class="signature-box">
              <div class="signature-line"></div>
              <div class="signature-label">Supervisor Signature</div>
            </div>
          </div>

          <div class="footer">
            <span>Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <span>Start Date: ${personalInfo?.start_date ? new Date(personalInfo.start_date).toLocaleDateString() : 'Not Set'}</span>
          </div>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  // Print ID Card
  const handlePrintIdCard = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    // Generate QR code data URLs
    const generateQRDataUrl = (data: string): Promise<string> => {
      return new Promise((resolve) => {
        import('qrcode').then((QRCode) => {
          QRCode.toDataURL(data, {
            width: 100,
            margin: 0,
            color: {
              dark: '#000000',
              light: '#ffffff',
            },
            errorCorrectionLevel: 'M',
          })
            .then(resolve)
            .catch(() => resolve(''))
        })
      })
    }

    Promise.all([
      generateQRDataUrl(credentials.email),
      generateQRDataUrl(credentials.badgeNumber || credentials.email),
    ]).then(([usernameQR, badgeQR]) => {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>ID Card - ${employeeName}</title>
            <style>
              @page {
                size: 3.375in 2.125in;
                margin: 0;
              }
              * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
              }
              body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                background: white;
              }
              .id-card {
                width: 3.375in;
                height: 2.125in;
                background: white;
                border: 2px solid #000;
                border-radius: 8px;
                overflow: hidden;
                display: flex;
                flex-direction: row;
                position: relative;
              }
              .qr-left {
                width: 0.9in;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 8px;
                border-right: 1px solid #ccc;
              }
              .qr-right {
                width: 0.9in;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 8px;
                border-left: 1px solid #ccc;
              }
              .qr-code {
                width: 0.7in;
                height: 0.7in;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              .qr-code img {
                width: 100%;
                height: 100%;
              }
              .qr-label {
                font-size: 8px;
                color: #000;
                margin-top: 4px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                font-weight: 600;
              }
              .card-center {
                flex: 1;
                display: flex;
                flex-direction: column;
                padding: 10px 12px;
              }
              .card-header {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding-bottom: 6px;
                border-bottom: 1px solid #ccc;
                margin-bottom: 6px;
              }
              .card-header img {
                height: 20px;
                width: auto;
                max-width: 20px;
                object-fit: contain;
              }
              .company-text {
                font-size: 14px;
                font-weight: 700;
                color: #000;
                letter-spacing: 0.5px;
              }
              .employee-info {
                flex: 1;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                text-align: center;
              }
              .employee-name {
                font-size: 14px;
                font-weight: 700;
                color: #000;
                margin-bottom: 2px;
              }
              .employee-position {
                font-size: 10px;
                color: #333;
                margin-bottom: 6px;
              }
              .employment-type {
                font-size: 11px;
                font-weight: 600;
                color: #000;
                border: 1px solid #000;
                padding: 2px 10px;
                border-radius: 4px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
              }
              .card-footer {
                border-top: 1px solid #ccc;
                padding-top: 6px;
                display: flex;
                justify-content: center;
                align-items: center;
              }
              .scan-instruction {
                font-size: 7px;
                color: #666;
                text-transform: uppercase;
                letter-spacing: 0.5px;
              }
              @media print {
                body { 
                  background: white;
                  -webkit-print-color-adjust: exact; 
                  print-color-adjust: exact;
                }
              }
            </style>
          </head>
          <body>
            <div class="id-card">
              <!-- Left QR Code - Username -->
              <div class="qr-left">
                <div class="qr-code">
                  <img src="${usernameQR}" alt="Username QR" />
                </div>
                <div class="qr-label">User</div>
              </div>
              
              <!-- Center Content -->
              <div class="card-center">
                <div class="card-header">
                  <img src="/images/OneBoxLogoX.png" alt="OmniFrame" />
                  <span class="company-text">OmniFrame</span>
                </div>
                
                <div class="employee-info">
                  <div class="employee-name">${employeeName}</div>
                  <div class="employee-position">${positionAssignment?.position_title || 'Team Member'}</div>
                  <div class="employment-type">${formatEmploymentType(positionAssignment?.assignment_type)}</div>
                </div>
                
                <div class="card-footer">
                  <span class="scan-instruction">Scan QR for employee info</span>
                </div>
              </div>
              
              <!-- Right QR Code - Badge -->
              <div class="qr-right">
                <div class="qr-code">
                  <img src="${badgeQR}" alt="Badge QR" />
                </div>
                <div class="qr-label">Badge</div>
              </div>
            </div>
          </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.focus()
      // Small delay to ensure QR images load
      setTimeout(() => {
        printWindow.print()
      }, 500)
    })
  }

  return (
    <Card>
      <CardHeader className='pb-4'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Printer className='h-4 w-4' />
          Print Documents
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <p className='text-muted-foreground text-sm'>
          Print the employee's shift details and ID card for their records.
        </p>

        <div className='grid gap-3 sm:grid-cols-2'>
          {/* Shift Details Print Button */}
          <Button
            variant='outline'
            className='flex h-auto flex-col items-center gap-2 py-4'
            onClick={handlePrintShiftDetails}
          >
            <FileText className='h-8 w-8 text-blue-600' />
            <div className='text-center'>
              <div className='font-medium'>Shift Details</div>
              <div className='text-muted-foreground text-xs'>
                Schedule, supervisor, breaks
              </div>
            </div>
          </Button>

          {/* ID Card Print Button */}
          <Button
            variant='outline'
            className='flex h-auto flex-col items-center gap-2 py-4'
            onClick={handlePrintIdCard}
          >
            <CreditCard className='h-8 w-8 text-green-600' />
            <div className='text-center'>
              <div className='font-medium'>ID Card</div>
              <div className='text-muted-foreground text-xs'>
                Badge with login QR codes
              </div>
            </div>
          </Button>
        </div>

        <Separator />

        {/* Preview Info */}
        <div className='space-y-2 text-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground flex items-center gap-2'>
              <User className='h-4 w-4' />
              Employee:
            </span>
            <span className='font-medium'>{employeeName}</span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground flex items-center gap-2'>
              <Briefcase className='h-4 w-4' />
              Supervisor:
            </span>
            <span className='font-medium'>
              {positionAssignment?.supervisor_name || 'Not assigned'}
            </span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground flex items-center gap-2'>
              <Clock className='h-4 w-4' />
              Shift:
            </span>
            <span className='font-medium'>
              {formatTime(shiftSchedule?.shift_start_time || '08:00')} -{' '}
              {formatTime(shiftSchedule?.shift_end_time || '17:00')}
            </span>
          </div>
          {shiftTemplate?.breaks && shiftTemplate.breaks.length > 0 && (
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground flex items-center gap-2'>
                <Coffee className='h-4 w-4' />
                Breaks:
              </span>
              <span className='font-medium'>
                {shiftTemplate.breaks.length} scheduled
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default EmployeePrintouts

// Created and developed by Jai Singh
