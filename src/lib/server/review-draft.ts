import type {
  BuildDraftInput,
  ExtractedEventDraft,
  FactsContext,
  RefreshReviewDraftRequest,
  ReviewDraft,
} from '@/lib/contracts'
import { emptyFactsContext, reviewDraftSchema } from '@/lib/contracts'
import { deriveEndTime, formatRfc3339InTimeZone, getDurationMinutes } from '@/lib/domain/date-time'
import { normalizeText, similarity } from '@/lib/domain/text'
import { logDebugError } from '@/lib/server/debug'
import {
  buildConflictCheckResult,
  buildReviewBlockers,
  buildSmartSignals,
  detectExistingEventMatches,
  resolveAttendeeGroups,
  suggestCalendars,
  summarizeCalendarContext,
} from '@/lib/server/calendar-context'
import { loadFactsContext } from '@/lib/server/facts'
import {
  listRecentEvents,
  listWritableCalendars,
  queryFreeBusy,
  type GoogleCalendarEvent,
  type GoogleCalendarListEntry,
} from '@/lib/server/google-calendar'

export async function buildInitialReviewDraft(params: {
  accessToken: string
  extracted: ExtractedEventDraft
  input: BuildDraftInput
  userSub: string
}) {
  const { accessToken, extracted, input, userSub } = params
  const [calendars, factsContext] = await Promise.all([
    listWritableCalendars(accessToken),
    loadFactsContext(userSub),
  ])
  const recentEvents = await listRecentEvents(accessToken, calendars)

  const attendeeGroups = resolveAttendeeGroups(extracted, recentEvents, factsContext)
  const calendarSuggestions = suggestCalendars(
    extracted,
    calendars,
    recentEvents,
    factsContext,
    attendeeGroups,
  )
  const existingEventMatches = detectExistingEventMatches(extracted, recentEvents, calendars)
  const selectedCalendarId = pickCalendarId(calendars, calendarSuggestions)
  const event = buildEventFromExtraction(extracted, input.localTimeZone, selectedCalendarId, recentEvents, factsContext)

  return finalizeReviewDraft({
    accessToken,
    attendeeGroups,
    calendars,
    existingEventMatches,
    extracted,
    event,
    factsContext,
    localTimeZone: input.localTimeZone,
    previousDraft: null,
    recentEvents,
  })
}

export async function buildExtractionOnlyReviewDraft(params: {
  extracted: ExtractedEventDraft
  input: BuildDraftInput
}) {
  const { extracted, input } = params
  const attendeeGroups = resolveAttendeeGroups(extracted, [], emptyFactsContext)
  const event = buildEventFromExtraction(extracted, input.localTimeZone, 'primary', [], emptyFactsContext)

  return finalizeReviewDraft({
    accessToken: null,
    attendeeGroups,
    calendars: [],
    existingEventMatches: [],
    extracted,
    event,
    factsContext: emptyFactsContext,
    localTimeZone: input.localTimeZone,
    previousDraft: null,
    recentEvents: [],
  })
}

export async function refreshReviewDraftState(params: {
  accessToken: string
  request: RefreshReviewDraftRequest
  userSub: string
}) {
  const { accessToken, request, userSub } = params
  const [calendars, factsContext] = await Promise.all([
    listWritableCalendars(accessToken),
    loadFactsContext(userSub),
  ])
  const recentEvents = await listRecentEvents(accessToken, calendars)

  const extractedForSignals = mergeExtractedWithEvent(request.draft.extracted, request.draft.event)
  const attendeeGroups = mergeAttendeeGroupState(
    resolveAttendeeGroups(extractedForSignals, recentEvents, factsContext, request.draft.attendeeGroups),
    request.draft.attendeeGroups,
  )

  const nextEvent = {
    ...request.draft.event,
    timezone: request.draft.event.timezone ?? request.localTimeZone,
  }

  return finalizeReviewDraft({
    accessToken,
    attendeeGroups,
    calendars,
    existingEventMatches: detectExistingEventMatches(
      extractedForSignals,
      recentEvents,
      calendars,
      request.draft.existingEventMatches,
    ),
    extracted: extractedForSignals,
    event: nextEvent,
    factsContext,
    localTimeZone: request.localTimeZone,
    previousDraft: request.draft,
    recentEvents,
  })
}

export async function refreshExtractionOnlyDraftState(params: {
  request: RefreshReviewDraftRequest
}) {
  const { request } = params
  const extractedForSignals = mergeExtractedWithEvent(request.draft.extracted, request.draft.event)
  const attendeeGroups = mergeAttendeeGroupState(
    resolveAttendeeGroups(extractedForSignals, [], emptyFactsContext, request.draft.attendeeGroups),
    request.draft.attendeeGroups,
  )

  return finalizeReviewDraft({
    accessToken: null,
    attendeeGroups,
    calendars: [],
    existingEventMatches: [],
    extracted: extractedForSignals,
    event: {
      ...request.draft.event,
      timezone: request.draft.event.timezone ?? request.localTimeZone,
    },
    factsContext: emptyFactsContext,
    localTimeZone: request.localTimeZone,
    previousDraft: request.draft,
    recentEvents: [],
  })
}

