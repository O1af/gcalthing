import { differenceInDays } from 'date-fns'
import type {
  AttendeeCandidate,
  AttendeeResolutionGroup,
  CalendarContextSummary,
  CalendarSuggestion,
  ConflictCheckResult,
  DraftIntent,
  ExistingEventMatch,
  FactsContext,
  ReviewDraft,
} from '@/lib/contracts'
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from '@/lib/server/google-calendar'
import {
  calendarContextSummarySchema,
  conflictCheckResultSchema,
  getSelectedAttendees,
} from '@/lib/contracts'
import { clamp, normalizeText, similarity } from '@/lib/domain/text'
import {
  MATCH_LOOSE,
  MATCH_VERY_STRICT,
  SIMILARITY_LOOSE,
} from '@/lib/server/similarity-thresholds'

interface AttendeeAggregate {
  displayName: string
  email: string
  count: number
  lastSeenAt: string
  calendarIds: Set<string>
}

export function summarizeCalendarContext(
  calendars: GoogleCalendarListEntry[],
  events: GoogleCalendarEvent[],
): CalendarContextSummary {
  const titleCounts = new Map<string, number>()
  const locationCounts = new Map<string, number>()

  for (const event of events) {
    const summary = event.summary?.trim()
    if (summary) {
      titleCounts.set(summary, (titleCounts.get(summary) ?? 0) + 1)
    }

    const location = event.location?.trim()
    if (location) {
      locationCounts.set(location, (locationCounts.get(location) ?? 0) + 1)
    }
  }

  const attendeeDirectory = buildAttendeeDirectory(events)

  return calendarContextSummarySchema.parse({
    attendeeDirectory: [...attendeeDirectory.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, 30)
      .map((entry) => ({
        count: entry.count,
        displayName: entry.displayName,
        email: entry.email,
        lastSeenAt: entry.lastSeenAt,
      })),
    calendars: calendars.map((calendar) => ({
      accessRole: calendar.accessRole,
      id: calendar.id,
      primary: Boolean(calendar.primary),
      summary: calendar.summary,
      timeZone: calendar.timeZone ?? null,
    })),
    frequentLocations: [...locationCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([location, count]) => ({ count, location })),
    recentTitles: [...titleCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([title, count]) => ({ count, title })),
  })
}

export function resolveAttendeeGroups(
  intent: DraftIntent,
  events: GoogleCalendarEvent[],
  factsContext: FactsContext,
  previousGroups: AttendeeResolutionGroup[] = [],
) {
  const directory = buildAttendeeDirectory(events)

  return intent.attendeeMentions.map((mention) => {
    const previousGroup = previousGroups.find(
      (group) => normalizeText(group.mention) === normalizeText(mention.name),
    )
    const factCandidates = factsContext.facts
      .filter(
        (fact) =>
          fact.status === 'active' &&
          fact.kind === 'attendee-alias' &&
          normalizeText(fact.subject) === normalizeText(mention.name),
      )
      .map<AttendeeCandidate>((fact) => ({
        mention: mention.name,
        displayName:
          previousGroup?.candidates.find((candidate) => candidate.email === fact.value)
            ?.displayName ?? mention.name,
        email: fact.value,
        confidence: Math.min(0.94, Math.max(fact.confidence, 0.72)),
        reasons: ['Matched an active shared fact from prior confirmed event reviews'],
        source: 'shared-fact',
        autoSelected: fact.confidence >= 0.9,
      }))

    const calendarCandidates = [...directory.values()].map<AttendeeCandidate>((candidate) => {
      const exactName = normalizeText(mention.name) === normalizeText(candidate.displayName)
      const firstNameMatch = normalizeText(candidate.displayName)
        .split(' ')[0]
        ?.startsWith(normalizeText(mention.name))
      const emailLocal = candidate.email.split('@')[0] ?? ''
      const localMatch = emailLocal.includes(normalizeText(mention.name))
      const recencyBonus = recencyScore(candidate.lastSeenAt)
      const frequencyBonus = Math.min(candidate.count / 8, 0.25)
      const confidence = clamp(
        (exactName ? 0.55 : 0.2) +
          (firstNameMatch ? 0.23 : 0) +
          (localMatch ? 0.12 : 0) +
          recencyBonus +
          frequencyBonus,
        0,
        0.95,
      )

      return {
        mention: mention.name,
        displayName: candidate.displayName,
        email: candidate.email,
        confidence,
        reasons: compact([
          exactName ? 'Exact name match in recent attendee history' : null,
          !exactName && firstNameMatch ? 'First-name match in recent attendee history' : null,
          localMatch ? 'Email local-part resembles the mentioned name' : null,
          candidate.count > 1 ? `Appeared ${candidate.count} times in recent events` : null,
        ]),
        source: 'calendar-history',
        autoSelected: confidence >= 0.9,
      }
    })

    const candidates = dedupeAttendeeCandidates([...factCandidates, ...calendarCandidates])
      .filter((candidate) => candidate.confidence >= 0.55)
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 5)

    const preferredSelected = previousGroup?.manualEmail
      ? null
      : previousGroup?.selectedEmail &&
          candidates.some((candidate) => candidate.email === previousGroup.selectedEmail)
        ? previousGroup.selectedEmail
        : candidates[0]?.autoSelected
          ? candidates[0].email
          : null

    return {
      mention: mention.name,
      optional: mention.optional,
      selectedEmail: preferredSelected,
      manualEmail: previousGroup?.manualEmail ?? null,
      approved:
        previousGroup?.approved ??
        Boolean(
          preferredSelected &&
            candidates.find((candidate) => candidate.email === preferredSelected)?.autoSelected,
        ),
      candidates,
    } satisfies AttendeeResolutionGroup
  })
}

