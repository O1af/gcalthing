import type { FileUIPart, ToolUIPart, UIMessage } from 'ai'
import { z } from 'zod'
import {
  calendarToolSignInRequiredSchema,
  writeCalendarToolSuccessSchema,
  type CheckAvailabilityToolOutput,
  type SearchEventsToolOutput,
  type SourceInput,
  type WriteCalendarToolOutput,
  type WriteCalendarToolSuccess,
} from '@/lib/contracts'

export type GoogleCalendarToolName =
  | 'search_events'
  | 'check_availability'
  | 'create_event'
  | 'update_event'
  | 'delete_event'

export type GoogleCalendarUITools =
  Record<'search_events', { input: unknown; output: SearchEventsToolOutput }> &
  Record<'check_availability', { input: unknown; output: CheckAvailabilityToolOutput }> &
  Record<
    'create_event' | 'update_event' | 'delete_event',
    { input: unknown; output: WriteCalendarToolOutput }
  >

export type AppChatMessage = UIMessage<
  never,
  never,
  GoogleCalendarUITools
>

export type GoogleCalendarToolUIPart = ToolUIPart<GoogleCalendarUITools>

const GOOGLE_CALENDAR_TOOL_NAMES = new Set<GoogleCalendarToolName>([
  'search_events',
  'check_availability',
  'create_event',
  'update_event',
  'delete_event',
])

type TextSourceType = Extract<SourceInput, { kind: 'text' }>['sourceType']

export function getMessageText(message: Pick<UIMessage, 'parts'>): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export function getMessageReasoningText(message: AppChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => part.text)
    .join('')
}

export function isMessageReasoningStreaming(message: AppChatMessage): boolean {
  return message.parts.some(
    (part) => part.type === 'reasoning' && part.state === 'streaming',
  )
}

export function getMessageFiles(message: AppChatMessage): FileUIPart[] {
  return message.parts.filter((part) => part.type === 'file')
}

export function getMessageGoogleCalendarToolParts(
  message: AppChatMessage,
): GoogleCalendarToolUIPart[] {
  return message.parts.filter(isGoogleCalendarToolPart)
}

const TOOL_PREFIX = 'tool-'

const TOOL_META: Record<GoogleCalendarToolName, { label: string; done: string; doing: string }> = {
  search_events: { label: 'Search calendar events', done: 'Looked for matching events.', doing: 'Looking for matching events.' },
  check_availability: { label: 'Check availability', done: 'Checked calendar availability.', doing: 'Checking calendar availability.' },
  create_event: { label: 'Create calendar event', done: 'Created the calendar event.', doing: 'Creating the calendar event.' },
  update_event: { label: 'Update calendar event', done: 'Updated the calendar event.', doing: 'Updating the calendar event.' },
  delete_event: { label: 'Delete calendar event', done: 'Deleted the calendar event.', doing: 'Deleting the calendar event.' },
}

function extractToolName(toolType: string): GoogleCalendarToolName {
  return toolType.slice(TOOL_PREFIX.length) as GoogleCalendarToolName
}

// Client-safe schemas for parsing toolPart.input for display purposes
const attendeeDisplaySchema = z.object({ email: z.string(), name: z.string() })

const eventInputDisplaySchema = z.object({
  allDay: z.boolean().optional(),
  attendees: z.array(attendeeDisplaySchema).optional(),
  calendarId: z.string().nullish(),
  date: z.string().nullish(),
  description: z.string().nullish(),
  durationMinutes: z.number().nullish(),
  endTime: z.string().nullish(),
  location: z.string().nullish(),
  recurrenceRule: z.string().nullish(),
  startTime: z.string().nullish(),
  timezone: z.string().nullish(),
  title: z.string().nullish(),
}).partial()

const deleteEventInputDisplaySchema = z.object({
  calendarId: z.string(),
  eventId: z.string(),
  title: z.string().optional(),
  when: z.string().optional(),
})

const updateEventInputDisplaySchema = eventInputDisplaySchema.extend({
  calendarId: z.string(),
  eventId: z.string(),
})

const searchEventsInputDisplaySchema = z.object({
  calendarIds: z.array(z.string()).optional(),
  dateFrom: z.string().nullish(),
  dateTo: z.string().nullish(),
  query: z.string().nullish(),
})

const checkAvailabilityInputDisplaySchema = z.object({
  date: z.string(),
  durationMinutes: z.number().nullish(),
  endTime: z.string().nullish(),
  startTime: z.string(),
})

export type EventInputDisplay = z.infer<typeof eventInputDisplaySchema>
export type DeleteEventInputDisplay = z.infer<typeof deleteEventInputDisplaySchema>
export type UpdateEventInputDisplay = z.infer<typeof updateEventInputDisplaySchema>
export type SearchEventsInputDisplay = z.infer<typeof searchEventsInputDisplaySchema>
export type CheckAvailabilityInputDisplay = z.infer<typeof checkAvailabilityInputDisplaySchema>

export type ParsedToolInput =
  | { tool: 'create_event'; data: EventInputDisplay }
  | { tool: 'update_event'; data: UpdateEventInputDisplay }
  | { tool: 'delete_event'; data: DeleteEventInputDisplay }
  | { tool: 'search_events'; data: SearchEventsInputDisplay }
  | { tool: 'check_availability'; data: CheckAvailabilityInputDisplay }
  | null

