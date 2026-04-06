import { z } from 'zod'

export const sourceInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    id: z.string(),
    label: z.string(),
    sourceType: z.enum(['pasted-text', 'email-body', 'forwarded-email', 'manual']),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('image'),
    id: z.string(),
    label: z.string(),
    filename: z.string().optional(),
    mediaType: z.string(),
    dataUrl: z.string().startsWith('data:'),
  }),
])

export const executionModeSchema = z.enum(['approval-first', 'direct-execution'])

export const attendeeInputSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
})

export const factRecordSchema = z.object({
  id: z.string(),
  fact: z.string(),
  addedAt: z.string(),
})

export const factsContextSchema = z.array(factRecordSchema).default([])

export const writeEventRequestSchema = z.object({
  title: z.string().min(1),
  date: z.string(),
  startTime: z.string().nullable().default(null),
  endTime: z.string().nullable().default(null),
  durationMinutes: z.number().int().positive().nullable().default(null),
  allDay: z.boolean().default(false),
  timezone: z.string(),
  location: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  recurrenceRule: z.string().nullable().default(null),
  calendarId: z.string(),
  attendees: z.array(attendeeInputSchema).default([]),
  sourceInputs: z.array(sourceInputSchema).default([]),
  appendSourceDetails: z.boolean().default(true),
})

export const submitEventResponseSchema = z.object({
  calendarId: z.string(),
  eventId: z.string(),
  htmlLink: z.string().url().nullable().default(null),
  sendUpdates: z.boolean(),
  actionPerformed: z.enum(['created', 'updated', 'deleted']),
})

export const calendarOptionSchema = z.object({
  id: z.string(),
  summary: z.string(),
  primary: z.boolean().default(false),
  timeZone: z.string().nullable().default(null),
  accessRole: z.string(),
})

export const calendarToolSignInRequiredSchema = z.object({
  detail: z.string(),
  status: z.literal('sign-in-required'),
})

export const calendarToolNeedsInputSchema = z.object({
  detail: z.string(),
  status: z.literal('needs-input'),
})

export const calendarToolEventSummarySchema = z.object({
  calendarId: z.string(),
  calendarName: z.string(),
  end: z
    .object({
      date: z.string().optional(),
      dateTime: z.string().optional(),
      timeZone: z.string().optional(),
    })
    .nullable()
    .default(null),
  id: z.string(),
  location: z.string().nullable().default(null),
  start: z
    .object({
      date: z.string().optional(),
      dateTime: z.string().optional(),
      timeZone: z.string().optional(),
    })
    .nullable()
    .default(null),
  summary: z.string(),
})

export const calendarToolBusyIntervalSchema = z.object({
  end: z.string(),
  start: z.string(),
})

export const calendarToolSuccessBaseSchema = z.object({
  detail: z.string(),
  status: z.literal('ok'),
})

export const listWritableCalendarsToolOutputSchema = z.union([
  calendarToolSignInRequiredSchema,
  z.object({
    calendars: z.array(calendarOptionSchema),
    detail: z.string(),
    status: z.literal('ok'),
  }),
])

export const searchEventsToolOutputSchema = z.union([
  z.object({
    detail: z.string(),
    events: z.array(calendarToolEventSummarySchema),
    status: z.literal('ok'),
  }),
])

export const getEventToolOutputSchema = z.union([
  calendarToolSignInRequiredSchema,
  z.object({
    detail: z.string(),
    event: calendarToolEventSummarySchema.extend({
      attendees: z
        .array(
          z.object({
            comment: z.string().optional(),
            displayName: z.string().optional(),
            email: z.string().optional(),
            optional: z.boolean().optional(),
            organizer: z.boolean().optional(),
            responseStatus: z.string().optional(),
            self: z.boolean().optional(),
          }),
        )
        .default([]),
      conferenceEntryPoints: z
        .array(
          z.object({
            label: z.string().optional(),
            type: z.string().optional(),
            uri: z.string().optional(),
          }),
        )
        .default([]),
      created: z.string().nullable().default(null),
      creator: z
        .object({ displayName: z.string().optional(), email: z.string().optional() })
        .nullable()
        .default(null),
      description: z.string().nullable().default(null),
      hangoutLink: z.string().nullable().default(null),
      htmlLink: z.string().nullable().default(null),
      organizer: z
        .object({ displayName: z.string().optional(), email: z.string().optional(), self: z.boolean().optional() })
        .nullable()
        .default(null),
      recurrence: z.array(z.string()).nullable().default(null),
      recurringEventId: z.string().nullable().default(null),
      status: z.string().nullable().default(null),
      updated: z.string().nullable().default(null),
      visibility: z.string().nullable().default(null),
    }),
    status: z.literal('ok'),
  }),
])

export const checkAvailabilityToolOutputSchema = z.union([
  calendarToolSignInRequiredSchema,
  z.object({
    calendars: z.array(
      z.object({
        busy: z.array(calendarToolBusyIntervalSchema).default([]),
        calendarId: z.string(),
        calendarName: z.string(),
      }),
    ),
    detail: z.string(),
    status: z.literal('ok'),
    timeMax: z.string(),
    timeMin: z.string(),
    timezone: z.string(),
  }),
])

export const writeCalendarToolSuccessSchema = calendarToolSuccessBaseSchema.extend({
  actionPerformed: z.enum(['created', 'updated', 'deleted']),
  calendarId: z.string(),
  eventId: z.string(),
  htmlLink: z.string().url().nullable().default(null),
  sendUpdates: z.boolean(),
})

export const writeCalendarToolOutputSchema = z.union([
  calendarToolNeedsInputSchema,
  calendarToolSignInRequiredSchema,
  writeCalendarToolSuccessSchema,
])

export const manageFactsToolOutputSchema = z.union([
  calendarToolSignInRequiredSchema,
  z.object({
    detail: z.string(),
    status: z.literal('ok'),
  }),
])

export type SourceInput = z.infer<typeof sourceInputSchema>
export type ExecutionMode = z.infer<typeof executionModeSchema>
export type AttendeeInput = z.infer<typeof attendeeInputSchema>
export type FactRecord = z.infer<typeof factRecordSchema>
export type FactsContext = z.infer<typeof factsContextSchema>
export type WriteEventRequest = z.infer<typeof writeEventRequestSchema>
export type SubmitEventResponse = z.infer<typeof submitEventResponseSchema>
export type CalendarToolNeedsInput = z.infer<typeof calendarToolNeedsInputSchema>
export type CalendarToolSignInRequired = z.infer<typeof calendarToolSignInRequiredSchema>
export type ListWritableCalendarsToolOutput = z.infer<typeof listWritableCalendarsToolOutputSchema>
export type SearchEventsToolOutput = z.infer<typeof searchEventsToolOutputSchema>
export type GetEventToolOutput = z.infer<typeof getEventToolOutputSchema>
export type CheckAvailabilityToolOutput = z.infer<typeof checkAvailabilityToolOutputSchema>
export type WriteCalendarToolSuccess = z.infer<typeof writeCalendarToolSuccessSchema>
export type WriteCalendarToolOutput = z.infer<typeof writeCalendarToolOutputSchema>
export type ManageFactsToolOutput = z.infer<typeof manageFactsToolOutputSchema>

export const emptyFactsContext: FactsContext = []