export function suggestCalendars(
  intent: DraftIntent,
  calendars: GoogleCalendarListEntry[],
  events: GoogleCalendarEvent[],
  factsContext: FactsContext,
  attendeeGroups: AttendeeResolutionGroup[],
): CalendarSuggestion[] {
  const titleHint = normalizeText(intent.title ?? '')
  const locationHint = normalizeText(intent.location ?? '')
  const selectedAttendees = getSelectedAttendees(attendeeGroups)
  const activeFacts = factsContext.facts.filter((fact) => fact.status === 'active')

  return calendars
    .map((calendar) => {
      const recentEvents = events.filter((event) => event.calendarId === calendar.id)
      const titleOverlap = recentEvents.some(
        (event) => similarity(titleHint, normalizeText(event.summary ?? '')) >= SIMILARITY_LOOSE,
      )
      const attendeeOverlap = recentEvents.some((event) =>
        (event.attendees ?? []).some((attendee) =>
          selectedAttendees.some((candidate) => candidate.email === attendee.email),
        ),
      )
      const locationOverlap = locationHint
        ? recentEvents.some((event) => normalizeText(event.location ?? '') === locationHint)
        : false
      const factBoost = activeFacts.some(
        (fact) =>
          fact.kind === 'calendar-pattern' &&
          fact.value === calendar.id &&
          similarity(normalizeText(fact.subject), titleHint) >= SIMILARITY_LOOSE,
      )
      const score = clamp(
        (calendar.primary ? 0.35 : 0.1) +
          (titleOverlap ? 0.22 : 0) +
          (attendeeOverlap ? 0.18 : 0) +
          (locationOverlap ? 0.1 : 0) +
          (factBoost ? 0.18 : 0),
        0,
        0.99,
      )

      return {
        calendarId: calendar.id,
        confidence: score,
        reasons: compact([
          calendar.primary ? 'Primary calendar fallback' : null,
          titleOverlap ? 'Similar titles appear on this calendar' : null,
          attendeeOverlap ? 'Recent attendees match this calendar history' : null,
          locationOverlap ? 'Matching location used on this calendar' : null,
          factBoost ? 'An active shared fact points to this calendar' : null,
        ]),
        summary: calendar.summary,
      }
    })
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 4)
}

export function detectExistingEventMatches(
  intent: DraftIntent,
  events: GoogleCalendarEvent[],
  calendars: GoogleCalendarListEntry[],
  previousMatches: ExistingEventMatch[] = [],
) {
  const titleHint = normalizeText(intent.title ?? '')
  const intentDate = intent.date

  return events
    .map((event) => {
      const score = similarity(titleHint, normalizeText(event.summary ?? ''))
      const eventStart = getEventStart(event)
      const sameDay = intentDate && eventStart ? eventStart.startsWith(intentDate) : false
      const similar = score >= MATCH_LOOSE && (sameDay || score >= MATCH_VERY_STRICT)
      if (!similar) {
        return null
      }

      return {
        calendarId: event.calendarId,
        calendarName:
          calendars.find((calendar) => calendar.id === event.calendarId)?.summary ??
          event.calendarName,
        eventId: event.id,
        reason: sameDay
          ? 'A similar title exists on the same day'
          : 'A very similar title exists in recent calendar history',
        score,
        selected: previousMatches.some((match) => match.eventId === event.id),
        start: eventStart ?? null,
        title: event.summary ?? 'Untitled event',
      } satisfies ExistingEventMatch
    })
    .filter((value): value is ExistingEventMatch => Boolean(value))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
}

