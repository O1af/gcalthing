import { addDays, subDays } from 'date-fns'
import type { SubmitEventRequest } from '@/lib/contracts'
import { getSelectedAttendees } from '@/lib/contracts'
import { deriveEndTime } from '@/lib/domain/date-time'

export interface GoogleCalendarListEntry {
  id: string
  summary: string
  primary?: boolean
  accessRole: string
  timeZone?: string
}

export interface GoogleEventAttendee {
  email?: string
  displayName?: string
}

export interface GoogleCalendarEvent {
  id: string
  summary?: string
  description?: string
  location?: string
  recurringEventId?: string
  status?: string
  attendees?: GoogleEventAttendee[]
  organizer?: { email?: string; displayName?: string }
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
  calendarId: string
  calendarName: string
}

export async function listWritableCalendars(accessToken: string) {
  const response = await googleFetch<{
    items?: GoogleCalendarListEntry[]
  }>('https://www.googleapis.com/calendar/v3/users/me/calendarList', accessToken)

  return (response.items ?? []).filter((calendar) =>
    ['owner', 'writer'].includes(calendar.accessRole),
  )
}

export async function listRecentEvents(
  accessToken: string,
  calendars: GoogleCalendarListEntry[],
  maxEvents = 150,
) {
  const now = new Date()
  const timeMin = subDays(now, 60).toISOString()
  const timeMax = addDays(now, 30).toISOString()

  const collected: GoogleCalendarEvent[] = []

  for (const calendar of calendars.slice(0, 5)) {
    if (collected.length >= maxEvents) {
      break
    }

    const search = new URLSearchParams({
      maxResults: String(Math.min(40, maxEvents - collected.length)),
      orderBy: 'startTime',
      singleEvents: 'true',
      timeMax,
      timeMin,
    })

    const response = await googleFetch<{ items?: GoogleCalendarEvent[] }>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${search.toString()}`,
      accessToken,
    )

    for (const event of response.items ?? []) {
      if (event.status === 'cancelled') {
        continue
      }

      collected.push({
        ...event,
        calendarId: calendar.id,
        calendarName: calendar.summary,
      })
    }
  }

  return collected.slice(0, maxEvents)
}

export async function queryFreeBusy(
  accessToken: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
) {
  const response = await googleFetch<{
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>
  }>('https://www.googleapis.com/calendar/v3/freeBusy', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: calendarIds.map((id) => ({ id })),
    }),
  })

  return response.calendars ?? {}
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  request: SubmitEventRequest,
  calendarNameById: Map<string, string>,
) {
  const eventBody = buildGoogleEventPayload(request)
  const sendUpdates = getSelectedAttendees(request.attendeeGroups).length > 0

  const response = await googleFetch<{
    id: string
    htmlLink: string
  }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(request.event.calendarId)}/events?conferenceDataVersion=1&sendUpdates=${sendUpdates ? 'all' : 'none'}`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(eventBody),
    },
  )

  return {
    actionPerformed: 'created' as const,
    calendarId: request.event.calendarId,
    calendarName: calendarNameById.get(request.event.calendarId) ?? request.event.calendarId,
    eventId: response.id,
    htmlLink: response.htmlLink,
    sendUpdates,
  }
}

export async function updateGoogleCalendarEvent(
  accessToken: string,
  eventId: string,
  calendarId: string,
  request: SubmitEventRequest,
  calendarNameById: Map<string, string>,
) {
  const eventBody = buildGoogleEventPayload(request)
  const sendUpdates = getSelectedAttendees(request.attendeeGroups).length > 0

  const response = await googleFetch<{
    id: string
    htmlLink: string
  }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=${sendUpdates ? 'all' : 'none'}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(eventBody),
    },
  )

  return {
    actionPerformed: 'updated' as const,
    calendarId,
    calendarName: calendarNameById.get(calendarId) ?? calendarId,
    eventId: response.id,
    htmlLink: response.htmlLink,
    sendUpdates,
  }
}

function buildGoogleEventPayload(request: SubmitEventRequest) {
  const { event } = request
  const descriptionParts = [event.description?.trim()]

  if (request.appendSourceDetails && request.sourceInputs.length > 0) {
    descriptionParts.push('', 'Source details', ...request.sourceInputs.map(formatSourceInput))
  }

  const attendees = getSelectedAttendees(request.attendeeGroups).map((attendee) => ({
    displayName: attendee.displayName,
    email: attendee.email,
  }))

  const recurrence = event.recurrenceRule
    ? [event.recurrenceRule.startsWith('RRULE:') ? event.recurrenceRule : `RRULE:${event.recurrenceRule}`]
    : undefined

  if (event.allDay && event.date) {
    const endDate = event.endDate ?? addDays(new Date(event.date), 1).toISOString().slice(0, 10)
    return {
      attendees,
      description: descriptionParts.filter(Boolean).join('\n'),
      end: { date: endDate },
      location: event.location ?? undefined,
      recurrence,
      start: { date: event.date },
      summary: event.title || 'Untitled event',
    }
  }

  if (!event.date || !event.startTime) {
    throw new Error('A start date and start time are required to create the event')
  }

  const endDate = event.endDate ?? event.date
  const endTime =
    event.endTime ??
    deriveEndTime(event.startTime, event.durationMinutes ?? 60)

  return {
    attendees,
    description: descriptionParts.filter(Boolean).join('\n'),
    end: {
      dateTime: `${endDate}T${endTime}:00`,
      timeZone: event.timezone ?? 'UTC',
    },
    location: event.location ?? undefined,
    recurrence,
    start: {
      dateTime: `${event.date}T${event.startTime}:00`,
      timeZone: event.timezone ?? 'UTC',
    },
    summary: event.title || 'Untitled event',
  }
}

function formatSourceInput(input: SubmitEventRequest['sourceInputs'][number]) {
  if (input.kind === 'text') {
    return `- ${input.label}: ${input.text.slice(0, 300)}`
  }

  return `- ${input.label}: ${input.filename ?? input.mediaType}`
}

async function googleFetch<T>(
  url: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Google API request failed (${response.status}): ${body}`)
  }

  return (await response.json()) as T
}
