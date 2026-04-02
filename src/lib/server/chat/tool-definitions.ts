import { tool } from 'ai'
import { z } from 'zod'
import type { ChatNotice, ExecutionMode, SubmitEventResponse } from '@/lib/contracts'
import { deriveEndTime, formatRfc3339InTimeZone } from '@/lib/domain/date-time'
import type { GoogleCalendarListEntry } from '@/lib/server/google-calendar'
import type { AssistantTurnInput, SessionContext } from './index'
import {
  ensureApprovalAllowed,
  executeLoggedTool,
  executeUpdateOrReschedule,
  normalizeCreateRequest,
  submitWriteRequest,
  summarizeDeleteAction,
  withSession,
} from './chat-helpers'

const attendeeMentionInputSchema = z.object({
  email: z.string().email().nullable().optional(),
  name: z.string().trim().min(1),
  optional: z.boolean().optional(),
})

export const eventInputSchema = z.object({
  allDay: z.boolean().optional(),
  attendeeMentions: z.array(attendeeMentionInputSchema).optional(),
  calendarId: z.string().trim().nullable().optional(),
  date: z.string().trim().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  endDate: z.string().trim().nullable().optional(),
  endTime: z.string().trim().nullable().optional(),
  location: z.string().trim().nullable().optional(),
  recurrenceRule: z.string().trim().nullable().optional(),
  startTime: z.string().trim().nullable().optional(),
  timezone: z.string().trim().nullable().optional(),
  title: z.string().trim().nullable().optional(),
})

const searchEventsInputSchema = z.object({
  calendarIds: z.array(z.string()).max(10).optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  limit: z.number().int().min(1).max(20).default(8),
  query: z.string().trim().max(120).optional(),
})

const getEventInputSchema = z.object({
  calendarId: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
})

const checkAvailabilityInputSchema = z.object({
  calendarIds: z.array(z.string()).max(10).optional(),
  date: z.string().min(1),
  durationMinutes: z.number().int().positive().max(720).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().optional(),
})

const updateEventInputSchema = eventInputSchema.extend({
  calendarId: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
})

const deleteEventInputSchema = z.object({
  calendarId: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  title: z.string().trim().optional(),
  when: z.string().trim().optional(),
})

