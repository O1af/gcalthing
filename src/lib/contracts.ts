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

export const normalizedInputSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'image']),
  label: z.string(),
  sourceType: z.string(),
  text: z.string().nullable(),
  mediaType: z.string().nullable(),
  dataUrl: z.string().nullable(),
})

export const draftEvidenceSchema = z.object({
  field: z.string(),
  snippet: z.string(),
  sourceInputId: z.string().nullable().default(null),
})

export const draftAttendeeMentionSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable().default(null),
  optional: z.boolean().default(false),
})

export const draftCandidateSchema = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  title: z.string().nullable().default(null),
  date: z.string().nullable().default(null),
  startTime: z.string().nullable().default(null),
  endTime: z.string().nullable().default(null),
  durationMinutes: z.number().int().positive().nullable().default(null),
  timezone: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
})

export const extractedEventDraftSchema = z.object({
  title: z.string().nullable().default(null),
  date: z.string().nullable().default(null),
  startTime: z.string().nullable().default(null),
  endTime: z.string().nullable().default(null),
  durationMinutes: z.number().int().positive().nullable().default(null),
  timezone: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  attendeeMentions: z.array(draftAttendeeMentionSchema).default([]),
  description: z.string().nullable().default(null),
  recurrenceRule: z.string().nullable().default(null),
  unknownFields: z.array(z.string()).default([]),
  ambiguities: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(draftEvidenceSchema).default([]),
  candidates: z.array(draftCandidateSchema).default([]),
})

const llmNullableStringSchema = z.union([z.string(), z.null()])
const llmNullableEmailSchema = z.union([z.string().email(), z.null()])
const llmNullablePositiveIntegerSchema = z.union([z.number().int().positive(), z.null()])

export const llmDraftAttendeeMentionSchema = z.object({
  name: z.string().min(1),
  email: llmNullableEmailSchema,
  optional: z.boolean(),
})

export const llmDraftEvidenceSchema = z.object({
  field: z.string(),
  snippet: z.string(),
  sourceInputId: llmNullableStringSchema,
})

export const llmDraftCandidateSchema = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  title: llmNullableStringSchema,
  date: llmNullableStringSchema,
  startTime: llmNullableStringSchema,
  endTime: llmNullableStringSchema,
  durationMinutes: llmNullablePositiveIntegerSchema,
  timezone: llmNullableStringSchema,
  location: llmNullableStringSchema,
})

export const llmExtractedEventDraftSchema = z.object({
  title: llmNullableStringSchema,
  date: llmNullableStringSchema,
  startTime: llmNullableStringSchema,
  endTime: llmNullableStringSchema,
  durationMinutes: llmNullablePositiveIntegerSchema,
  timezone: llmNullableStringSchema,
  location: llmNullableStringSchema,
  attendeeMentions: z.array(llmDraftAttendeeMentionSchema),
  description: llmNullableStringSchema,
  recurrenceRule: llmNullableStringSchema,
  unknownFields: z.array(z.string()),
  ambiguities: z.array(z.string()),
  assumptions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  evidence: z.array(llmDraftEvidenceSchema),
  candidates: z.array(llmDraftCandidateSchema),
})

export const interpretationOptionSchema = draftCandidateSchema.extend({
  selected: z.boolean().default(false),
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
  event: reviewEventSchema,
  extracted: extractedEventDraftSchema,
  calendars: z.array(calendarOptionSchema).default([]),
  calendarSuggestions: z.array(calendarSuggestionSchema).default([]),
  attendeeGroups: z.array(attendeeResolutionGroupSchema).default([]),
  conflictCheck: conflictCheckResultSchema,
  existingEventMatches: z.array(existingEventMatchSchema).default([]),
  smartSignals: z.array(z.object({ label: z.string(), detail: z.string() })).default([]),
  reviewBlockers: z.array(reviewBlockerSchema).default([]),
  interpretationOptions: z.array(interpretationOptionSchema).default([]),
  calendarContext: calendarContextSummarySchema,
  factsContext: factsContextSchema,
  proposedAction: proposedActionSchema.default({ type: 'create' }),
})

export const buildDraftInputSchema = z.object({
  inputs: z.array(sourceInputSchema).min(1),
  localTimeZone: z.string(),
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
  extracted: extractedEventDraftSchema.optional(),
  appendSourceDetails: z.boolean().default(true),
})

export const submitEventResponseSchema = z.object({
  calendarId: z.string(),
  eventId: z.string(),
  htmlLink: z.string().url(),
  sendUpdates: z.boolean(),
  actionPerformed: z.enum(['created', 'updated']),
  factChangesApplied: factChangeSetSchema,
})

export const chatHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
})

export const chatArtifactSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event-draft'),
    draft: reviewDraftSchema,
    sourceInputs: z.array(sourceInputSchema).default([]),
    supportsGoogleActions: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('event-success'),
    response: submitEventResponseSchema,
  }),
  z.object({
    kind: z.literal('sign-in-required'),
    detail: z.string(),
  }),
])

export const chatTurnInputSchema = z.object({
  currentArtifact: chatArtifactSchema.nullable().default(null),
  history: z.array(chatHistoryMessageSchema).default([]),
  latestInputs: z.array(sourceInputSchema).default([]),
  localTimeZone: z.string(),
})

export const assistantTurnResponseSchema = z.object({
  artifact: chatArtifactSchema.nullable().default(null),
  text: z.string(),
})

export type SourceInput = z.infer<typeof sourceInputSchema>
export type NormalizedInput = z.infer<typeof normalizedInputSchema>
export type DraftEvidence = z.infer<typeof draftEvidenceSchema>
export type DraftCandidate = z.infer<typeof draftCandidateSchema>
export type ExtractedEventDraft = z.infer<typeof extractedEventDraftSchema>
export type InterpretationOption = z.infer<typeof interpretationOptionSchema>
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
export type BuildDraftInput = z.infer<typeof buildDraftInputSchema>
export type RefreshReviewDraftRequest = z.infer<typeof refreshReviewDraftRequestSchema>
export type SubmitEventRequest = z.infer<typeof submitEventRequestSchema>
export type SubmitEventResponse = z.infer<typeof submitEventResponseSchema>
export type ChatHistoryMessage = z.infer<typeof chatHistoryMessageSchema>
export type ChatArtifact = z.infer<typeof chatArtifactSchema>
export type ChatTurnInput = z.infer<typeof chatTurnInputSchema>
export type AssistantTurnResponse = z.infer<typeof assistantTurnResponseSchema>

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
