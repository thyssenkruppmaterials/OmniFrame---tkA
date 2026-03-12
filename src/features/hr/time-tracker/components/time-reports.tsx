/**
 * Time Reports Component
 * Reporting interface for attendance, overtime, punctuality, and department summary reports.
 */
import { useState } from 'react'
import { format } from 'date-fns'
import {
  IconFileSpreadsheet,
  IconFileTypePdf,
  IconCalendarStats,
  IconClock,
  IconClockExclamation,
  IconUsers,
  IconChartBar,
  IconDownload,
  IconRefresh,
  IconArrowUp,
  IconArrowDown,
  IconMinus,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ── Types ──────────────────────────────────────────────────────────────────

type ReportType = 'attendance' | 'overtime' | 'punctuality' | 'department'

interface ReportOption {
  id: ReportType
  label: string
  description: string
  icon: React.ElementType
  iconColor: string
}

interface AttendanceRow {
  employee: string
  department: string
  daysWorked: number
  daysAbsent: number
  daysLate: number
  totalHours: number
  avgHoursPerDay: number
}

interface OvertimeRow {
  employee: string
  department: string
  regularHours: number
  dailyOT: number
  weeklyOT: number
  totalOT: number
  otCost: string
}

interface PunctualityRow {
  employee: string
  department: string
  onTimeCount: number
  lateCount: number
  earlyDepartureCount: number
  punctualityRate: number
  trend: 'up' | 'down' | 'stable'
}

interface DepartmentRow {
  department: string
  headcount: number
  totalHours: number
  avgHoursPerEmployee: number
  overtimeHours: number
  absenteeismRate: number
  punctualityRate: number
}

// ── Mock Data ──────────────────────────────────────────────────────────────

const reportOptions: ReportOption[] = [
  {
    id: 'attendance',
    label: 'Attendance Summary',
    description: 'Days worked, absent, and total hours',
    icon: IconCalendarStats,
    iconColor: 'text-blue-600',
  },
  {
    id: 'overtime',
    label: 'Overtime Report',
    description: 'Daily and weekly overtime breakdown',
    icon: IconClock,
    iconColor: 'text-amber-600',
  },
  {
    id: 'punctuality',
    label: 'Punctuality Report',
    description: 'On-time, late, and early departures',
    icon: IconClockExclamation,
    iconColor: 'text-red-600',
  },
  {
    id: 'department',
    label: 'Department Summary',
    description: 'Aggregate metrics by department',
    icon: IconUsers,
    iconColor: 'text-purple-600',
  },
]

const attendanceData: AttendanceRow[] = [
  {
    employee: 'John Smith',
    department: 'Warehouse',
    daysWorked: 9,
    daysAbsent: 0,
    daysLate: 0,
    totalHours: 76.5,
    avgHoursPerDay: 8.5,
  },
  {
    employee: 'Maria Garcia',
    department: 'Receiving',
    daysWorked: 8,
    daysAbsent: 1,
    daysLate: 2,
    totalHours: 68.0,
    avgHoursPerDay: 8.5,
  },
  {
    employee: 'David Chen',
    department: 'Shipping',
    daysWorked: 9,
    daysAbsent: 0,
    daysLate: 0,
    totalHours: 82.0,
    avgHoursPerDay: 9.1,
  },
  {
    employee: 'Sarah Johnson',
    department: 'Warehouse',
    daysWorked: 7,
    daysAbsent: 2,
    daysLate: 1,
    totalHours: 56.0,
    avgHoursPerDay: 8.0,
  },
  {
    employee: 'Robert Williams',
    department: 'Quality',
    daysWorked: 9,
    daysAbsent: 0,
    daysLate: 0,
    totalHours: 72.0,
    avgHoursPerDay: 8.0,
  },
  {
    employee: 'Emily Davis',
    department: 'Warehouse',
    daysWorked: 9,
    daysAbsent: 0,
    daysLate: 1,
    totalHours: 78.0,
    avgHoursPerDay: 8.7,
  },
]

const overtimeData: OvertimeRow[] = [
  {
    employee: 'John Smith',
    department: 'Warehouse',
    regularHours: 72.0,
    dailyOT: 2.5,
    weeklyOT: 2.0,
    totalOT: 4.5,
    otCost: '$135.00',
  },
  {
    employee: 'David Chen',
    department: 'Shipping',
    regularHours: 72.0,
    dailyOT: 4.0,
    weeklyOT: 6.0,
    totalOT: 10.0,
    otCost: '$300.00',
  },
  {
    employee: 'Emily Davis',
    department: 'Warehouse',
    regularHours: 72.0,
    dailyOT: 3.0,
    weeklyOT: 3.0,
    totalOT: 6.0,
    otCost: '$180.00',
  },
  {
    employee: 'Michael Brown',
    department: 'Receiving',
    regularHours: 72.0,
    dailyOT: 1.0,
    weeklyOT: 0,
    totalOT: 1.0,
    otCost: '$30.00',
  },
  {
    employee: 'Jessica Martinez',
    department: 'Shipping',
    regularHours: 72.0,
    dailyOT: 5.0,
    weeklyOT: 3.0,
    totalOT: 8.0,
    otCost: '$240.00',
  },
]

const punctualityData: PunctualityRow[] = [
  {
    employee: 'John Smith',
    department: 'Warehouse',
    onTimeCount: 9,
    lateCount: 0,
    earlyDepartureCount: 0,
    punctualityRate: 100,
    trend: 'stable',
  },
  {
    employee: 'Maria Garcia',
    department: 'Receiving',
    onTimeCount: 6,
    lateCount: 2,
    earlyDepartureCount: 0,
    punctualityRate: 75,
    trend: 'down',
  },
  {
    employee: 'David Chen',
    department: 'Shipping',
    onTimeCount: 9,
    lateCount: 0,
    earlyDepartureCount: 0,
    punctualityRate: 100,
    trend: 'stable',
  },
  {
    employee: 'Sarah Johnson',
    department: 'Warehouse',
    onTimeCount: 5,
    lateCount: 1,
    earlyDepartureCount: 1,
    punctualityRate: 71,
    trend: 'down',
  },
  {
    employee: 'Robert Williams',
    department: 'Quality',
    onTimeCount: 9,
    lateCount: 0,
    earlyDepartureCount: 0,
    punctualityRate: 100,
    trend: 'up',
  },
  {
    employee: 'Emily Davis',
    department: 'Warehouse',
    onTimeCount: 8,
    lateCount: 1,
    earlyDepartureCount: 0,
    punctualityRate: 89,
    trend: 'up',
  },
]

const departmentData: DepartmentRow[] = [
  {
    department: 'Warehouse',
    headcount: 15,
    totalHours: 1200,
    avgHoursPerEmployee: 80.0,
    overtimeHours: 45.0,
    absenteeismRate: 3.2,
    punctualityRate: 92,
  },
  {
    department: 'Shipping',
    headcount: 10,
    totalHours: 820,
    avgHoursPerEmployee: 82.0,
    overtimeHours: 38.0,
    absenteeismRate: 1.5,
    punctualityRate: 96,
  },
  {
    department: 'Receiving',
    headcount: 8,
    totalHours: 624,
    avgHoursPerEmployee: 78.0,
    overtimeHours: 12.0,
    absenteeismRate: 4.8,
    punctualityRate: 85,
  },
  {
    department: 'Quality',
    headcount: 6,
    totalHours: 468,
    avgHoursPerEmployee: 78.0,
    overtimeHours: 6.0,
    absenteeismRate: 2.0,
    punctualityRate: 98,
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function getTrendIcon(trend: 'up' | 'down' | 'stable') {
  switch (trend) {
    case 'up':
      return <IconArrowUp className='h-4 w-4 text-green-600' />
    case 'down':
      return <IconArrowDown className='h-4 w-4 text-red-600' />
    case 'stable':
      return <IconMinus className='text-muted-foreground h-4 w-4' />
  }
}

function getPunctualityColor(rate: number): string {
  if (rate >= 95) return 'text-green-600'
  if (rate >= 85) return 'text-amber-600'
  return 'text-red-600'
}

// ── Component ──────────────────────────────────────────────────────────────

function TimeReports() {
  const [selectedReport, setSelectedReport] = useState<ReportType>('attendance')
  const [dateFrom, setDateFrom] = useState('2026-02-03')
  const [dateTo, setDateTo] = useState('2026-02-16')

  const currentReport = reportOptions.find((r) => r.id === selectedReport)!

  // ── Report renderers ────────────────────────────────────

  const renderAttendanceReport = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Department</TableHead>
          <TableHead className='text-right'>Days Worked</TableHead>
          <TableHead className='text-right'>Days Absent</TableHead>
          <TableHead className='text-right'>Days Late</TableHead>
          <TableHead className='text-right'>Total Hours</TableHead>
          <TableHead className='text-right'>Avg Hrs/Day</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {attendanceData.map((row) => (
          <TableRow key={row.employee}>
            <TableCell className='font-medium'>{row.employee}</TableCell>
            <TableCell className='text-muted-foreground'>
              {row.department}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {row.daysWorked}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {row.daysAbsent > 0 ? (
                <span className='font-medium text-red-600'>
                  {row.daysAbsent}
                </span>
              ) : (
                <span className='text-muted-foreground'>0</span>
              )}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {row.daysLate > 0 ? (
                <span className='font-medium text-amber-600'>
                  {row.daysLate}
                </span>
              ) : (
                <span className='text-muted-foreground'>0</span>
              )}
            </TableCell>
            <TableCell className='text-right font-semibold tabular-nums'>
              {row.totalHours.toFixed(1)}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {row.avgHoursPerDay.toFixed(1)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  const renderOvertimeReport = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Department</TableHead>
          <TableHead className='text-right'>Regular Hrs</TableHead>
          <TableHead className='text-right'>Daily OT</TableHead>
          <TableHead className='text-right'>Weekly OT</TableHead>
          <TableHead className='text-right'>Total OT</TableHead>
          <TableHead className='text-right'>Est. OT Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {overtimeData.map((row) => (
          <TableRow key={row.employee}>
            <TableCell className='font-medium'>{row.employee}</TableCell>
            <TableCell className='text-muted-foreground'>
              {row.department}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {row.regularHours.toFixed(1)}
            </TableCell>
            <TableCell className='text-right text-amber-600 tabular-nums'>
              {row.dailyOT.toFixed(1)}
            </TableCell>
            <TableCell className='text-right text-amber-600 tabular-nums'>
              {row.weeklyOT.toFixed(1)}
            </TableCell>
            <TableCell className='text-right font-semibold text-amber-600 tabular-nums'>
              {row.totalOT.toFixed(1)}
            </TableCell>
            <TableCell className='text-right font-medium tabular-nums'>
              {row.otCost}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className='border-t-2 font-semibold'>
          <TableCell colSpan={5} className='text-right'>
            Totals:
          </TableCell>
          <TableCell className='text-right text-amber-600 tabular-nums'>
            {overtimeData.reduce((s, r) => s + r.totalOT, 0).toFixed(1)}
          </TableCell>
          <TableCell className='text-right tabular-nums'>
            $
            {overtimeData
              .reduce(
                (s, r) =>
                  s + parseFloat(r.otCost.replace('$', '').replace(',', '')),
                0
              )
              .toFixed(2)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )

  const renderPunctualityReport = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Department</TableHead>
          <TableHead className='text-right'>On Time</TableHead>
          <TableHead className='text-right'>Late</TableHead>
          <TableHead className='text-right'>Early Departure</TableHead>
          <TableHead className='text-right'>Punctuality Rate</TableHead>
          <TableHead className='text-center'>Trend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {punctualityData.map((row) => (
          <TableRow key={row.employee}>
            <TableCell className='font-medium'>{row.employee}</TableCell>
            <TableCell className='text-muted-foreground'>
              {row.department}
            </TableCell>
            <TableCell className='text-right text-green-600 tabular-nums'>
              {row.onTimeCount}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {row.lateCount > 0 ? (
                <span className='font-medium text-amber-600'>
                  {row.lateCount}
                </span>
              ) : (
                <span className='text-muted-foreground'>0</span>
              )}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {row.earlyDepartureCount > 0 ? (
                <span className='font-medium text-orange-600'>
                  {row.earlyDepartureCount}
                </span>
              ) : (
                <span className='text-muted-foreground'>0</span>
              )}
            </TableCell>
            <TableCell
              className={`text-right font-semibold tabular-nums ${getPunctualityColor(row.punctualityRate)}`}
            >
              {row.punctualityRate}%
            </TableCell>
            <TableCell className='text-center'>
              {getTrendIcon(row.trend)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  const renderDepartmentReport = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Department</TableHead>
          <TableHead className='text-right'>Headcount</TableHead>
          <TableHead className='text-right'>Total Hours</TableHead>
          <TableHead className='text-right'>Avg Hrs/Emp</TableHead>
          <TableHead className='text-right'>OT Hours</TableHead>
          <TableHead className='text-right'>Absenteeism</TableHead>
          <TableHead className='text-right'>Punctuality</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {departmentData.map((row) => (
          <TableRow key={row.department}>
            <TableCell className='font-medium'>{row.department}</TableCell>
            <TableCell className='text-right tabular-nums'>
              {row.headcount}
            </TableCell>
            <TableCell className='text-right font-semibold tabular-nums'>
              {row.totalHours.toLocaleString()}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              {row.avgHoursPerEmployee.toFixed(1)}
            </TableCell>
            <TableCell className='text-right text-amber-600 tabular-nums'>
              {row.overtimeHours.toFixed(1)}
            </TableCell>
            <TableCell className='text-right tabular-nums'>
              <span
                className={
                  row.absenteeismRate > 3
                    ? 'font-medium text-red-600'
                    : 'text-muted-foreground'
                }
              >
                {row.absenteeismRate}%
              </span>
            </TableCell>
            <TableCell
              className={`text-right font-semibold tabular-nums ${getPunctualityColor(row.punctualityRate)}`}
            >
              {row.punctualityRate}%
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  const renderSelectedReport = () => {
    switch (selectedReport) {
      case 'attendance':
        return renderAttendanceReport()
      case 'overtime':
        return renderOvertimeReport()
      case 'punctuality':
        return renderPunctualityReport()
      case 'department':
        return renderDepartmentReport()
    }
  }

  return (
    <div className='space-y-6'>
      {/* Report Type Selector */}
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        {reportOptions.map((option) => {
          const Icon = option.icon
          const isSelected = selectedReport === option.id
          return (
            <button
              key={option.id}
              onClick={() => setSelectedReport(option.id)}
              className={`hover:border-primary/50 flex items-start gap-3 rounded-lg border p-4 text-left transition-all hover:shadow-sm ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-primary/20 shadow-sm ring-1'
                  : 'border-border'
              }`}
            >
              <div
                className={`rounded-lg p-2 ${isSelected ? 'bg-primary/10' : 'bg-muted'}`}
              >
                <Icon
                  className={`h-5 w-5 ${isSelected ? 'text-primary' : option.iconColor}`}
                />
              </div>
              <div>
                <p
                  className={`text-sm font-semibold ${isSelected ? 'text-primary' : ''}`}
                >
                  {option.label}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {option.description}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Controls Bar */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-3'>
          <div className='flex items-center gap-2'>
            <Input
              type='date'
              className='w-[150px]'
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span className='text-muted-foreground text-sm'>to</span>
            <Input
              type='date'
              className='w-[150px]'
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <Button variant='outline' size='sm' className='gap-1.5'>
            <IconRefresh className='h-4 w-4' />
            Refresh
          </Button>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='sm' className='gap-1.5'>
            <IconFileSpreadsheet className='h-4 w-4' />
            Export CSV
          </Button>
          <Button variant='outline' size='sm' className='gap-1.5'>
            <IconFileTypePdf className='h-4 w-4' />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Report Content */}
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <div className='bg-muted rounded-lg p-2'>
                <IconChartBar className='text-muted-foreground h-5 w-5' />
              </div>
              <div>
                <CardTitle className='text-lg'>{currentReport.label}</CardTitle>
                <CardDescription>
                  {currentReport.description} ·{' '}
                  {format(new Date(dateFrom), 'MMM d')} –{' '}
                  {format(new Date(dateTo), 'MMM d, yyyy')}
                </CardDescription>
              </div>
            </div>
            <Badge variant='secondary' className='gap-1'>
              <IconDownload className='h-3 w-3' />
              Ready
            </Badge>
          </div>
        </CardHeader>
        <CardContent>{renderSelectedReport()}</CardContent>
      </Card>
    </div>
  )
}

export default TimeReports
