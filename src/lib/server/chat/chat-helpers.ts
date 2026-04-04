import { z } from 'zod'
import type { AppChatMessage } from '@/lib/chat-ui'
import { toSourceInputsFromMessage } from '@/lib/chat-ui'
import type {
  CalendarToolSignInRequired,
  DraftIntent,
  SourceInput,
  SubmitEventRequest,
  SubmitEventResponse,
  WriteCalendarToolSuccess,
} from '@/lib/contracts'
import { draftIntentSchema } from '@/lib/contracts'
import { getDurationMinutes } from '@/lib/domain/date-time'
import { logDebug, withDebugTiming } from '@/lib/server/debug'
import type { SessionContext } from './index'
import type { eventInputSchema } from './tool-definitions'

export function collectConversationSourceInputs(messages: AppChatMessage[]) {
  return mergeSourceInputs(
    [],
    messages
      .filter((message) => message.role === 'user')
      .flatMap((message) => toSourceInputsFromMessage(message)),
  )
}

export async function normalizeCreateRequest(params: {
  accessToken: string
  eventInput: z.infer<typeof eventInputSchema>
  localTimeZone: string
  sourceInputs: SourceInput[]
  userSub: string
}) {
  const { accessToken, eventInput, localTimeZone, sourceInputs, userSub } = params
  const { buildSignedInReviewDraft } = await import('@/lib/server/review-draft')
  const intent = mergeIntent(defaultDraftIntent(localTimeZone), eventInput, localTimeZone)
  const draft = await buildSignedInReviewDraft({
    accessToken,
    intent,
    localTimeZone,
    userSub,
  })
  const blocking = draft.reviewBlockers.filter((blocker) => blocker.severity === 'blocking')
  if (blocking.length > 0) {
    return {
      detail: buildMissingFieldsMessage(blocking),
      request: null,
      summary: summarizeEventAction('create', draft.event),
    }
  }

  return {
    detail: null,
    request: {
      action: { type: 'create' as const },
      appendSourceDetails: true,
      attendeeGroups: draft.attendeeGroups,
      event: draft.event,
      sourceInputs,
    } satisfies SubmitEventRequest,
    summary: summarizeEventAction('create', draft.event),
  }
}

export async function normalizeUpdateRequest(params: {
  accessToken: string
  calendarId: string
  eventId: string
  eventInput: z.infer<typeof eventInputSchema>
  localTimeZone: string
  sourceInputs: SourceInput[]
  userSub: string
}) {
  const {
    accessToken,
    calendarId,
    eventId,
    eventInput,
    localTimeZone,
    sourceInputs,
    userSub,
  } = params
  const {
    getGoogleCalendarEvent,
    listWritableCalendars,
  } = await import('@/lib/server/google-calendar')
  const { buildSignedInReviewDraft } = await import('@/lib/server/review-draft')
  const [calendars, currentEvent] = await Promise.all([
    listWritableCalendars(accessToken),
    getGoogleCalendarEvent(accessToken, calendarId, calendarId, eventId),
  ])
  const calendarName = calendars.find((calendar) => calendar.id === calendarId)?.summary ?? calendarId
  currentEvent.calendarName = calendarName
  const intent = mergeIntent(
    buildIntentFromGoogleEvent(currentEvent, localTimeZone),
    eventInput,
    localTimeZone,
  )
  const draft = await buildSignedInReviewDraft({
    accessToken,
    intent,
    localTimeZone,
    selectedUpdateTarget: {
      calendarId,
      eventId,
      start: currentEvent.start?.dateTime ?? currentEvent.start?.date ?? null,
      title: currentEvent.summary ?? 'Untitled event',
    },
    userSub,
  })
  const blocking = draft.reviewBlockers.filter((blocker) => blocker.severity === 'blocking')
  if (blocking.length > 0) {
    return {
      detail: buildMissingFieldsMessage(blocking),
      request: null,
      summary: summarizeEventAction('update', draft.event),
    }
  }

  return {
    detail: null,
    request: {
      action: {
        type: 'update' as const,
        calendarId,
        eventId,
      },
      appendSourceDetails: true,
      attendeeGroups: draft.attendeeGroups,
      event: draft.event,
      sourceInputs,
    } satisfies SubmitEventRequest,
    summary: summarizeEventAction('update', draft.event),
  }
}

export async function submitWriteRequest(params: {
  request: SubmitEventRequest
  session: NonNullable<SessionContext>
}) {
  const { request, session } = params
  const response = await writeCalendarEvent(session, request)

  return {
    ...response,
    detail:
      response.actionPerformed === 'created'
        ? 'Created the event in Google Calendar.'
        : response.actionPerformed === 'updated'
          ? 'Updated the existing Google Calendar event.'
          : 'Deleted the Google Calendar event.',
    status: 'ok',
  } satisfies WriteCalendarToolSuccess
}

export async function executeUpdateOrReschedule(
  toolName: string,
  params: {
    calendarId: string
    eventId: string
    eventInput: z.infer<typeof eventInputSchema>
    session: SessionContext | null
    localTimeZone: string
    sourceInputs: SourceInput[]
    turnId: string
  },
) {
  const { calendarId, eventId, eventInput, localTimeZone, session, sourceInputs, turnId } =
    params
  return executeLoggedTool(toolName, turnId, () =>
    withSession(
      session,
      `Sign in with Google before ${toolName === 'reschedule_event' ? 'rescheduling' : 'updating'} events.`,
      async (session) => {
      const normalized = await normalizeUpdateRequest({
        accessToken: session.tokens.accessToken,
        calendarId,
        eventId,
        eventInput,
        localTimeZone,
        sourceInputs,
        userSub: session.profile.sub,
      })
      if (normalized.request == null) {
        return {
          detail:
            normalized.detail ?? 'More detail is needed before writing to Google Calendar.',
          status: 'needs-input' as const,
        }
      }

      return submitWriteRequest({
        request: normalized.request,
        session,
      })
    },
    ),
  )
}

