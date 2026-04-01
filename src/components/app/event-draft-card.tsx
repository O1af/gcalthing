'use client'

import { Button } from '@/components/ui/button'
import type { ChatArtifact, ReviewDraft } from '@/lib/contracts'
import { AlertTriangle, CalendarDays, CheckCircle2, ExternalLink, LoaderCircle, LogIn } from 'lucide-react'

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
  const summary = summarizeDraft(draft)
  const hasBlocker = draft.reviewBlockers.some((b) => b.severity === 'blocking')
  const primaryWarning =
    draft.reviewBlockers[0] ??
    (draft.conflictCheck.hasConflict
      ? { label: 'Time conflict', detail: 'Overlaps another event.', severity: 'warning' as const }
      : null)

  return (
    <div className="my-2 rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{summary.title}</p>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
              {summary.when}
              {summary.where ? ` · ${summary.where}` : ''}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted-foreground)]">
            {draft.proposedAction.type === 'update' ? 'Update' : 'Create'}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          <Pill label="Calendar" value={summary.calendar} />
          {summary.attendees && <Pill label="Attendees" value={summary.attendees} />}
        </div>
      </div>

      {primaryWarning && (
        <div className={`flex items-start gap-2 border-t border-[var(--border)] px-4 py-2.5 text-sm ${
          primaryWarning.severity === 'blocking'
            ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
            : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
        }`}>
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{primaryWarning.label}: {primaryWarning.detail}</span>
        </div>
      )}

      {!primaryWarning && !draft.conflictCheck.hasConflict && artifact.supportsGoogleActions && (
        <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2.5 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" />
          <span>No conflicts found</span>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2.5">
        {artifact.supportsGoogleActions ? (
          <Button
            disabled={isSaving || hasBlocker}
            onClick={onSubmit}
            size="sm"
            className="h-8 gap-1.5"
          >
            {isSaving ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <CalendarDays className="size-3.5" />
            )}
            {draft.proposedAction.type === 'update' ? 'Update event' : 'Create event'}
          </Button>
        ) : (
          <Button onClick={onSignIn} size="sm" className="h-8 gap-1.5">
            <LogIn className="size-3.5" />
            Sign in to create
          </Button>
        )}
        <p className="text-xs text-[var(--muted-foreground)]">
          Reply to revise the draft
        </p>
      </div>
    </div>
  )
}

export function EventSuccessCard({
  artifact,
}: {
  artifact: Extract<ChatArtifact, { kind: 'event-success' }>
}) {
  return (
    <div className="my-2 rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 size-4 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-medium text-emerald-900 dark:text-emerald-100">
              Event {artifact.response.actionPerformed}
            </p>
            <p className="mt-0.5 text-sm text-emerald-700 dark:text-emerald-300">
              Written to {artifact.response.calendarId}
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
          <a href={artifact.response.htmlLink} rel="noreferrer" target="_blank">
            Open <ExternalLink className="size-3" />
          </a>
        </Button>
      </div>
    </div>
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
    <div className="my-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <p className="text-sm font-medium">Google sign-in needed</p>
      <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{artifact.detail}</p>
      <Button onClick={onSignIn} size="sm" className="mt-3 h-8 gap-1.5">
        <LogIn className="size-3.5" />
        Sign in with Google
      </Button>
    </div>
  )
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-0.5">
      <span className="text-[var(--muted-foreground)]">{label}:</span>
      <span className="font-medium">{value}</span>
    </span>
  )
}

function summarizeDraft(draft: ReviewDraft) {
  const title = draft.event.title || 'Untitled event'
  const when = draft.event.allDay
    ? draft.event.date
      ? `All day on ${draft.event.date}`
      : 'All-day time not set'
    : draft.event.date && draft.event.startTime
      ? `${draft.event.date} at ${draft.event.startTime}${draft.event.endTime ? `–${draft.event.endTime}` : draft.event.durationMinutes ? ` (${draft.event.durationMinutes} min)` : ''}`
      : 'Time not set'

  const calendar =
    draft.calendars.find((c) => c.id === draft.event.calendarId)?.summary ??
    draft.event.calendarId

  const approvedAttendees = draft.attendeeGroups.filter((g) => g.approved).length

  return {
    attendees: approvedAttendees > 0 ? `${approvedAttendees} approved` : '',
    calendar,
    title,
    when,
    where: draft.event.location ?? '',
  }
}