async function finalizeReviewDraft({
  accessToken,
  attendeeGroups,
  calendars,
  existingEventMatches,
  event,
  extracted,
  factsContext,
  localTimeZone,
  previousDraft,
  recentEvents,
}: {
  accessToken: string | null
  attendeeGroups: ReviewDraft['attendeeGroups']
  calendars: GoogleCalendarListEntry[]
  existingEventMatches: ReviewDraft['existingEventMatches']
  event: ReviewDraft['event']
  extracted: ExtractedEventDraft
  factsContext: FactsContext
  localTimeZone: string
  previousDraft: ReviewDraft | null
  recentEvents: GoogleCalendarEvent[]
}) {
  const calendarSuggestions = suggestCalendars(
    mergeExtractedWithEvent(extracted, event),
    calendars,
    recentEvents,
    factsContext,
    attendeeGroups,
  )
  const normalizedEvent = {
    ...event,
    calendarId:
      event.calendarId && calendars.some((calendar) => calendar.id === event.calendarId)
        ? event.calendarId
        : pickCalendarId(calendars, calendarSuggestions),
    timezone: event.timezone ?? localTimeZone,
  }

  const conflictCheck = await maybeRunConflictCheck({
    accessToken,
    calendars,
    calendarSuggestions,
    event: normalizedEvent,
  })
  const selectedMatch = selectExistingEventMatch(existingEventMatches, previousDraft)
  const proposedAction =
    previousDraft?.proposedAction.type === 'update' && selectedMatch
      ? {
          type: 'update' as const,
          calendarId: selectedMatch.calendarId,
          eventId: selectedMatch.eventId,
        }
      : { type: 'create' as const }

  const draft = reviewDraftSchema.parse({
    attendeeGroups,
    calendarContext: summarizeCalendarContext(calendars, recentEvents),
    calendarSuggestions,
    calendars,
    conflictCheck,
    event: normalizedEvent,
    existingEventMatches: existingEventMatches.map((match) => ({
      ...match,
      selected: selectedMatch?.eventId === match.eventId,
    })),
    extracted,
    factsContext,
    interpretationOptions:
      extracted.candidates.length > 0
        ? extracted.candidates.map((candidate) => ({
            ...candidate,
            selected:
              previousDraft?.interpretationOptions.some(
                (option) => option.label === candidate.label && option.selected,
              ) ?? false,
          }))
        : [],
    proposedAction,
    reviewBlockers: [],
    smartSignals: [],
  })

  draft.reviewBlockers = buildReviewBlockers(draft)
  draft.smartSignals = buildSmartSignals(draft)
  appendFactsDrivenSuggestions(draft, recentEvents, factsContext)
  return reviewDraftSchema.parse(draft)
}

async function maybeRunConflictCheck({
  accessToken,
  calendars,
  calendarSuggestions,
  event,
}: {
  accessToken: string | null
  calendars: GoogleCalendarListEntry[]
  calendarSuggestions: ReviewDraft['calendarSuggestions']
  event: ReviewDraft['event']
}) {
  if (!accessToken) {
    return buildConflictCheckResult([], [])
  }

  if (!event.date || !event.startTime) {
    return buildConflictCheckResult([], [])
  }

  const checkedCalendarIds = [...new Set([event.calendarId, ...calendarSuggestions.map((item) => item.calendarId)])]
    .slice(0, 10)

  const timeMin = formatRfc3339InTimeZone(
    event.date,
    event.startTime,
    event.timezone ?? 'UTC',
  )
  const endTime = event.endTime ?? deriveEndTime(event.startTime, event.durationMinutes ?? 60)
  const timeMax = formatRfc3339InTimeZone(
    event.endDate ?? event.date,
    endTime,
    event.timezone ?? 'UTC',
  )

  let busy
  try {
    busy = await queryFreeBusy(accessToken, checkedCalendarIds, timeMin, timeMax)
  } catch (error) {
    logDebugError('review-draft', 'freeBusyCheck:failed', error, {
      calendarCount: checkedCalendarIds.length,
      timeMax,
      timeMin,
      timeZone: event.timezone ?? 'UTC',
    })
    return buildConflictCheckResult([], [])
  }
  const intervals = checkedCalendarIds.flatMap((calendarId) =>
    (busy[calendarId]?.busy ?? []).map((interval) => ({
      calendarId,
      calendarName:
        calendars.find((calendar) => calendar.id === calendarId)?.summary ?? calendarId,
      end: interval.end,
      start: interval.start,
    })),
  )

  return buildConflictCheckResult(checkedCalendarIds, intervals)
}

function pickCalendarId(
  calendars: GoogleCalendarListEntry[],
  suggestions: ReviewDraft['calendarSuggestions'],
) {
  const top = suggestions[0]
  const second = suggestions[1]
  if (top && top.confidence >= 0.58 && (!second || top.confidence - second.confidence >= 0.12)) {
    return top.calendarId
  }

  return calendars.find((calendar) => calendar.primary)?.id ?? 'primary'
}

