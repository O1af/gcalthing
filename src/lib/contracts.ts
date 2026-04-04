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

export const draftAttendeeMentionSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable().default(null),
  optional: z.boolean().default(false),
})

export const draftIntentSchema = z.object({
  allDay: z.boolean().default(false),
  attendeeMentions: z.array(draftAttendeeMentionSchema).default([]),
  calendarId: z.string().nullable().default(null),
  date: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  durationMinutes: z.number().int().positive().nullable().default(null),
  endDate: z.string().nullable().default(null),
  endTime: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  recurrenceRule: z.string().nullable().default(null),
  startTime: z.string().nullable().default(null),
  timezone: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
})

export const attendeeCandidateSchema = z.object({
  mention: z.string(),
  displayName: z.string(),
  email: z.string().email(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).default([]),
  source: z.enum(['calendar-history', 'shared-fact', 'manual']).default('calendar-history'),
  autoSelected: z.boolean().default(false),
})

export const attendeeResolutionGroupSchema = z.object({
  mention: z.string(),
  optional: z.boolean().default(false),
  selectedEmail: z.string().email().nullable().default(null),
  manualEmail: z.string().email().nullable().default(null),
  approved: z.boolean().default(false),
  candidates: z.array(attendeeCandidateSchema).default([]),
})

export const calendarSuggestionSchema = z.object({
  calendarId: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).default([]),
})

export const calendarOptionSchema = z.object({
  id: z.string(),
  summary: z.string(),
  primary: z.boolean().default(false),
  timeZone: z.string().nullable().default(null),
  accessRole: z.string(),
})

export const calendarContextSummarySchema = z.object({
  calendars: z.array(calendarOptionSchema).default([]),
  recentTitles: z.array(z.object({ title: z.string(), count: z.number().int() })).default([]),
  frequentLocations: z
    .array(z.object({ location: z.string(), count: z.number().int() }))
    .default([]),
  attendeeDirectory: z
    .array(
      z.object({
        displayName: z.string(),
        email: z.string().email(),
        count: z.number().int(),
        lastSeenAt: z.string(),
      }),
    )
    .default([]),
})

export const conflictIntervalSchema = z.object({
  calendarId: z.string(),
  calendarName: z.string(),
  start: z.string(),
  end: z.string(),
})

export const conflictCheckResultSchema = z.object({
  hasConflict: z.boolean(),
  checkedCalendarIds: z.array(z.string()).default([]),
  intervals: z.array(conflictIntervalSchema).default([]),
})

export const existingEventMatchSchema = z.object({
  eventId: z.string(),
  calendarId: z.string(),
  calendarName: z.string(),
  title: z.string(),
  start: z.string().nullable().default(null),
  score: z.number().min(0).max(1),
  reason: z.string(),
  selected: z.boolean().default(false),
})

export const reviewBlockerSchema = z.object({
  code: z.string(),
  label: z.string(),
  detail: z.string(),
  severity: z.enum(['warning', 'blocking']).default('warning'),
})

export const reviewEventSchema = z.object({
  title: z.string(),
  date: z.string().nullable().default(null),
  startTime: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
  endTime: z.string().nullable().default(null),
  durationMinutes: z.number().int().positive().nullable().default(null),
  timezone: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  recurrenceRule: z.string().nullable().default(null),
  allDay: z.boolean().default(false),
  calendarId: z.string().default('primary'),
})

export const factKindSchema = z.enum([
  'attendee-alias',
  'duration-pattern',
  'location-pattern',
  'calendar-pattern',
  'recurrence-pattern',
  'title-pattern',
])

export const factRecordSchema = z.object({
  id: z.string(),
  kind: factKindSchema,
  subject: z.string(),
  value: z.string(),
  status: z.enum(['active', 'stale']).default('active'),
  confidence: z.number().min(0).max(1),
  source: z.enum(['calendar-history', 'user-confirmed', 'system-inferred']),
  evidence: z.array(z.string()).default([]),
  lastObservedAt: z.string().nullable().default(null),
  lastConfirmedAt: z.string().nullable().default(null),
})

export const factsContextSchema = z.object({
  facts: z.array(factRecordSchema).default([]),
  promptSummary: z.array(z.string()).default([]),
})

export const factChangeSchema = z.object({
  action: z.enum(['created', 'updated', 'staled']),
  kind: factKindSchema,
  subject: z.string(),
  previousValue: z.string().nullable().default(null),
  nextValue: z.string().nullable().default(null),
  reason: z.string(),
})

export const factChangeSetSchema = z.object({
  created: z.array(factChangeSchema).default([]),
  updated: z.array(factChangeSchema).default([]),
  staled: z.array(factChangeSchema).default([]),
})

export const proposedActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
  }),
  z.object({
    type: z.literal('update'),
    calendarId: z.string(),
    eventId: z.string(),
  }),
])

