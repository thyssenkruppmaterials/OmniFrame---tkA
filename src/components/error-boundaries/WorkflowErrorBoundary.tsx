// Created and developed by Jai Singh
/**
 * Workflow Error Boundary (Phase 4.5).
 *
 * Generalizes the prior `CycleCountErrorBoundary` to wrap any registry-driven
 * RootComponent. Accepts a `workTypeId` prop so error reports carry the
 * specific work type for triage and dashboard slicing.
 *
 * Sentry integration: when `window.__OMNI_SENTRY_CAPTURE` is wired by the
 * app shell (Phase 12.4a), the error boundary forwards `error`, `componentStack`,
 * and `tags = { work_type, flow }`. We do NOT pull in `@sentry/react` as a
 * dep here; the indirection keeps the boundary build-clean even if Sentry is
 * not initialized in a given environment.
 */
import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  children: ReactNode
  /** Slug of the WorkType this boundary wraps. Logged + tagged in telemetry. */
  workTypeId?: string
  /** RF or supervisor flow tag — passed to Sentry for slicing. */
  flow?: 'rf' | 'supervisor'
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

declare global {
  interface Window {
    __OMNI_SENTRY_CAPTURE?: (
      err: Error,
      ctx: { tags: Record<string, string>; componentStack: string }
    ) => void
  }
}

export class WorkflowErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(
      `🔴 WorkflowErrorBoundary caught: workTypeId=${this.props.workTypeId ?? 'unknown'}`,
      error
    )
    logger.error('Component stack:', errorInfo.componentStack)
    this.setState({ errorInfo })

    if (typeof window !== 'undefined' && window.__OMNI_SENTRY_CAPTURE) {
      try {
        window.__OMNI_SENTRY_CAPTURE(error, {
          tags: {
            work_type: this.props.workTypeId ?? 'unknown',
            flow: this.props.flow ?? 'rf',
          },
          componentStack: errorInfo.componentStack ?? '',
        })
      } catch (e) {
        logger.error('Sentry forward failed:', e)
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
    this.props.onReset?.()
  }

  handleRefresh = () => window.location.reload()

  render() {
    if (this.state.hasError) {
      return (
        <div className='bg-background flex min-h-screen items-center justify-center p-4'>
          <Card className='w-full max-w-md border-red-200'>
            <CardContent className='pt-6'>
              <div className='space-y-4 text-center'>
                <div className='flex justify-center'>
                  <div className='rounded-full bg-red-100 p-3 dark:bg-red-900/20'>
                    <AlertTriangle className='h-12 w-12 text-red-600 dark:text-red-400' />
                  </div>
                </div>

                <div className='space-y-2'>
                  <h2 className='text-foreground text-xl font-semibold'>
                    Something went wrong
                  </h2>
                  <p className='text-muted-foreground text-sm'>
                    We hit an error in{' '}
                    {this.props.workTypeId ?? 'this workflow'}.{' '}
                    <span className='font-medium text-green-600 dark:text-green-400'>
                      Your task is still assigned to you. Re-enter to continue
                      where you left off.
                    </span>
                  </p>
                </div>

                {import.meta.env.DEV && this.state.error && (
                  <details className='text-left'>
                    <summary className='text-muted-foreground hover:text-foreground cursor-pointer text-xs'>
                      Technical Details (Dev Only)
                    </summary>
                    <div className='bg-muted mt-2 rounded-md p-3'>
                      <p className='font-mono text-xs break-all text-red-600 dark:text-red-400'>
                        {this.state.error.message}
                      </p>
                      {this.state.error.stack && (
                        <pre className='mt-2 max-h-40 overflow-auto text-xs'>
                          {this.state.error.stack}
                        </pre>
                      )}
                    </div>
                  </details>
                )}

                <div className='flex flex-col gap-2 pt-4'>
                  <Button onClick={this.handleReset} className='w-full'>
                    <RefreshCw className='mr-2 h-4 w-4' />
                    Try Again
                  </Button>
                  <Button
                    variant='outline'
                    onClick={this.handleRefresh}
                    className='w-full'
                  >
                    Refresh Page
                  </Button>
                  <Button
                    variant='ghost'
                    onClick={() => (window.location.href = '/rf-interface')}
                    className='w-full'
                  >
                    <Home className='mr-2 h-4 w-4' />
                    Return to Home
                  </Button>
                </div>

                <p className='text-muted-foreground pt-2 text-xs'>
                  If this error persists, please contact your system
                  administrator
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}

/** HOC for functional components. */
export function withWorkflowErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  opts?: {
    workTypeId?: string
    flow?: 'rf' | 'supervisor'
    onReset?: () => void
  }
): React.FC<P> {
  return (props: P) => (
    <WorkflowErrorBoundary {...opts}>
      <Component {...props} />
    </WorkflowErrorBoundary>
  )
}

/**
 * Backwards-compatible alias. Existing call sites use
 * `CycleCountErrorBoundary`; they continue to work — the new prop API is
 * additive. Phase 8 cleanup deletes this alias once all callers migrate.
 */
export const CycleCountErrorBoundary = WorkflowErrorBoundary
export const withCycleCountErrorBoundary = withWorkflowErrorBoundary

// Created and developed by Jai Singh