export function buildSmartSignals(reviewDraft: ReviewDraft) {
  const signals = [
    ...reviewDraft.calendarSuggestions.slice(0, 2).map((suggestion) => ({
      label: 'Calendar suggestion',
      detail: `${suggestion.summary}: ${suggestion.reasons[0] ?? 'best overall match'}`,
    })),
    ...reviewDraft.attendeeGroups.slice(0, 2).flatMap((group) =>
      group.candidates[0]
        ? [
            {
              label: 'Attendee match',
              detail: `${group.candidates[0].displayName}: ${group.candidates[0].reasons[0] ?? 'matched from recent history'}`,
            },
          ]
        : [],
    ),
    ...reviewDraft.factsContext.promptSummary.slice(0, 2).map((summary) => ({
      label: 'Shared fact',
      detail: summary,
    })),
  ]

  if (reviewDraft.existingEventMatches.length > 0) {
    signals.push({
      label: 'Existing event match',
      detail: reviewDraft.existingEventMatches[0]?.reason ?? 'A similar event was found',
    })
  }

  if (reviewDraft.conflictCheck.hasConflict) {
    signals.push({
      label: 'Conflict detected',
      detail: `${reviewDraft.conflictCheck.intervals.length} busy interval(s) overlap the proposed time`,
    })
  }

  return signals.slice(0, 6)
}

export function buildReviewBlockers(
  reviewDraft: Pick<ReviewDraft, 'event' | 'conflictCheck' | 'existingEventMatches'>,
) {
  const blockers = []

  if (!reviewDraft.event.title.trim()) {
    blockers.push({
      code: 'missing-title',
      label: 'Title required',
      detail: 'Add a title before writing the event to Google Calendar.',
      severity: 'blocking' as const,
    })
  }
  if (!reviewDraft.event.date) {
    blockers.push({
      code: 'missing-date',
      label: 'Date required',
      detail: 'Choose a date before writing the event.',
      severity: 'blocking' as const,
    })
  }
  if (!reviewDraft.event.allDay && !reviewDraft.event.startTime) {
    blockers.push({
      code: 'missing-start-time',
      label: 'Start time required',
      detail: 'Add a start time or mark the event as all-day.',
      severity: 'blocking' as const,
    })
  }
  if (reviewDraft.conflictCheck.hasConflict) {
    blockers.push({
      code: 'calendar-conflict',
      label: 'Free/busy conflict',
      detail: 'The proposed time overlaps a busy interval.',
      severity: 'warning' as const,
    })
  }
  if (reviewDraft.existingEventMatches.length > 0) {
    blockers.push({
      code: 'possible-duplicate',
      label: 'Existing event match',
      detail: 'Choose create new or update existing before submitting.',
      severity: 'warning' as const,
    })
  }

  return blockers
}

export function buildConflictCheckResult(
  checkedCalendarIds: string[],
  intervals: ConflictCheckResult['intervals'],
) {
  return conflictCheckResultSchema.parse({
    checkedCalendarIds,
    hasConflict: intervals.length > 0,
    intervals,
  })
}

function buildAttendeeDirectory(events: GoogleCalendarEvent[]) {
  const directory = new Map<string, AttendeeAggregate>()

  for (const event of events) {
    for (const attendee of event.attendees ?? []) {
      if (!attendee.email) {
        continue
      }

      const key = attendee.email.toLowerCase()
      const current = directory.get(key)
      directory.set(key, {
        calendarIds: current?.calendarIds ?? new Set<string>(),
        count: (current?.count ?? 0) + 1,
        displayName: attendee.displayName || current?.displayName || attendee.email,
        email: attendee.email,
        lastSeenAt: maxDate(current?.lastSeenAt, getEventStart(event) ?? new Date(0).toISOString()),
      })
      directory.get(key)?.calendarIds.add(event.calendarId)
    }
  }

  return directory
}

function dedupeAttendeeCandidates(candidates: AttendeeCandidate[]) {
  const byEmail = new Map<string, AttendeeCandidate>()
  for (const candidate of candidates) {
    const current = byEmail.get(candidate.email)
    if (!current || current.confidence < candidate.confidence) {
      byEmail.set(candidate.email, candidate)
    }
  }
  return [...byEmail.values()]
}

function recencyScore(dateIso: string) {
  const days = Math.max(differenceInDays(new Date(), new Date(dateIso)), 0)
  if (days <= 7) return 0.16
  if (days <= 30) return 0.12
  if (days <= 60) return 0.08
  return 0.02
}

function getEventStart(event: GoogleCalendarEvent) {
  return event.start?.dateTime ?? event.start?.date ?? null
}

function maxDate(left: string | undefined, right: string) {
  if (!left) {
    return right
  }
  return left > right ? left : right
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value != null)
}
