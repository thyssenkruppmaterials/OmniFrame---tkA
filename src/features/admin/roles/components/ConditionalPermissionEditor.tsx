// Created and developed by Jai Singh
import { useState } from 'react'
import {
  IconCalendar,
  IconClock,
  IconMapPin,
  IconPlus,
  IconShield,
  IconTrash,
  IconWorld,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface PermissionCondition {
  time?: {
    allowed_days?: string[]
    start_time?: string
    end_time?: string
    timezone?: string
  }
  location?: {
    allowed_countries?: string[]
    allowed_regions?: string[]
    blocked_countries?: string[]
  }
  ip?: {
    whitelist?: string[]
    blacklist?: string[]
  }
  custom?: Record<string, unknown>
}

interface ConditionalPermissionEditorProps {
  permission: {
    id: string
    resource: string
    action: string
  }
  conditions?: PermissionCondition
  validFrom?: Date
  validTo?: Date
  requiresConditions?: boolean
  conditionLogic?: 'AND' | 'OR'
  onChange: (updates: {
    conditions?: PermissionCondition
    validFrom?: Date
    validTo?: Date
    requiresConditions?: boolean
    conditionLogic?: 'AND' | 'OR'
  }) => void
}

export function ConditionalPermissionEditor({
  permission,
  conditions = {},
  validFrom,
  validTo,
  requiresConditions = false,
  conditionLogic = 'AND',
  onChange,
}: ConditionalPermissionEditorProps) {
  const [localConditions, setLocalConditions] =
    useState<PermissionCondition>(conditions)
  const [localValidFrom, setLocalValidFrom] = useState<string>(
    validFrom ? validFrom.toISOString().slice(0, 16) : ''
  )
  const [localValidTo, setLocalValidTo] = useState<string>(
    validTo ? validTo.toISOString().slice(0, 16) : ''
  )

  const dayOfWeek = [
    { value: '0', label: 'Sunday' },
    { value: '1', label: 'Monday' },
    { value: '2', label: 'Tuesday' },
    { value: '3', label: 'Wednesday' },
    { value: '4', label: 'Thursday' },
    { value: '5', label: 'Friday' },
    { value: '6', label: 'Saturday' },
  ]

  const commonCountries = [
    'United States',
    'Canada',
    'United Kingdom',
    'Germany',
    'France',
    'Australia',
    'Japan',
    'India',
    'Brazil',
    'Mexico',
  ]

  const handleConditionUpdate = (newConditions: PermissionCondition) => {
    setLocalConditions(newConditions)
    onChange({
      conditions: newConditions,
      validFrom: localValidFrom ? new Date(localValidFrom) : undefined,
      validTo: localValidTo ? new Date(localValidTo) : undefined,
      requiresConditions,
      conditionLogic,
    })
  }

  const updateTimeConditions = (
    updates: Partial<PermissionCondition['time']>
  ) => {
    const newConditions = {
      ...localConditions,
      time: { ...localConditions.time, ...updates },
    }
    handleConditionUpdate(newConditions)
  }

  // Removed unused updateLocationConditions and updateIPConditions functions

  const addToArray = (path: string, value: string) => {
    const pathParts = path.split('.')
    const newConditions = { ...localConditions }

    if (pathParts.length === 2) {
      const [section, field] = pathParts
      if (!newConditions[section as keyof PermissionCondition]) {
        newConditions[section as keyof PermissionCondition] =
          {} as PermissionCondition[keyof PermissionCondition]
      }
      const sectionObj = newConditions[
        section as keyof PermissionCondition
      ] as Record<string, unknown>
      const currentArray = (sectionObj[field] as string[]) || []
      sectionObj[field] = [...currentArray, value]
    }

    handleConditionUpdate(newConditions)
  }

  const removeFromArray = (path: string, index: number) => {
    const pathParts = path.split('.')
    const newConditions = { ...localConditions }

    if (pathParts.length === 2) {
      const [section, field] = pathParts
      const sectionObj = newConditions[section as keyof PermissionCondition] as
        | Record<string, unknown>
        | undefined
      const currentArray = (sectionObj?.[field] as string[]) || []
      currentArray.splice(index, 1)
      if (sectionObj) {
        sectionObj[field] = currentArray
      }
    }

    handleConditionUpdate(newConditions)
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>
            Conditional Permission Settings
          </h3>
          <p className='text-muted-foreground text-sm'>
            Configure restrictions for {permission.resource}:{permission.action}
          </p>
        </div>
        <div className='flex items-center space-x-2'>
          <Label htmlFor='requires-conditions'>Enable Conditions</Label>
          <Switch
            id='requires-conditions'
            checked={requiresConditions}
            onCheckedChange={(checked) =>
              onChange({
                conditions: localConditions,
                validFrom: localValidFrom
                  ? new Date(localValidFrom)
                  : undefined,
                validTo: localValidTo ? new Date(localValidTo) : undefined,
                requiresConditions: checked,
                conditionLogic,
              })
            }
          />
        </div>
      </div>

      {requiresConditions && (
        <>
          {/* Condition Logic */}
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Condition Logic</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='flex items-center space-x-4'>
                <Label>When multiple conditions are set:</Label>
                <Select
                  value={conditionLogic}
                  onValueChange={(value: 'AND' | 'OR') =>
                    onChange({
                      conditions: localConditions,
                      validFrom: localValidFrom
                        ? new Date(localValidFrom)
                        : undefined,
                      validTo: localValidTo
                        ? new Date(localValidTo)
                        : undefined,
                      requiresConditions,
                      conditionLogic: value,
                    })
                  }
                >
                  <SelectTrigger className='w-32'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='AND'>ALL must match</SelectItem>
                    <SelectItem value='OR'>ANY can match</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Time Validity */}
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center space-x-2'>
                <IconCalendar className='h-4 w-4' />
                <span>Time Validity</span>
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div>
                  <Label htmlFor='valid-from'>Valid From</Label>
                  <Input
                    id='valid-from'
                    type='datetime-local'
                    value={localValidFrom}
                    onChange={(e) => {
                      setLocalValidFrom(e.target.value)
                      onChange({
                        conditions: localConditions,
                        validFrom: e.target.value
                          ? new Date(e.target.value)
                          : undefined,
                        validTo: localValidTo
                          ? new Date(localValidTo)
                          : undefined,
                        requiresConditions,
                        conditionLogic,
                      })
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor='valid-to'>Valid To</Label>
                  <Input
                    id='valid-to'
                    type='datetime-local'
                    value={localValidTo}
                    onChange={(e) => {
                      setLocalValidTo(e.target.value)
                      onChange({
                        conditions: localConditions,
                        validFrom: localValidFrom
                          ? new Date(localValidFrom)
                          : undefined,
                        validTo: e.target.value
                          ? new Date(e.target.value)
                          : undefined,
                        requiresConditions,
                        conditionLogic,
                      })
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Conditional Restrictions */}
          <Tabs defaultValue='time' className='space-y-4'>
            <TabsList className='grid w-full grid-cols-3'>
              <TabsTrigger value='time' className='flex items-center space-x-1'>
                <IconClock className='h-4 w-4' />
                <span>Time</span>
              </TabsTrigger>
              <TabsTrigger
                value='location'
                className='flex items-center space-x-1'
              >
                <IconMapPin className='h-4 w-4' />
                <span>Location</span>
              </TabsTrigger>
              <TabsTrigger value='ip' className='flex items-center space-x-1'>
                <IconWorld className='h-4 w-4' />
                <span>IP Address</span>
              </TabsTrigger>
            </TabsList>

            {/* Time Restrictions */}
            <TabsContent value='time'>
              <Card>
                <CardHeader>
                  <CardTitle className='flex items-center space-x-2'>
                    <IconClock className='h-4 w-4' />
                    <span>Time-Based Restrictions</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-6'>
                  {/* Days of Week */}
                  <div>
                    <Label className='mb-3 block text-sm font-medium'>
                      Allowed Days
                    </Label>
                    <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
                      {dayOfWeek.map((day) => (
                        <div
                          key={day.value}
                          className='flex items-center space-x-2'
                        >
                          <Switch
                            id={`day-${day.value}`}
                            checked={
                              localConditions.time?.allowed_days?.includes(
                                day.value
                              ) || false
                            }
                            onCheckedChange={(checked) => {
                              const currentDays =
                                localConditions.time?.allowed_days || []
                              const newDays = checked
                                ? [...currentDays, day.value]
                                : currentDays.filter((d) => d !== day.value)
                              updateTimeConditions({ allowed_days: newDays })
                            }}
                          />
                          <Label
                            htmlFor={`day-${day.value}`}
                            className='text-sm'
                          >
                            {day.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Time Range */}
                  <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                    <div>
                      <Label htmlFor='start-time'>Start Time</Label>
                      <Input
                        id='start-time'
                        type='time'
                        value={localConditions.time?.start_time || ''}
                        onChange={(e) =>
                          updateTimeConditions({ start_time: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor='end-time'>End Time</Label>
                      <Input
                        id='end-time'
                        type='time'
                        value={localConditions.time?.end_time || ''}
                        onChange={(e) =>
                          updateTimeConditions({ end_time: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  {/* Timezone */}
                  <div>
                    <Label htmlFor='timezone'>Timezone</Label>
                    <Select
                      value={localConditions.time?.timezone || 'UTC'}
                      onValueChange={(value) =>
                        updateTimeConditions({ timezone: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder='Select timezone' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='UTC'>UTC</SelectItem>
                        <SelectItem value='America/New_York'>
                          Eastern (EST/EDT)
                        </SelectItem>
                        <SelectItem value='America/Chicago'>
                          Central (CST/CDT)
                        </SelectItem>
                        <SelectItem value='America/Denver'>
                          Mountain (MST/MDT)
                        </SelectItem>
                        <SelectItem value='America/Los_Angeles'>
                          Pacific (PST/PDT)
                        </SelectItem>
                        <SelectItem value='Europe/London'>
                          London (GMT/BST)
                        </SelectItem>
                        <SelectItem value='Europe/Berlin'>
                          Berlin (CET/CEST)
                        </SelectItem>
                        <SelectItem value='Asia/Tokyo'>Tokyo (JST)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Location Restrictions */}
            <TabsContent value='location'>
              <Card>
                <CardHeader>
                  <CardTitle className='flex items-center space-x-2'>
                    <IconMapPin className='h-4 w-4' />
                    <span>Geographic Restrictions</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-6'>
                  {/* Allowed Countries */}
                  <div>
                    <Label className='mb-2 block text-sm font-medium'>
                      Allowed Countries
                    </Label>
                    <div className='space-y-2'>
                      <div className='flex items-center space-x-2'>
                        <Select
                          onValueChange={(value) =>
                            addToArray('location.allowed_countries', value)
                          }
                        >
                          <SelectTrigger className='min-w-0 flex-1'>
                            <SelectValue placeholder='Add country...' />
                          </SelectTrigger>
                          <SelectContent>
                            {commonCountries.map((country) => (
                              <SelectItem key={country} value={country}>
                                {country}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant='outline' size='sm'>
                          <IconPlus className='h-4 w-4' />
                        </Button>
                      </div>
                      <div className='flex flex-wrap gap-2'>
                        {(
                          localConditions.location?.allowed_countries || []
                        ).map((country, index) => (
                          <Badge
                            key={index}
                            variant='secondary'
                            className='flex items-center space-x-1'
                          >
                            <span>{country}</span>
                            <Button
                              variant='ghost'
                              size='sm'
                              className='ml-1 h-auto p-0'
                              onClick={() =>
                                removeFromArray(
                                  'location.allowed_countries',
                                  index
                                )
                              }
                            >
                              <IconTrash className='h-3 w-3' />
                            </Button>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Blocked Countries */}
                  <div>
                    <Label className='mb-2 block text-sm font-medium'>
                      Blocked Countries
                    </Label>
                    <div className='space-y-2'>
                      <div className='flex items-center space-x-2'>
                        <Select
                          onValueChange={(value) =>
                            addToArray('location.blocked_countries', value)
                          }
                        >
                          <SelectTrigger className='min-w-0 flex-1'>
                            <SelectValue placeholder='Add country to block...' />
                          </SelectTrigger>
                          <SelectContent>
                            {commonCountries.map((country) => (
                              <SelectItem key={country} value={country}>
                                {country}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant='outline' size='sm'>
                          <IconPlus className='h-4 w-4' />
                        </Button>
                      </div>
                      <div className='flex flex-wrap gap-2'>
                        {(
                          localConditions.location?.blocked_countries || []
                        ).map((country, index) => (
                          <Badge
                            key={index}
                            variant='destructive'
                            className='flex items-center space-x-1'
                          >
                            <span>{country}</span>
                            <Button
                              variant='ghost'
                              size='sm'
                              className='ml-1 h-auto p-0'
                              onClick={() =>
                                removeFromArray(
                                  'location.blocked_countries',
                                  index
                                )
                              }
                            >
                              <IconTrash className='h-3 w-3' />
                            </Button>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* IP Restrictions */}
            <TabsContent value='ip'>
              <Card>
                <CardHeader>
                  <CardTitle className='flex items-center space-x-2'>
                    <IconShield className='h-4 w-4' />
                    <span>IP Address Restrictions</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-6'>
                  {/* IP Whitelist */}
                  <div>
                    <Label className='mb-2 block text-sm font-medium'>
                      IP Whitelist
                    </Label>
                    <div className='space-y-2'>
                      <div className='flex items-center space-x-2'>
                        <Input
                          placeholder='192.168.1.0/24 or 10.0.0.1'
                          onKeyDown={(e) => {
                            if (
                              e.key === 'Enter' &&
                              e.currentTarget.value.trim()
                            ) {
                              addToArray(
                                'ip.whitelist',
                                e.currentTarget.value.trim()
                              )
                              e.currentTarget.value = ''
                            }
                          }}
                        />
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={(e) => {
                            const input =
                              e.currentTarget.parentElement?.querySelector(
                                'input'
                              ) as HTMLInputElement
                            if (input?.value.trim()) {
                              addToArray('ip.whitelist', input.value.trim())
                              input.value = ''
                            }
                          }}
                        >
                          <IconPlus className='h-4 w-4' />
                        </Button>
                      </div>
                      <div className='space-y-1'>
                        {(localConditions.ip?.whitelist || []).map(
                          (ip, index) => (
                            <div
                              key={index}
                              className='flex items-center justify-between rounded bg-green-50 p-2'
                            >
                              <span className='font-mono text-sm'>{ip}</span>
                              <Button
                                variant='ghost'
                                size='sm'
                                onClick={() =>
                                  removeFromArray('ip.whitelist', index)
                                }
                              >
                                <IconTrash className='h-3 w-3' />
                              </Button>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* IP Blacklist */}
                  <div>
                    <Label className='mb-2 block text-sm font-medium'>
                      IP Blacklist
                    </Label>
                    <div className='space-y-2'>
                      <div className='flex items-center space-x-2'>
                        <Input
                          placeholder='192.168.1.0/24 or 10.0.0.1'
                          onKeyDown={(e) => {
                            if (
                              e.key === 'Enter' &&
                              e.currentTarget.value.trim()
                            ) {
                              addToArray(
                                'ip.blacklist',
                                e.currentTarget.value.trim()
                              )
                              e.currentTarget.value = ''
                            }
                          }}
                        />
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={(e) => {
                            const input =
                              e.currentTarget.parentElement?.querySelector(
                                'input'
                              ) as HTMLInputElement
                            if (input?.value.trim()) {
                              addToArray('ip.blacklist', input.value.trim())
                              input.value = ''
                            }
                          }}
                        >
                          <IconPlus className='h-4 w-4' />
                        </Button>
                      </div>
                      <div className='space-y-1'>
                        {(localConditions.ip?.blacklist || []).map(
                          (ip, index) => (
                            <div
                              key={index}
                              className='flex items-center justify-between rounded bg-red-50 p-2'
                            >
                              <span className='font-mono text-sm'>{ip}</span>
                              <Button
                                variant='ghost'
                                size='sm'
                                onClick={() =>
                                  removeFromArray('ip.blacklist', index)
                                }
                              >
                                <IconTrash className='h-3 w-3' />
                              </Button>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