export const reviewDraftSchema = z.object({
  attendeeGroups: z.array(attendeeResolutionGroupSchema).default([]),
  calendarContext: calendarContextSummarySchema,
  calendarSuggestions: z.array(calendarSuggestionSchema).default([]),
  calendars: z.array(calendarOptionSchema).default([]),
  conflictCheck: conflictCheckResultSchema,
  event: reviewEventSchema,
  existingEventMatches: z.array(existingEventMatchSchema).default([]),
  factsContext: factsContextSchema,
  intent: draftIntentSchema,
  proposedAction: proposedActionSchema.default({ type: 'create' }),
  reviewBlockers: z.array(reviewBlockerSchema).default([]),
  smartSignals: z.array(z.object({ label: z.string(), detail: z.string() })).default([]),
})

export const refreshReviewDraftRequestSchema = z.object({
  draft: reviewDraftSchema,
  localTimeZone: z.string(),
})

export const submitEventRequestSchema = z.object({
  action: proposedActionSchema,
  event: reviewEventSchema,
  attendeeGroups: z.array(attendeeResolutionGroupSchema).default([]),
  sourceInputs: z.array(sourceInputSchema).default([]),
  appendSourceDetails: z.boolean().default(true),
})

export const submitEventResponseSchema = z.object({
  calendarId: z.string(),
  eventId: z.string(),
  htmlLink: z.string().url().nullable().default(null),
  sendUpdates: z.boolean(),
  actionPerformed: z.enum(['created', 'updated', 'deleted']),
  factChangesApplied: factChangeSetSchema,
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
            displayName: z.string().optional(),
            email: z.string().optional(),
          }),
        )
        .default([]),
      description: z.string().nullable().default(null),
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
  factChangesApplied: factChangeSetSchema,
  htmlLink: z.string().url().nullable().default(null),
  sendUpdates: z.boolean(),
})

export const writeCalendarToolOutputSchema = z.union([
  calendarToolNeedsInputSchema,
  calendarToolSignInRequiredSchema,
  writeCalendarToolSuccessSchema,
])

export type SourceInput = z.infer<typeof sourceInputSchema>
export type ExecutionMode = z.infer<typeof executionModeSchema>
export type DraftAttendeeMention = z.infer<typeof draftAttendeeMentionSchema>
export type DraftIntent = z.infer<typeof draftIntentSchema>
export type AttendeeCandidate = z.infer<typeof attendeeCandidateSchema>
export type AttendeeResolutionGroup = z.infer<typeof attendeeResolutionGroupSchema>
export type CalendarSuggestion = z.infer<typeof calendarSuggestionSchema>
export type CalendarContextSummary = z.infer<typeof calendarContextSummarySchema>
export type ConflictCheckResult = z.infer<typeof conflictCheckResultSchema>
export type ExistingEventMatch = z.infer<typeof existingEventMatchSchema>
export type ReviewDraft = z.infer<typeof reviewDraftSchema>
export type FactRecord = z.infer<typeof factRecordSchema>
export type FactsContext = z.infer<typeof factsContextSchema>
export type FactChange = z.infer<typeof factChangeSchema>
export type FactChangeSet = z.infer<typeof factChangeSetSchema>
export type ProposedAction = z.infer<typeof proposedActionSchema>
export type RefreshReviewDraftRequest = z.infer<typeof refreshReviewDraftRequestSchema>
export type SubmitEventRequest = z.infer<typeof submitEventRequestSchema>
export type SubmitEventResponse = z.infer<typeof submitEventResponseSchema>
export type CalendarToolNeedsInput = z.infer<typeof calendarToolNeedsInputSchema>
export type CalendarToolSignInRequired = z.infer<typeof calendarToolSignInRequiredSchema>
export type ListWritableCalendarsToolOutput = z.infer<
  typeof listWritableCalendarsToolOutputSchema
>
export type SearchEventsToolOutput = z.infer<typeof searchEventsToolOutputSchema>
export type GetEventToolOutput = z.infer<typeof getEventToolOutputSchema>
export type CheckAvailabilityToolOutput = z.infer<
  typeof checkAvailabilityToolOutputSchema
>
export type WriteCalendarToolSuccess = z.infer<typeof writeCalendarToolSuccessSchema>
export type WriteCalendarToolOutput = z.infer<typeof writeCalendarToolOutputSchema>

export const emptyFactsContext: FactsContext = factsContextSchema.parse({})

export function getSelectedAttendees(groups: AttendeeResolutionGroup[]) {
  return groups
    .filter((group) => group.approved)
    .flatMap((group) => {
      if (group.manualEmail) {
        return [
          {
            mention: group.mention,
            displayName: group.mention,
            email: group.manualEmail,
            confidence: 0.5,
            reasons: ['Entered manually during review'],
            source: 'manual' as const,
            autoSelected: false,
          },
        ]
      }

      const selected = group.candidates.find((candidate) => candidate.email === group.selectedEmail)
      return selected ? [selected] : []
    })
}
