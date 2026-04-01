'use client'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Textarea } from '@/components/ui/textarea'
import type { ReviewDraft } from '@/lib/contracts'
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, LoaderCircle, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'

interface ReviewPanelProps {
  draft: ReviewDraft
  isRefreshing: boolean
  isSaving: boolean
  onBack: () => void
  onSubmit: () => void
  updateDraft: (mutate: (draft: ReviewDraft) => void, options?: { refresh?: boolean }) => void
}

export function ReviewPanel({
  draft,
  isRefreshing,
  isSaving,
  onBack,
  onSubmit,
  updateDraft,
}: ReviewPanelProps) {
  return (
    <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <Card className="rounded-[2rem]">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Review and edit</CardTitle>
            <CardDescription>
              This draft is editable. Nothing is written until you confirm.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {isRefreshing ? <LoaderCircle className="size-4 animate-spin text-[var(--muted-foreground)]" /> : null}
            <Badge>{Math.round(draft.extracted.confidence * 100)}% confidence</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {draft.interpretationOptions.length > 0 ? (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Interpretation options</h3>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Pick the candidate that best matches the source, then continue editing.
                </p>
              </div>
              <div className="space-y-3">
                {draft.interpretationOptions.map((option) => (
                  <button
                    key={option.label}
                    className={`w-full rounded-2xl border p-4 text-left ${option.selected ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--secondary)]'}`}
                    type="button"
                    onClick={() =>
                      updateDraft((next) => {
                        next.interpretationOptions = next.interpretationOptions.map((candidate) => ({
                          ...candidate,
                          selected: candidate.label === option.label,
                        }))
                        next.event.title = option.title ?? next.event.title
                        next.event.date = option.date ?? next.event.date
                        next.event.endDate = option.date ?? next.event.endDate
                        next.event.startTime = option.startTime ?? next.event.startTime
                        next.event.endTime = option.endTime ?? next.event.endTime
                        next.event.durationMinutes = option.durationMinutes ?? next.event.durationMinutes
                        next.event.timezone = option.timezone ?? next.event.timezone
                        next.event.location = option.location ?? next.event.location
                      })
                    }
                  >
                    <p className="font-medium">{option.label}</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">{option.reasoning}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Title">
              <Input
                value={draft.event.title}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.event.title = event.target.value
                  })
                }
              />
            </Field>
            <Field label="Calendar">
              <Select
                value={draft.event.calendarId}
                onValueChange={(value) =>
                  updateDraft((next) => {
                    next.event.calendarId = value
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a calendar" />
                </SelectTrigger>
                <SelectContent>
                  {draft.calendars.map((calendar) => (
                    <SelectItem key={calendar.id} value={calendar.id}>
                      {calendar.summary}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--secondary)] p-4">
            <Checkbox
              checked={draft.event.allDay}
              onCheckedChange={(checked) =>
                updateDraft((next) => {
                  next.event.allDay = checked === true
                })
              }
            />
            <div>
              <p className="font-medium">All-day event</p>
              <p className="text-sm text-[var(--muted-foreground)]">
                Skip time fields and create an all-day calendar entry.
              </p>
            </div>
          </label>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Date">
              <Input
                type="date"
                value={draft.event.date ?? ''}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.event.date = event.target.value || null
                    next.event.endDate = event.target.value || null
                  })
                }
              />
            </Field>
            <Field label="Start time">
              <Input
                disabled={draft.event.allDay}
                type="time"
                value={draft.event.startTime ?? ''}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.event.startTime = event.target.value || null
                  })
                }
              />
            </Field>
            <Field label="End time">
              <Input
                disabled={draft.event.allDay}
                type="time"
                value={draft.event.endTime ?? ''}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.event.endTime = event.target.value || null
                  })
                }
              />
            </Field>
            <Field label="Duration (minutes)">
              <Input
                disabled={draft.event.allDay}
                min={15}
                step={15}
                type="number"
                value={draft.event.durationMinutes ?? ''}
                onChange={(event) =>
                  updateDraft((next) => {
                    const parsed = Number(event.target.value)
                    next.event.durationMinutes = Number.isFinite(parsed) ? parsed : null
                  })
                }
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Timezone">
              <Input
                value={draft.event.timezone ?? ''}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.event.timezone = event.target.value || null
                  })
                }
              />
            </Field>
            <Field label="Location">
              <Input
                value={draft.event.location ?? ''}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.event.location = event.target.value || null
                  })
                }
              />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea
              value={draft.event.description ?? ''}
              onChange={(event) =>
                updateDraft((next) => {
                  next.event.description = event.target.value || null
                })
              }
            />
          </Field>

          <Field label="Recurrence rule">
            <Input
              placeholder="Optional RRULE, for example FREQ=WEEKLY;BYDAY=TU"
              value={draft.event.recurrenceRule ?? ''}
              onChange={(event) =>
                updateDraft((next) => {
                  next.event.recurrenceRule = event.target.value || null
                })
              }
            />
          </Field>

          {draft.existingEventMatches.length > 0 ? (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Create or update</h3>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Similar events were found. Choose whether to create a new event or update one of the matches.
                </p>
              </div>
              <Select
                value={
                  draft.proposedAction.type === 'update'
                    ? `update:${draft.proposedAction.eventId}`
                    : 'create'
                }
                onValueChange={(value) =>
                  updateDraft((next) => {
                    if (value === 'create') {
                      next.proposedAction = { type: 'create' }
                      next.existingEventMatches = next.existingEventMatches.map((match) => ({
                        ...match,
                        selected: false,
                      }))
                      return
                    }
                    const eventId = value.replace('update:', '')
                    const match = next.existingEventMatches.find((item) => item.eventId === eventId)
                    if (!match) {
                      return
                    }
                    next.proposedAction = {
                      type: 'update',
                      calendarId: match.calendarId,
                      eventId: match.eventId,
                    }
                    next.existingEventMatches = next.existingEventMatches.map((item) => ({
                      ...item,
                      selected: item.eventId === match.eventId,
                    }))
                  }, { refresh: false })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose create or update" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="create">Create new event</SelectItem>
                  {draft.existingEventMatches.map((match) => (
                    <SelectItem key={match.eventId} value={`update:${match.eventId}`}>
                      Update {match.title} ({match.calendarName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Attendee resolution</h3>
              <p className="text-sm text-[var(--muted-foreground)]">
                Choose a candidate or enter an email manually for each mentioned attendee.
              </p>
            </div>
            {draft.attendeeGroups.length === 0 ? (
              <Alert>
                <AlertTriangle className="size-4" />
                <AlertTitle>No attendee mentions</AlertTitle>
                <AlertDescription>
                  The current draft does not include named attendee mentions.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                {draft.attendeeGroups.map((group) => (
                  <div
                    key={group.mention}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{group.mention}</p>
                        <p className="text-sm text-[var(--muted-foreground)]">
                          {group.optional ? 'Optional attendee mention' : 'Mentioned attendee'}
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={group.approved}
                          onCheckedChange={(checked) =>
                            updateDraft((next) => {
                              const match = next.attendeeGroups.find((item) => item.mention === group.mention)
                              if (match) {
                                match.approved = checked === true
                              }
                            }, { refresh: false })
                          }
                        />
                        Approve
                      </label>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
                      <Field label="Suggested candidate">
                        <Select
                          value={group.manualEmail ? '__manual' : group.selectedEmail ?? '__none'}
                          onValueChange={(value) =>
                            updateDraft((next) => {
                              const match = next.attendeeGroups.find((item) => item.mention === group.mention)
                              if (!match) {
                                return
                              }
                              if (value === '__manual') {
                                match.selectedEmail = null
                                match.manualEmail = match.manualEmail ?? ''
                                return
                              }
                              if (value === '__none') {
                                match.selectedEmail = null
                                match.manualEmail = null
                                return
                              }
                              match.selectedEmail = value
                              match.manualEmail = null
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a candidate" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">No attendee selected</SelectItem>
                            {group.candidates.map((candidate) => (
                              <SelectItem key={candidate.email} value={candidate.email}>
                                {candidate.displayName} ({Math.round(candidate.confidence * 100)}%)
                              </SelectItem>
                            ))}
                            <SelectItem value="__manual">Enter email manually</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Manual email">
                        <Input
                          disabled={!group.manualEmail && group.selectedEmail !== null}
                          placeholder="name@example.com"
                          value={group.manualEmail ?? ''}
                          onChange={(event) =>
                            updateDraft((next) => {
                              const match = next.attendeeGroups.find((item) => item.mention === group.mention)
                              if (match) {
                                match.manualEmail = event.target.value || null
                                match.selectedEmail = null
                              }
                            }, { refresh: false })
                          }
                        />
                      </Field>
                    </div>
                    {group.candidates.length > 0 ? (
                      <ul className="mt-4 space-y-2 text-sm text-[var(--muted-foreground)]">
                        {group.candidates.map((candidate) => (
                          <li key={`${candidate.email}:${candidate.source}`}>
                            {candidate.displayName} · {candidate.email} · {candidate.reasons[0] ?? candidate.source}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                isSaving ||
                draft.reviewBlockers.some((blocker) => blocker.severity === 'blocking')
              }
              onClick={onSubmit}
            >
              {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <CalendarDays className="size-4" />}
              {draft.proposedAction.type === 'update' ? 'Update In Google Calendar' : 'Add To Google Calendar'}
            </Button>
            <Button disabled={isSaving} variant="outline" onClick={onBack}>
              Back to input
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="rounded-[2rem]">
          <CardHeader>
            <CardTitle>Signals and warnings</CardTitle>
            <CardDescription>
              Source evidence, shared facts, and review blockers stay visible here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft.smartSignals.length > 0 ? (
              <div className="space-y-3">
                {draft.smartSignals.map((signal) => (
                  <div
                    key={`${signal.label}:${signal.detail}`}
                    className="rounded-2xl bg-[var(--secondary)] p-4"
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="size-4 text-[var(--primary)]" />
                      {signal.label}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                      {signal.detail}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {draft.reviewBlockers.map((blocker) => (
              <Alert key={blocker.code} variant={blocker.severity === 'blocking' ? 'destructive' : 'default'}>
                {blocker.code === 'calendar-conflict' ? <Clock3 className="size-4" /> : <AlertTriangle className="size-4" />}
                <AlertTitle>{blocker.label}</AlertTitle>
                <AlertDescription>{blocker.detail}</AlertDescription>
              </Alert>
            ))}

            {!draft.conflictCheck.hasConflict ? (
              <Alert>
                <CheckCircle2 className="size-4" />
                <AlertTitle>No free/busy overlap detected</AlertTitle>
                <AlertDescription>
                  The current proposal does not overlap the checked calendars.
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem]">
          <CardHeader>
            <CardTitle>Evidence and context</CardTitle>
            <CardDescription>
              The draft keeps source evidence separate from assumptions and shared facts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Evidence</h3>
              <ul className="mt-2 space-y-3 text-sm text-[var(--muted-foreground)]">
                {draft.extracted.evidence.length > 0 ? (
                  draft.extracted.evidence.map((item) => (
                    <li key={`${item.field}:${item.snippet}`} className="rounded-2xl bg-[var(--secondary)] p-3">
                      <span className="font-medium text-[var(--foreground)]">{item.field}</span>
                      <p className="mt-1 leading-6">{item.snippet}</p>
                    </li>
                  ))
                ) : (
                  <li>No explicit evidence snippets were returned.</li>
                )}
              </ul>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold">Assumptions</h3>
              <ul className="mt-2 space-y-1 text-sm text-[var(--muted-foreground)]">
                {draft.extracted.assumptions.length > 0 ? (
                  draft.extracted.assumptions.map((item) => <li key={item}>• {item}</li>)
                ) : (
                  <li>No explicit assumptions were required.</li>
                )}
              </ul>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold">Shared facts</h3>
              <ul className="mt-2 space-y-1 text-sm text-[var(--muted-foreground)]">
                {draft.factsContext.promptSummary.length > 0 ? (
                  draft.factsContext.promptSummary.map((item) => <li key={item}>• {item}</li>)
                ) : (
                  <li>No active shared facts yet.</li>
                )}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function Field({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