export function parseToolInput(toolPart: Pick<GoogleCalendarToolUIPart, 'type' | 'input'>): ParsedToolInput {
  const toolName = extractToolName(toolPart.type)
  switch (toolName) {
    case 'create_event': {
      const r = eventInputDisplaySchema.safeParse(toolPart.input)
      return r.success ? { tool: 'create_event', data: r.data } : null
    }
    case 'update_event': {
      const r = updateEventInputDisplaySchema.safeParse(toolPart.input)
      return r.success ? { tool: toolName, data: r.data } : null
    }
    case 'delete_event': {
      const r = deleteEventInputDisplaySchema.safeParse(toolPart.input)
      return r.success ? { tool: 'delete_event', data: r.data } : null
    }
    case 'search_events': {
      const r = searchEventsInputDisplaySchema.safeParse(toolPart.input)
      return r.success ? { tool: 'search_events', data: r.data } : null
    }
    case 'check_availability': {
      const r = checkAvailabilityInputDisplaySchema.safeParse(toolPart.input)
      return r.success ? { tool: 'check_availability', data: r.data } : null
    }
    default:
      return null
  }
}

export function getGoogleCalendarToolRichLabel(
  toolPart: Pick<GoogleCalendarToolUIPart, 'type' | 'input'>,
): string {
  const fallback = TOOL_META[extractToolName(toolPart.type)].label
  const parsed = parseToolInput(toolPart)
  if (!parsed) return fallback

  switch (parsed.tool) {
    case 'create_event': {
      const title = parsed.data.title
      if (!title) return fallback
      return parsed.data.date ? `Create: ${title} on ${parsed.data.date}` : `Create: ${title}`
    }
    case 'update_event': {
      const title = parsed.data.title
      return title ? `Update: ${title}` : fallback
    }
    case 'delete_event': {
      const title = parsed.data.title
      return title ? `Delete: ${title}` : fallback
    }
    case 'search_events': {
      const q = parsed.data.query
      return q ? `Search: "${q}"` : fallback
    }
    case 'check_availability': {
      return `Check availability: ${parsed.data.date} ${parsed.data.startTime}`
    }
  }
}

export function getGoogleCalendarToolLabel(
  toolPart: Pick<GoogleCalendarToolUIPart, 'type'>,
): string {
  return TOOL_META[extractToolName(toolPart.type)].label
}

export function getGoogleCalendarToolSummary(
  toolPart: GoogleCalendarToolUIPart,
): string {
  if (toolPart.state === 'input-streaming') return 'Preparing the calendar request.'
  if (toolPart.state === 'approval-requested') return 'Waiting for approval before making this calendar change.'
  if (toolPart.state === 'approval-responded') {
    return toolPart.approval.approved
      ? 'Approval received and the calendar change is continuing.'
      : 'This calendar change was not approved.'
  }
  if (toolPart.state === 'output-error') return 'Google Calendar returned an error for this step.'
  if (toolPart.state === 'output-denied') return 'This calendar step was denied.'
  if (toolPart.state === 'output-available') {
    const signInDetail = getGoogleCalendarSignInDetail(toolPart)
    if (signInDetail) {
      return signInDetail
    }

    if (toolPart.output && toolPart.output.status === 'needs-input') {
      return toolPart.output.detail
    }
  }

  const meta = TOOL_META[extractToolName(toolPart.type)]
  return toolPart.state === 'output-available' ? meta.done : meta.doing
}

export function isGoogleCalendarToolPart(
  part: AppChatMessage['parts'][number],
): part is GoogleCalendarToolUIPart {
  if (!part.type.startsWith(TOOL_PREFIX)) {
    return false
  }

  return GOOGLE_CALENDAR_TOOL_NAMES.has(extractToolName(part.type))
}

export function toSourceInputsFromMessage(message: AppChatMessage): SourceInput[] {
  const text = getMessageText(message).trim()
  const inputs: SourceInput[] = []

  if (text) {
    const sourceType = inferTextSourceType(text)
    inputs.push({
      kind: 'text',
      id: crypto.randomUUID(),
      label: getTextSourceLabel(sourceType),
      sourceType,
      text,
    })
  }

  for (const part of message.parts) {
    if (part.type !== 'file' || !part.mediaType.startsWith('image/')) {
      continue
    }

    inputs.push({
      dataUrl: part.url,
      filename: part.filename,
      id: crypto.randomUUID(),
      kind: 'image',
      label: part.filename ?? 'Image upload',
      mediaType: part.mediaType,
    })
  }

  return inputs
}

export function getGoogleCalendarSignInDetail(
  toolPart: GoogleCalendarToolUIPart,
): string | null {
  if (toolPart.state !== 'output-available') {
    return null
  }

  const parsed = calendarToolSignInRequiredSchema.safeParse(toolPart.output)
  return parsed.success ? parsed.data.detail : null
}

export function getGoogleCalendarWriteSuccess(
  toolPart: GoogleCalendarToolUIPart,
): WriteCalendarToolSuccess | null {
  if (toolPart.state !== 'output-available') {
    return null
  }

  const parsed = writeCalendarToolSuccessSchema.safeParse(toolPart.output)
  return parsed.success ? parsed.data : null
}

function inferTextSourceType(text: string): TextSourceType {
  const normalized = text.toLowerCase()
  if (
    normalized.includes('forwarded message') ||
    normalized.includes('begin forwarded message') ||
    /^fwd:/m.test(normalized)
  ) {
    return 'forwarded-email'
  }

  if (
    /^from:/m.test(normalized) ||
    /^subject:/m.test(normalized) ||
    /^sent:/m.test(normalized) ||
    /^to:/m.test(normalized)
  ) {
    return 'email-body'
  }

  return 'pasted-text'
}

function getTextSourceLabel(sourceType: TextSourceType): string {
  if (sourceType === 'email-body') {
    return 'Email body'
  }

  if (sourceType === 'forwarded-email') {
    return 'Forwarded email'
  }

  if (sourceType === 'manual') {
    return 'Manual note'
  }

  return 'Pasted text'
}
