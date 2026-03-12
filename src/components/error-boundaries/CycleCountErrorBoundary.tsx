/**
 * Cycle Count Error Boundary Component
 * Catches errors in the cycle count workflow and provides graceful fallback UI
 * Prevents app crashes from propagating to the entire RF interface
 */
import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  children: ReactNode
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class CycleCountErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console for debugging
    logger.error('🔴 Cycle Count Error Boundary caught an error:', error)
    logger.error('Error Info:', errorInfo)

    // Store error info in state for display
    this.setState({
      errorInfo,
    })

    // TODO: Send to error tracking service (e.g., Sentry, LogRocket)
    // logger.error('cycle-count-error', {
    //   error: error.message,
    //   stack: error.stack,
    //   componentStack: errorInfo.componentStack
    // });
  }

  handleReset = () => {
    // Clear error state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })

    // Call optional reset handler
    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  handleRefresh = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className='bg-background flex min-h-screen items-center justify-center p-4'>
          <Card className='w-full max-w-md border-red-200'>
            <CardContent className='pt-6'>
              <div className='space-y-4 text-center'>
                {/* Error Icon */}
                <div className='flex justify-center'>
                  <div className='rounded-full bg-red-100 p-3 dark:bg-red-900/20'>
                    <AlertTriangle className='h-12 w-12 text-red-600 dark:text-red-400' />
                  </div>
                </div>

                {/* Error Message */}
                <div className='space-y-2'>
                  <h2 className='text-foreground text-xl font-semibold'>
                    Something went wrong
                  </h2>
                  <p className='text-muted-foreground text-sm'>
                    We encountered an error while processing your cycle count.{' '}
                    <span className='font-medium text-green-600 dark:text-green-400'>
                      Your progress has been saved automatically.
                    </span>
                  </p>
                </div>

                {/* Error Details (Development Only) */}
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

                {/* Action Buttons */}
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

                {/* Help Text */}
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

/**
 * Hook-based Error Boundary Wrapper
 * For use with functional components that need error boundary protection
 */
export function withCycleCountErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  onReset?: () => void
): React.FC<P> {
  return (props: P) => (
    <CycleCountErrorBoundary onReset={onReset}>
      <Component {...props} />
    </CycleCountErrorBoundary>
  )
}
