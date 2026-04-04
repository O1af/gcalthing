import { tool, type ToolExecutionOptions } from 'ai'
import { z } from 'zod'
import {
  checkAvailabilityToolOutputSchema,
  getEventToolOutputSchema,
  listWritableCalendarsToolOutputSchema,
  searchEventsToolOutputSchema,
  writeCalendarToolOutputSchema,
  type ExecutionMode,
  type SourceInput,
  type SubmitEventResponse,
} from '@/lib/contracts'
import { deriveEndTime, formatRfc3339InTimeZone } from '@/lib/domain/date-time'
import type { GoogleCalendarListEntry } from '@/lib/server/google-calendar'
import type { SessionContext } from './index'
import {
  executeLoggedTool,
  executeUpdateOrReschedule,
  normalizeCreateRequest,
  submitWriteRequest,
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

export interface CalendarAgentContext {
  executionMode: ExecutionMode
  getCalendars: (() => Promise<GoogleCalendarListEntry[]>) | null
  latestUserText: string
  localTimeZone: string
  session: SessionContext | null
  sourceInputs: SourceInput[]
  turnId: string
}

type WriteToolResult = z.infer<typeof writeCalendarToolOutputSchema>

export function createCalendarToolSet(writeNeedsApproval: boolean) {
  return {
    list_writable_calendars: tool({
      description: 'List writable Google Calendars for the signed-in user.',
      inputSchema: z.object({}),
      outputSchema: listWritableCalendarsToolOutputSchema,
      execute: async (_input, options) => {
        const context = getCalendarAgentContext(options)
        return executeLoggedTool('list_writable_calendars', context.turnId, () =>
          withSession(
            context.session,
            'Sign in with Google to list your calendars.',
            async () => {
              const calendars = await requireCalendars(context)

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
                status: 'ok' as const,
              }
            },
          ),
        )
      },
    }),
    search_events: tool({
      description:
        'Search Google Calendar events by text query, date range, and optional calendar IDs.',
      inputSchema: searchEventsInputSchema,
      outputSchema: searchEventsToolOutputSchema,
      execute: async ({ calendarIds, dateFrom, dateTo, limit, query }, options) => {
        const context = getCalendarAgentContext(options)
        return executeLoggedTool('search_events', context.turnId, () =>
          withSession(
            context.session,
            'Sign in with Google to search your calendar events.',
            async (session) => {
              const { searchGoogleCalendarEvents } = await import(
                '@/lib/server/google-calendar'
              )
              const calendars = await requireCalendars(context)
              const events = await searchGoogleCalendarEvents({
                accessToken: session.tokens.accessToken,
                calendarIds,
                calendars,
                limit,
                query,
                timeMax: dateTo
                  ? formatRfc3339InTimeZone(dateTo, '23:59', context.localTimeZone)
                  : undefined,
                timeMin: dateFrom
                  ? formatRfc3339InTimeZone(dateFrom, '00:00', context.localTimeZone)
                  : undefined,
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
                status: 'ok' as const,
              }
            },
          ),
        )
      },
    }),
    get_event: tool({
      description: 'Fetch a specific Google Calendar event by calendar ID and event ID.',
      inputSchema: getEventInputSchema,
      outputSchema: getEventToolOutputSchema,
      execute: async ({ calendarId, eventId }, options) => {
        const context = getCalendarAgentContext(options)
        return executeLoggedTool('get_event', context.turnId, () =>
          withSession(
            context.session,
            'Sign in with Google to inspect calendar events.',
            async (session) => {
              const { getGoogleCalendarEvent } = await import(
                '@/lib/server/google-calendar'
              )
              const calendars = await requireCalendars(context)
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
                status: 'ok' as const,
              }
            },
          ),
        )
      },
    }),
    check_availability: tool({
      description: 'Check Google Calendar availability for a given date/time window.',
      inputSchema: checkAvailabilityInputSchema,
      outputSchema: checkAvailabilityToolOutputSchema,
      execute: async (
        { calendarIds, date, durationMinutes, endTime, startTime, timezone },
        options,
      ) => {
        const context = getCalendarAgentContext(options)
        return executeLoggedTool('check_availability', context.turnId, () =>
          withSession(
            context.session,
            'Sign in with Google to check calendar availability.',
            async (session) => {
              const { queryFreeBusy } = await import('@/lib/server/google-calendar')
              const calendars = await requireCalendars(context)
              const targetCalendarIds =
                calendarIds && calendarIds.length > 0
                  ? calendarIds
                  : calendars.slice(0, 5).map((calendar) => calendar.id)
              const resolvedTimeZone = timezone ?? context.localTimeZone
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
                    calendars.find((calendar) => calendar.id === calendarId)?.summary ??
                    calendarId,
                })),
                detail: `Checked availability across ${targetCalendarIds.length} calendar${targetCalendarIds.length === 1 ? '' : 's'} from ${startTime} to ${resolvedEndTime} on ${date}.`,
                status: 'ok' as const,
                timeMax,
                timeMin,
                timezone: resolvedTimeZone,
              }
            },
          ),
        )
      },
    }),
    create_event: tool({
      description: 'Create a Google Calendar event from explicit event fields.',
      inputSchema: eventInputSchema,
      needsApproval: writeNeedsApproval,
      outputSchema: writeCalendarToolOutputSchema,
      execute: async (eventInput, options) => {
        const context = getCalendarAgentContext(options)
        return executeLoggedTool('create_event', context.turnId, () =>
          withSession(
            context.session,
            'Sign in with Google before creating events.',
            async (session) => {
              const normalized = await normalizeCreateRequest({
                accessToken: session.tokens.accessToken,
                eventInput,
                localTimeZone: context.localTimeZone,
                sourceInputs: context.sourceInputs,
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
      },
    }),
    update_event: tool({
      description:
        'Update an existing Google Calendar event. Provide the event id, calendar id, and changed fields.',
      inputSchema: updateEventInputSchema,
      needsApproval: writeNeedsApproval,
      outputSchema: writeCalendarToolOutputSchema,
      execute: async (
        { calendarId, eventId, ...eventInput },
        options,
      ): Promise<WriteToolResult> => {
        const context = getCalendarAgentContext(options)
        return executeUpdateOrReschedule('update_event', {
          calendarId,
          eventId,
          eventInput,
          localTimeZone: context.localTimeZone,
          session: context.session,
          sourceInputs: context.sourceInputs,
          turnId: context.turnId,
        })
      },
    }),
    reschedule_event: tool({
      description:
        'Reschedule an existing Google Calendar event by changing its date and or time fields.',
      inputSchema: updateEventInputSchema,
      needsApproval: writeNeedsApproval,
      outputSchema: writeCalendarToolOutputSchema,
      execute: async (
        { calendarId, eventId, ...eventInput },
        options,
      ): Promise<WriteToolResult> => {
        const context = getCalendarAgentContext(options)
        return executeUpdateOrReschedule('reschedule_event', {
          calendarId,
          eventId,
          eventInput,
          localTimeZone: context.localTimeZone,
          session: context.session,
          sourceInputs: context.sourceInputs,
          turnId: context.turnId,
        })
      },
    }),
    delete_event: tool({
      description: 'Delete a specific Google Calendar event by calendar id and event id.',
      inputSchema: deleteEventInputSchema,
      needsApproval: writeNeedsApproval,
      outputSchema: writeCalendarToolOutputSchema,
      execute: async ({ calendarId, eventId, title }, options): Promise<WriteToolResult> => {
        const context = getCalendarAgentContext(options)
        return executeLoggedTool('delete_event', context.turnId, () =>
          withSession(
            context.session,
            'Sign in with Google before deleting events.',
            async (session) => {
              const { deleteGoogleCalendarEvent } = await import(
                '@/lib/server/google-calendar'
              )
              const deletion = await deleteGoogleCalendarEvent(
                session.tokens.accessToken,
                calendarId,
                eventId,
              )

              return {
                actionPerformed: deletion.actionPerformed,
                calendarId: deletion.calendarId,
                detail: `Deleted ${title?.trim() || 'the selected event'} from Google Calendar.`,
                eventId: deletion.eventId,
                factChangesApplied: {
                  created: [],
                  staled: [],
                  updated: [],
                },
                htmlLink: deletion.htmlLink,
                sendUpdates: deletion.sendUpdates,
                status: 'ok' as const,
              } satisfies SubmitEventResponse & {
                detail: string
                status: 'ok'
              }
            },
          ),
        )
      },
    }),
  }
}

function getCalendarAgentContext(options: ToolExecutionOptions): CalendarAgentContext {
  return options.experimental_context as CalendarAgentContext
}

async function requireCalendars(context: CalendarAgentContext) {
  const calendars = await context.getCalendars?.()
  if (!calendars) {
    throw new Error('Calendar context is unavailable for this request.')
  }
  return calendars
}
