'use client'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ChatArtifact, ReviewDraft } from '@/lib/contracts'
import { AlertTriangle, CalendarDays, CheckCircle2, LoaderCircle, LogIn, MessageSquareText } from 'lucide-react'

export function EventDraftCard({
  artifact,
  isSaving,
  onSignIn,
  onSubmit,
}: {
  artifact: Extract<ChatArtifact, { kind: 'event-draft' }>
  isSaving: boolean
  onSignIn: () => void
  onSubmit: () => void
}) {
  const { draft } = artifact
  const primaryWarning =
    draft.reviewBlockers[0] ??
    (draft.conflictCheck.hasConflict
      ? {
          code: 'conflict',
          detail: 'This time overlaps another event on your calendar.',
          label: 'Time conflict',
          severity: 'warning' as const,
        }
      : null)
  const summary = summarizeDraft(draft)

  return (
    <Card className="glass-panel rounded-[1.6rem] border-white/40">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {draft.proposedAction.type === 'update' ? 'Ready to update' : 'Ready to create'}
          </Badge>
          <Badge variant="secondary">
            {artifact.supportsGoogleActions ? 'Google connected' : 'Extraction only'}
          </Badge>
        </div>
        <div>
          <CardTitle>{summary.title}</CardTitle>
          <CardDescription>
            {summary.when}
            {summary.where ? ` · ${summary.where}` : ''}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {primaryWarning ? (
          <Alert variant={primaryWarning.severity === 'blocking' ? 'destructive' : 'default'}>
            <AlertTriangle className="size-4" />
            <AlertTitle>{primaryWarning.label}</AlertTitle>
            <AlertDescription>{primaryWarning.detail}</AlertDescription>
          </Alert>
        ) : null}

        {!primaryWarning && !draft.conflictCheck.hasConflict && artifact.supportsGoogleActions ? (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertTitle>No conflict found</AlertTitle>
            <AlertDescription>
              The current time window does not overlap the checked calendars.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] px-4 py-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <SummaryPill label="Calendar" value={summary.calendar} />
            {summary.attendees ? <SummaryPill label="Attendees" value={summary.attendees} /> : null}
            {summary.action ? <SummaryPill label="Action" value={summary.action} /> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
          <div className="flex items-start gap-2">
            <MessageSquareText className="mt-0.5 size-4 shrink-0" />
            <p>
              Reply in chat to change anything. For example: “make it 8pm”, “add Sarah”, or “change the title to Team dinner”.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {artifact.supportsGoogleActions ? (
            <Button
              disabled={
                isSaving || draft.reviewBlockers.some((blocker) => blocker.severity === 'blocking')
              }
              onClick={onSubmit}
            >
              {isSaving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CalendarDays className="size-4" />
              )}
              {draft.proposedAction.type === 'update'
                ? 'Update Google Calendar'
                : 'Create Google Calendar event'}
            </Button>
          ) : (
            <Button onClick={onSignIn}>
              <LogIn className="size-4" />
              Sign in to use Google Calendar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function EventSuccessCard({
  artifact,
}: {
  artifact: Extract<ChatArtifact, { kind: 'event-success' }>
}) {
  const factSummary = [
    ...artifact.response.factChangesApplied.created,
    ...artifact.response.factChangesApplied.updated,
    ...artifact.response.factChangesApplied.staled,
  ]

  return (
    <Card className="glass-panel rounded-[1.6rem] border-white/40">
      <CardHeader>
        <Badge className="w-fit">Success</Badge>
        <CardTitle>Event {artifact.response.actionPerformed}</CardTitle>
        <CardDescription>
          Google Calendar accepted the write. Shared facts were updated after success.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Calendar" value={artifact.response.calendarId} />
          <Metric
            label="Notifications"
            value={
              artifact.response.sendUpdates ? 'Sent to approved attendees' : 'No attendee updates'
            }
          />
          <Metric label="Fact changes" value={String(factSummary.length)} />
        </div>

        {factSummary.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Shared fact updates</p>
            <ul className="space-y-2 text-sm text-[var(--muted-foreground)]">
              {factSummary.map((change) => (
                <li
                  key={`${change.action}:${change.kind}:${change.subject}:${change.nextValue ?? change.previousValue}`}
                  className="rounded-2xl bg-[var(--secondary)] px-4 py-3"
                >
                  <span className="font-medium text-[var(--foreground)]">{change.action}</span>{' '}
                  {change.kind}: {change.subject}
                  {change.nextValue ? ` -> ${change.nextValue}` : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Button asChild>
          <a href={artifact.response.htmlLink} rel="noreferrer" target="_blank">
            Open in Google Calendar
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}

export function SignInRequiredCard({
  artifact,
  onSignIn,
}: {
  artifact: Extract<ChatArtifact, { kind: 'sign-in-required' }>
  onSignIn: () => void
}) {
  return (
    <Card className="glass-panel rounded-[1.6rem] border-white/40">
      <CardHeader>
        <Badge variant="outline">Google sign-in needed</Badge>
        <CardTitle>Connect Google Calendar to continue</CardTitle>
        <CardDescription>{artifact.detail}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onSignIn}>
          <LogIn className="size-4" />
          Sign in with Google
        </Button>
      </CardContent>
    </Card>
  )
}

function Metric({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  )
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1">
      <span className="text-[var(--muted-foreground)]">{label}:</span>
      <span className="font-medium text-[var(--foreground)]">{value}</span>
    </span>
  )
}

function summarizeDraft(draft: ReviewDraft) {
  const title = draft.event.title || 'Untitled event'
  const when = draft.event.allDay
    ? draft.event.date
      ? `All day on ${draft.event.date}`
      : 'All-day time not set yet'
    : draft.event.date && draft.event.startTime
      ? `${draft.event.date} at ${draft.event.startTime}${draft.event.endTime ? `-${draft.event.endTime}` : draft.event.durationMinutes ? ` for ${draft.event.durationMinutes} min` : ''}`
      : 'Time not set yet'

  const calendar =
    draft.calendars.find((calendar) => calendar.id === draft.event.calendarId)?.summary ??
    draft.event.calendarId

  const approvedAttendees = draft.attendeeGroups.filter((group) => group.approved).length

  return {
    action: draft.proposedAction.type === 'update' ? 'Update existing event' : 'Create new event',
    attendees: approvedAttendees > 0 ? `${approvedAttendees} approved` : '',
    calendar,
    title,
    when,
    where: draft.event.location ?? '',
  }
}
