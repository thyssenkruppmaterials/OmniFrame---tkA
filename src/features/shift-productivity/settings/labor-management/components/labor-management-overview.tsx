// Created and developed by Jai Singh
import { Briefcase, MapPin, Target, Users } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface LaborManagementOverviewProps {
  positionStats?: {
    totalPositions?: number
    activePositions?: number
    actualHeadcount?: number
    totalHeadcountBudget?: number
  }
  areaStats?: {
    totalAreas?: number
    activeAreas?: number
  }
  assignmentCount: number
}

const setupSteps = [
  {
    title: 'Define Positions',
    description:
      'Create organizational positions like Supervisor, Team Lead, Warehouse Associate, and specialized support roles.',
  },
  {
    title: 'Create Working Areas',
    description:
      'Define physical or logical zones like Receiving Dock, Shipping Area, Quality Lab, and support desks.',
  },
  {
    title: 'Assign Users',
    description:
      'Assign team members to positions, areas, schedules, and supervisor relationships.',
  },
  {
    title: 'Review Org Chart',
    description:
      'Validate reporting lines and area supervision before relying on dashboard rollups.',
  },
]

export function LaborManagementOverview({
  positionStats,
  areaStats,
  assignmentCount,
}: LaborManagementOverviewProps) {
  const utilization = Math.round(
    ((positionStats?.actualHeadcount || 0) /
      (positionStats?.totalHeadcountBudget || 1)) *
      100
  )

  return (
    <div className='flex flex-col gap-6'>
      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between pb-2'>
            <CardTitle className='text-sm font-medium'>
              Total Positions
            </CardTitle>
            <Briefcase className='text-muted-foreground size-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {positionStats?.totalPositions || 0}
            </div>
            <p className='text-muted-foreground text-xs'>
              {positionStats?.activePositions || 0} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between pb-2'>
            <CardTitle className='text-sm font-medium'>Working Areas</CardTitle>
            <MapPin className='text-muted-foreground size-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {areaStats?.totalAreas || 0}
            </div>
            <p className='text-muted-foreground text-xs'>
              {areaStats?.activeAreas || 0} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between pb-2'>
            <CardTitle className='text-sm font-medium'>
              Total Assignments
            </CardTitle>
            <Users className='text-muted-foreground size-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>{assignmentCount}</div>
            <p className='text-muted-foreground text-xs'>
              {positionStats?.actualHeadcount || 0} active workers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between pb-2'>
            <CardTitle className='text-sm font-medium'>
              Headcount Budget
            </CardTitle>
            <Target className='text-muted-foreground size-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {positionStats?.totalHeadcountBudget || 0}
            </div>
            <p className='text-muted-foreground text-xs'>
              {utilization}% utilized
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Operating Model Setup</CardTitle>
          <CardDescription>
            Build the model in this order so dashboards, labor standards, and
            reporting relationships stay coherent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='grid gap-4 md:grid-cols-2'>
            {setupSteps.map((step, index) => (
              <div
                key={step.title}
                className='flex items-start gap-4 rounded-lg border p-4'
              >
                <div className='bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold'>
                  {index + 1}
                </div>
                <div className='min-w-0'>
                  <h4 className='font-semibold'>{step.title}</h4>
                  <p className='text-muted-foreground text-sm'>
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Created and developed by Jai Singh
