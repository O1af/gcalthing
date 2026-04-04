import type { AppChatMessage } from '@/lib/chat-ui'
import { toSourceInputsFromMessage } from '@/lib/chat-ui'
import type {
  CalendarToolSignInRequired,
  SourceInput,
  WriteCalendarToolSuccess,
  WriteEventRequest,
} from '@/lib/contracts'
import { writeEventRequestSchema } from '@/lib/contracts'
import { logDebug, withDebugTiming } from '@/lib/server/debug'
import type { SessionContext } from './index'

export function collectConversationSourceInputs(messages: AppChatMessage[]) {
  return mergeSourceInputs(
    [],
    messages
      .filter((message) => message.role === 'user')
      .flatMap((message) => toSourceInputsFromMessage(message)),
  )
}

export function validateRequiredFields(input: {
  title?: string | null
  date?: string | null
  startTime?: string | null
  allDay?: boolean
}): string[] {
  const missing: string[] = []
  if (!input.title?.trim()) missing.push('title')
  if (!input.date?.trim()) missing.push('date')
  if (!input.allDay && !input.startTime?.trim()) missing.push('startTime (or set allDay: true)')
  return missing
}

export async function submitCreateEvent(params: {
  request: WriteEventRequest
  session: NonNullable<SessionContext>
}): Promise<WriteCalendarToolSuccess> {
  const { request, session } = params
  const {
    createGoogleCalendarEvent,
    listWritableCalendars,
  } = await import('@/lib/server/google-calendar')

  const calendars = await listWritableCalendars(session.tokens.accessToken)
  const calendarNameById = new Map(calendars.map((c) => [c.id, c.summary]))

  const result = await createGoogleCalendarEvent(
    session.tokens.accessToken,
    request,
    calendarNameById,
  )

  return {
    actionPerformed: result.actionPerformed,
    calendarId: result.calendarId,
    detail: `Created "${request.title}" in Google Calendar.`,
    eventId: result.eventId,
    htmlLink: result.htmlLink,
    sendUpdates: result.sendUpdates,
    status: 'ok',
  }
}

export async function submitUpdateEvent(params: {
  calendarId: string
  eventId: string
  request: WriteEventRequest
  session: NonNullable<SessionContext>
}): Promise<WriteCalendarToolSuccess> {
  const { calendarId, eventId, request, session } = params
  const {
    updateGoogleCalendarEvent,
    listWritableCalendars,
  } = await import('@/lib/server/google-calendar')

  const calendars = await listWritableCalendars(session.tokens.accessToken)
  const calendarNameById = new Map(calendars.map((c) => [c.id, c.summary]))

  const result = await updateGoogleCalendarEvent(
    session.tokens.accessToken,
    eventId,
    calendarId,
    request,
    calendarNameById,
  )

  return {
    actionPerformed: result.actionPerformed,
    calendarId: result.calendarId,
    detail: `Updated "${request.title}" in Google Calendar.`,
    eventId: result.eventId,
    htmlLink: result.htmlLink,
    sendUpdates: result.sendUpdates,
    status: 'ok',
  }
}

export function buildWriteEventRequest(
  input: Record<string, unknown>,
  localTimeZone: string,
  sourceInputs: SourceInput[],
): WriteEventRequest {
  return writeEventRequestSchema.parse({
    title: input.title ?? '',
    date: input.date ?? '',
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    durationMinutes: input.durationMinutes ?? null,
    allDay: input.allDay ?? false,
    timezone: input.timezone ?? localTimeZone,
    location: input.location ?? null,
    description: input.description ?? null,
    recurrenceRule: input.recurrenceRule ?? null,
    calendarId: input.calendarId ?? 'primary',
    attendees: input.attendees ?? [],
    sourceInputs,
    appendSourceDetails: sourceInputs.length > 0,
  })
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

function summarizeToolResult(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return String(result)
  }

  if ('detail' in result && typeof (result as Record<string, unknown>).detail === 'string') {
    return (result as Record<string, string>).detail
  }

  return 'object'
}