function inferDuration(
  extracted: ExtractedEventDraft,
  events: GoogleCalendarEvent[],
  factsContext: FactsContext,
) {
  if (!extracted.title) {
    return 60
  }

  const normalizedTitle = normalizeText(extracted.title)
  const matchingDurations = events
    .filter((event) => similarity(normalizeText(event.summary ?? ''), normalizedTitle) >= 0.74)
    .map((event) => getDurationMinutes(event))
    .filter((value): value is number => value != null)

  const factDurations = factsContext.facts
    .filter(
      (fact) =>
        fact.status === 'active' &&
        fact.kind === 'duration-pattern' &&
        similarity(normalizeText(fact.subject), normalizedTitle) >= 0.74,
    )
    .map((fact) => Number.parseInt(fact.value, 10))
    .filter((value) => Number.isFinite(value))

  const allDurations = [...matchingDurations, ...factDurations]
  if (allDurations.length === 0) {
    return 60
  }

  const buckets = new Map<number, number>()
  for (const minutes of allDurations) {
    buckets.set(minutes, (buckets.get(minutes) ?? 0) + 1)
  }

  return [...buckets.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 60
}

function appendFactsDrivenSuggestions(
  draft: ReviewDraft,
  events: GoogleCalendarEvent[],
  factsContext: FactsContext,
) {
  if (!draft.event.location) {
    const location = suggestLocation(draft.extracted, events, factsContext)
    if (location) {
      draft.smartSignals.push({
        label: 'Location candidate',
        detail: `Shared context suggests ${location}. It remains editable because the source did not state it explicitly.`,
      })
    }
  }

  if (!draft.extracted.durationMinutes && draft.event.durationMinutes) {
    draft.smartSignals.unshift({
      label: 'Duration suggestion',
      detail: `Suggested ${draft.event.durationMinutes} minutes from recent history and shared facts.`,
    })
  }
}

function suggestLocation(
  extracted: ExtractedEventDraft,
  events: GoogleCalendarEvent[],
  factsContext: FactsContext,
) {
  if (!extracted.title) {
    return null
  }

  const normalizedTitle = normalizeText(extracted.title)
  const recentLocation = events.find(
    (event) => event.location && similarity(normalizeText(event.summary ?? ''), normalizedTitle) >= 0.8,
  )?.location
  if (recentLocation) {
    return recentLocation
  }

  return (
    factsContext.facts.find(
      (fact) =>
        fact.status === 'active' &&
        fact.kind === 'location-pattern' &&
        similarity(normalizeText(fact.subject), normalizedTitle) >= 0.8,
    )?.value ?? null
  )
}

function mergeExtractedWithEvent(extracted: ExtractedEventDraft, event: ReviewDraft['event']) {
  return {
    ...extracted,
    date: event.date,
    description: event.description,
    durationMinutes: event.durationMinutes,
    endTime: event.endTime,
    location: event.location,
    recurrenceRule: event.recurrenceRule,
    startTime: event.startTime,
    timezone: event.timezone,
    title: event.title || extracted.title,
  } satisfies ExtractedEventDraft
}

function selectExistingEventMatch(
  matches: ReviewDraft['existingEventMatches'],
  previousDraft: ReviewDraft | null,
) {
  const previousAction = previousDraft?.proposedAction
  if (previousAction?.type === 'update') {
    return (
      matches.find((match) => match.eventId === previousAction.eventId) ?? matches[0] ?? null
    )
  }
  return matches.find((match) => match.selected) ?? null
}

function buildEventFromExtraction(
  extracted: ExtractedEventDraft,
  localTimeZone: string,
  calendarId: string,
  recentEvents: GoogleCalendarEvent[],
  factsContext: FactsContext,
) {
  const inferredDuration = inferDuration(extracted, recentEvents, factsContext)
  const duration = extracted.durationMinutes ?? inferredDuration
  return {
    allDay: false,
    calendarId,
    date: extracted.date,
    description: extracted.description,
    durationMinutes: duration,
    endDate: extracted.date,
    endTime:
      extracted.endTime ??
      (extracted.startTime && duration
        ? deriveEndTime(extracted.startTime, duration ?? 60)
        : null),
    location: extracted.location,
    recurrenceRule: extracted.recurrenceRule,
    startTime: extracted.startTime,
    timezone: extracted.timezone ?? localTimeZone,
    title: extracted.title ?? '',
  }
}

function mergeAttendeeGroupState(
  groups: ReviewDraft['attendeeGroups'],
  previousGroups: ReviewDraft['attendeeGroups'],
) {
  return groups.map((group) => {
    const previous = previousGroups.find((item) => item.mention === group.mention)
    return previous
      ? {
          ...group,
          approved: previous.approved,
          manualEmail: previous.manualEmail,
          selectedEmail: previous.manualEmail ? null : previous.selectedEmail ?? group.selectedEmail,
        }
      : group
  })
}