export function signInRequiredResult(detail: string): CalendarToolSignInRequired {
  return {
    detail,
    status: 'sign-in-required',
  }
}

export async function withSession<T>(
  session: SessionContext | null,
  signInMessage: string,
  fn: (session: NonNullable<SessionContext>) => Promise<T>,
): Promise<T | CalendarToolSignInRequired> {
  if (!session) {
    return signInRequiredResult(signInMessage)
  }
  return fn(session)
}

export async function executeLoggedTool<T>(
  toolName: string,
  turnId: string,
  run: () => Promise<T>,
): Promise<T> {
  logDebug('ai:tool', 'start', {
    toolName,
    turnId,
  })

  return withDebugTiming('ai:tool', toolName, async () => {
    const result = await run()
    logDebug('ai:tool', 'result', {
      resultKind: summarizeToolResult(result),
      toolName,
      turnId,
    })
    return result
  }, {
    turnId,
  })
}


async function writeCalendarEvent(
  session: NonNullable<SessionContext>,
  request: SubmitEventRequest,
) {
  const [
    { createGoogleCalendarEvent, listWritableCalendars, updateGoogleCalendarEvent },
    { applyFactChangesForSubmission },
  ] = await Promise.all([
    import('@/lib/server/google-calendar'),
    import('@/lib/server/facts'),
  ])
  const calendars = await listWritableCalendars(session.tokens.accessToken)
  const calendarNameById = new Map(calendars.map((calendar) => [calendar.id, calendar.summary]))
  const result =
    request.action.type === 'update'
      ? await updateGoogleCalendarEvent(
          session.tokens.accessToken,
          request.action.eventId,
          request.action.calendarId,
          request,
          calendarNameById,
        )
      : await createGoogleCalendarEvent(
          session.tokens.accessToken,
          request,
          calendarNameById,
        )
  const factChangesApplied = await applyFactChangesForSubmission(
    session.profile.sub,
    request,
    { actionPerformed: result.actionPerformed },
  )

  return {
    actionPerformed: result.actionPerformed,
    calendarId: result.calendarId,
    eventId: result.eventId,
    factChangesApplied,
    htmlLink: result.htmlLink,
    sendUpdates: result.sendUpdates,
  } satisfies SubmitEventResponse
}

function buildIntentFromGoogleEvent(
  event: Awaited<ReturnType<typeof import('@/lib/server/google-calendar').getGoogleCalendarEvent>>,
  fallbackTimeZone: string,
): DraftIntent {
  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime)
  const date = event.start?.date ?? event.start?.dateTime?.slice(0, 10) ?? null
  const endDate = event.end?.date ?? event.end?.dateTime?.slice(0, 10) ?? date
  const startTime = event.start?.dateTime?.slice(11, 16) ?? null
  const endTime = event.end?.dateTime?.slice(11, 16) ?? null
  const durationMinutes = !isAllDay ? getDurationMinutes(event) : null

  return draftIntentSchema.parse({
    allDay: isAllDay,
    attendeeMentions: (event.attendees ?? []).map((attendee) => ({
      email: attendee.email ?? null,
      name: attendee.displayName ?? attendee.email ?? 'Guest',
      optional: false,
    })),
    calendarId: event.calendarId,
    date,
    description: event.description ?? null,
    durationMinutes,
    endDate,
    endTime,
    location: event.location ?? null,
    recurrenceRule: null,
    startTime,
    timezone: event.start?.timeZone ?? event.end?.timeZone ?? fallbackTimeZone,
    title: event.summary ?? null,
  })
}

function defaultDraftIntent(localTimeZone: string): DraftIntent {
  return draftIntentSchema.parse({
    timezone: localTimeZone,
  })
}

function mergeIntent(
  base: DraftIntent,
  update: z.infer<typeof eventInputSchema>,
  fallbackTimeZone: string,
): DraftIntent {
  return draftIntentSchema.parse({
    ...base,
    ...removeUndefined(update),
    timezone:
      update.timezone === undefined
        ? (base.timezone ?? fallbackTimeZone)
        : update.timezone,
  })
}

function buildMissingFieldsMessage(
  blockers: Array<{ detail: string; label: string }>,
) {
  return `More detail is needed before writing to Google Calendar: ${blockers
    .map((blocker) => blocker.label)
    .join(', ')}. Ask the user for the missing information instead of writing now.`
}

function summarizeEventAction(
  action: 'create' | 'update',
  event: SubmitEventRequest['event'],
) {
  const when = event.allDay
    ? event.date
      ? `all day on ${event.date}`
      : 'with no date yet'
    : event.date && event.startTime
      ? `${event.date} at ${event.startTime}`
      : 'with missing time details'

  return `${action === 'create' ? 'Create' : 'Update'} "${event.title || 'Untitled event'}" ${when}.`
}

function mergeSourceInputs(left: SourceInput[], right: SourceInput[]): SourceInput[] {
  const seen = new Set<string>()
  return [...left, ...right].filter((input) => {
    if (seen.has(input.id)) {
      return false
    }
    seen.add(input.id)
    return true
  })
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>
}

function summarizeToolResult(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return String(result)
  }

  if ('detail' in result && typeof (result as Record<string, unknown>).detail === 'string') {
    return (result as Record<string, string>).detail
  }

  return 'object'
}
