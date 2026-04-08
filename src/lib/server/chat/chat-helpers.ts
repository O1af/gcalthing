import type {
  CalendarToolSignInRequired,
  WriteCalendarToolSuccess,
  WriteEventRequest,
} from '@/lib/contracts'
import { writeEventRequestSchema } from '@/lib/contracts'
import type { GoogleCalendarListEntry } from '@/lib/server/google-calendar'
import type { SessionContext } from './index'

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
  calendars: GoogleCalendarListEntry[]
  request: WriteEventRequest
  session: NonNullable<SessionContext>
}): Promise<WriteCalendarToolSuccess> {
  const { calendars, request, session } = params
  const { createGoogleCalendarEvent } = await import('@/lib/server/google-calendar')

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
  calendars: GoogleCalendarListEntry[]
  calendarId: string
  eventId: string
  request: WriteEventRequest
  session: NonNullable<SessionContext>
}): Promise<WriteCalendarToolSuccess> {
  const { calendars, calendarId, eventId, request, session } = params
  const { updateGoogleCalendarEvent } = await import('@/lib/server/google-calendar')

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
  })
}

export async function withSession<T>(
  session: SessionContext | null,
  signInMessage: string,
  fn: (session: NonNullable<SessionContext>) => Promise<T>,
): Promise<T | CalendarToolSignInRequired> {
  if (!session) {
    return { detail: signInMessage, status: 'sign-in-required' }
  }
  return fn(session)
}
