'use client'

import { Button } from '@/components/ui/button'
import type { ChatNotice } from '@/lib/contracts'
import { CheckCircle2, ExternalLink, LogIn } from 'lucide-react'

export function EventSuccessCard(props: {
  notice: Extract<ChatNotice, { kind: 'event-success' }>
}): React.JSX.Element {
  const { notice } = props
  const title =
    notice.response.actionPerformed === 'deleted'
      ? 'Event deleted'
      : notice.response.actionPerformed === 'updated'
        ? 'Event updated'
        : 'Event created'
  const detail =
    notice.response.actionPerformed === 'deleted'
      ? `Removed from ${notice.response.calendarId}`
      : `Written to ${notice.response.calendarId}`

  return (
    <div className="my-2 rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 size-4 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-medium text-emerald-900 dark:text-emerald-100">{title}</p>
            <p className="mt-0.5 text-sm text-emerald-700 dark:text-emerald-300">{detail}</p>
          </div>
        </div>
        {notice.response.htmlLink ? (
          <Button asChild className="h-7 gap-1.5 text-xs" size="sm" variant="outline">
            <a href={notice.response.htmlLink} rel="noreferrer" target="_blank">
              Open <ExternalLink className="size-3" />
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function SignInRequiredCard(props: {
  notice: Extract<ChatNotice, { kind: 'sign-in-required' }>
  onSignIn: () => void
}): React.JSX.Element {
  const { notice, onSignIn } = props

  return (
    <div className="my-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <p className="text-sm font-medium">Google sign-in needed</p>
      <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{notice.detail}</p>
      <Button className="mt-3 h-8 gap-1.5" onClick={onSignIn} size="sm">
        <LogIn className="size-3.5" />
        Sign in with Google
      </Button>
    </div>
  )
}