export function buildTurnTools(params: {
  executionMode: ExecutionMode
  getCalendars: (() => Promise<GoogleCalendarListEntry[]>) | null
  input: AssistantTurnInput
  session: SessionContext | null
  setNotice: (notice: ChatNotice | null) => void
  turnId: string
}) {
  const { executionMode, getCalendars, input, session, setNotice, turnId } = params

  return {
    list_writable_calendars: tool({
      description: 'List writable Google Calendars for the signed-in user.',
      inputSchema: z.object({}),
      execute: async () =>
        executeLoggedTool('list_writable_calendars', turnId, () =>
          withSession(session, setNotice, 'Sign in with Google to list your calendars.', async () => {
            const calendars = await getCalendars!()

          return {
            calendars: calendars.map((calendar) => ({
              accessRole: calendar.accessRole,
              id: calendar.id,
              primary: Boolean(calendar.primary),
              summary: calendar.summary,
              timeZone: calendar.timeZone ?? null,
            })),
            detail:
              calendars.length > 0
                ? `Found ${calendars.length} writable calendar${calendars.length === 1 ? '' : 's'}.`
                : 'No writable calendars were found.',
          }
          })),
    }),
    search_events: tool({
      description: 'Search Google Calendar events by text query, date range, and optional calendar IDs.',
      inputSchema: searchEventsInputSchema,
      execute: async ({ calendarIds, dateFrom, dateTo, limit, query }) =>
        executeLoggedTool('search_events', turnId, () =>
          withSession(session, setNotice, 'Sign in with Google to search your calendar events.', async (session) => {
            const { searchGoogleCalendarEvents } = await import('@/lib/server/google-calendar')
          const calendars = await getCalendars!()
          const events = await searchGoogleCalendarEvents({
            accessToken: session.tokens.accessToken,
            calendarIds,
            calendars,
            limit,
            query,
            timeMax: dateTo ? `${dateTo}T23:59:59Z` : undefined,
            timeMin: dateFrom ? `${dateFrom}T00:00:00Z` : undefined,
          })

          return {
            detail:
              events.length > 0
                ? `Found ${events.length} matching event${events.length === 1 ? '' : 's'}.`
                : 'No matching events were found.',
            events: events.map((event) => ({
              calendarId: event.calendarId,
              calendarName: event.calendarName,
              end: event.end ?? null,
              id: event.id,
              location: event.location ?? null,
              start: event.start ?? null,
              summary: event.summary ?? '(untitled)',
            })),
          }
          })),
    }),
    get_event: tool({
      description: 'Fetch a specific Google Calendar event by calendar ID and event ID.',
      inputSchema: getEventInputSchema,
      execute: async ({ calendarId, eventId }) =>
        executeLoggedTool('get_event', turnId, () =>
          withSession(session, setNotice, 'Sign in with Google to inspect calendar events.', async (session) => {
            const { getGoogleCalendarEvent } = await import('@/lib/server/google-calendar')
          const calendars = await getCalendars!()
          const calendarName =
            calendars.find((calendar) => calendar.id === calendarId)?.summary ?? calendarId
          const event = await getGoogleCalendarEvent(
            session.tokens.accessToken,
            calendarId,
            calendarName,
            eventId,
          )

          return {
            detail: `Loaded ${event.summary ?? 'the selected event'}.`,
            event: {
              attendees: event.attendees ?? [],
              calendarId: event.calendarId,
              calendarName: event.calendarName,
              description: event.description ?? null,
              end: event.end ?? null,
              id: event.id,
              location: event.location ?? null,
              start: event.start ?? null,
              summary: event.summary ?? '(untitled)',
            },
          }
          })),
    }),
    check_availability: tool({
      description: 'Check Google Calendar availability for a given date/time window.',
      inputSchema: checkAvailabilityInputSchema,
      execute: async ({ calendarIds, date, durationMinutes, endTime, startTime, timezone }) =>
        executeLoggedTool('check_availability', turnId, () =>
          withSession(session, setNotice, 'Sign in with Google to check calendar availability.', async (session) => {
            const { queryFreeBusy } = await import('@/lib/server/google-calendar')
          const calendars = await getCalendars!()
          const targetCalendarIds =
            calendarIds && calendarIds.length > 0
              ? calendarIds
              : calendars.slice(0, 5).map((calendar) => calendar.id)
          const resolvedTimeZone = timezone ?? input.localTimeZone
          const resolvedEndTime = endTime ?? deriveEndTime(startTime, durationMinutes ?? 60)
          const timeMin = formatRfc3339InTimeZone(date, startTime, resolvedTimeZone)
          const timeMax = formatRfc3339InTimeZone(date, resolvedEndTime, resolvedTimeZone)
          const busy = await queryFreeBusy(
            session.tokens.accessToken,
            targetCalendarIds,
            timeMin,
            timeMax,
          )

          return {
            calendars: targetCalendarIds.map((calendarId) => ({
              busy: busy[calendarId]?.busy ?? [],
              calendarId,
              calendarName:
                calendars.find((calendar) => calendar.id === calendarId)?.summary ?? calendarId,
            })),
            detail: `Checked availability across ${targetCalendarIds.length} calendar${targetCalendarIds.length === 1 ? '' : 's'} from ${startTime} to ${resolvedEndTime} on ${date}.`,
            timeMax,
            timeMin,
            timezone: resolvedTimeZone,
          }
          })),
    }),
    create_event: tool({
      description: 'Create a Google Calendar event from explicit event fields.',
      inputSchema: eventInputSchema,
      execute: async (eventInput) =>
        executeLoggedTool('create_event', turnId, () =>
          withSession(session, setNotice, 'Sign in with Google before creating events.', async (session) => {
            const normalized = await normalizeCreateRequest({
            accessToken: session.tokens.accessToken,
            eventInput,
            localTimeZone: input.localTimeZone,
            sourceInputs: input.sourceInputs,
            userSub: session.profile.sub,
          })
          if (normalized.request == null) {
            return { detail: normalized.detail }
          }

          const approvalBlock = ensureApprovalAllowed({
            action: 'create',
            executionMode,
            latestUserText: input.latestUserText,
            messages: input.messages,
            summary: normalized.summary,
          })
          if (approvalBlock) {
            return { detail: approvalBlock }
          }

          return submitWriteRequest({
            request: normalized.request,
            session,
            setNotice,
          })
          })),
    }),
    update_event: tool({
      description: 'Update an existing Google Calendar event. Provide the event id, calendar id, and changed fields.',
      inputSchema: updateEventInputSchema,
      execute: async ({ calendarId, eventId, ...eventInput }) =>
        executeUpdateOrReschedule('update_event', 'update', { calendarId, eventId, eventInput, executionMode, input, session, setNotice, turnId }),
    }),
    reschedule_event: tool({
      description: 'Reschedule an existing Google Calendar event by changing its date and or time fields.',
      inputSchema: updateEventInputSchema,
      execute: async ({ calendarId, eventId, ...eventInput }) =>
        executeUpdateOrReschedule('reschedule_event', 'reschedule', { calendarId, eventId, eventInput, executionMode, input, session, setNotice, turnId }),
    }),
    delete_event: tool({
      description: 'Delete a specific Google Calendar event by calendar id and event id.',
      inputSchema: deleteEventInputSchema,
      execute: async ({ calendarId, eventId, title, when }) =>
        executeLoggedTool('delete_event', turnId, () =>
          withSession(session, setNotice, 'Sign in with Google before deleting events.', async (session) => {
            const summary = summarizeDeleteAction({
            title: title?.trim() || 'Untitled event',
            when: when?.trim() || null,
          })
          const approvalBlock = ensureApprovalAllowed({
            action: 'delete',
            executionMode,
            latestUserText: input.latestUserText,
            messages: input.messages,
            summary,
          })
          if (approvalBlock) {
            return { detail: approvalBlock }
          }

          const { deleteGoogleCalendarEvent } = await import('@/lib/server/google-calendar')
          const deletion = await deleteGoogleCalendarEvent(
            session.tokens.accessToken,
            calendarId,
            eventId,
          )
          const response = {
            actionPerformed: deletion.actionPerformed,
            calendarId: deletion.calendarId,
            eventId: deletion.eventId,
            factChangesApplied: {
              created: [],
              staled: [],
              updated: [],
            },
            htmlLink: deletion.htmlLink,
            sendUpdates: deletion.sendUpdates,
          } satisfies SubmitEventResponse
          setNotice({
            kind: 'event-success',
            response,
          })

          return {
            detail: `Deleted ${title?.trim() || 'the selected event'} from Google Calendar.`,
          }
          })),
    }),
  }
}
