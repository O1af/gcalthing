'use client'

import { ArrowDownIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import {
  StickToBottom,
  useStickToBottomContext,
  type StickToBottomInstance,
} from 'use-stick-to-bottom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ConversationProps = ComponentProps<typeof StickToBottom>

export interface ConversationRootProps
  extends Omit<ComponentProps<typeof StickToBottom>, 'children'> {
  children: ReactNode
  instance: StickToBottomInstance
}

export function ConversationRoot({
  children,
  className,
  instance,
  ...props
}: ConversationRootProps) {
  return (
    <StickToBottom
      className={cn('relative flex min-h-0 flex-1 flex-col', className)}
      instance={instance}
      role="log"
      {...props}
    >
      {children}
    </StickToBottom>
  )
}

export function Conversation({ className, ...props }: ConversationProps) {
  return (
    <StickToBottom
      className={cn('relative flex-1 overflow-y-hidden overscroll-contain', className)}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    />
  )
}

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>

export function ConversationContent({
  className,
  ...props
}: ConversationContentProps) {
  return (
    <StickToBottom.Content
      className={cn('flex flex-col gap-8 p-4', className)}
      {...props}
    />
  )
}

export type ConversationBodyProps = ComponentProps<'div'>

export function ConversationBody({
  className,
  ...props
}: ConversationBodyProps) {
  return (
    <div
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  )
}

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  description?: string
  icon?: ReactNode
  title?: string
}

export function ConversationEmptyState({
  children,
  className,
  description = 'Start a conversation to see messages here',
  icon,
  title = 'No messages yet',
  ...props
}: ConversationEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          {icon ? <div className="text-muted-foreground">{icon}</div> : null}
          <div className="space-y-1">
            <h3 className="font-medium text-sm">{title}</h3>
            {description ? (
              <p className="text-muted-foreground text-sm">{description}</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

export type ConversationScrollButtonProps = ComponentProps<typeof Button> & {
  containerClassName?: string
}

export function ConversationScrollButton({
  className,
  containerClassName,
  ...props
}: ConversationScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()

  if (isAtBottom) {
    return null
  }

  return (
    <div
      className={cn(
        'pointer-events-none sticky bottom-4 z-10 flex justify-center',
        containerClassName,
      )}
    >
      <Button
        aria-label="Scroll to bottom"
        className={cn(
          'pointer-events-auto rounded-full dark:bg-background dark:hover:bg-muted',
          className,
        )}
        onClick={() => scrollToBottom()}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    </div>
  )
}
