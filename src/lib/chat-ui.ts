import type { FileUIPart, ToolUIPart, UIMessage } from 'ai'
import {
  calendarToolSignInRequiredSchema,
  writeCalendarToolSuccessSchema,
  type CheckAvailabilityToolOutput,
  type GetEventToolOutput,
  type ListWritableCalendarsToolOutput,
  type SearchEventsToolOutput,
  type SourceInput,
  type WriteCalendarToolOutput,
  type WriteCalendarToolSuccess,
} from '@/lib/contracts'

export type GoogleCalendarToolName =
  | 'list_writable_calendars'
  | 'search_events'
  | 'get_event'
  | 'check_availability'
  | 'create_event'
  | 'update_event'
  | 'reschedule_event'
  | 'delete_event'

export type GoogleCalendarUITools = Record<
  'list_writable_calendars',
  { input: unknown; output: ListWritableCalendarsToolOutput }
> &
  Record<'search_events', { input: unknown; output: SearchEventsToolOutput }> &
  Record<'get_event', { input: unknown; output: GetEventToolOutput }> &
  Record<'check_availability', { input: unknown; output: CheckAvailabilityToolOutput }> &
  Record<
    'create_event' | 'update_event' | 'reschedule_event' | 'delete_event',
    { input: unknown; output: WriteCalendarToolOutput }
  >

export type AppChatMessage = UIMessage<
  never,
  never,
  GoogleCalendarUITools
>

export type GoogleCalendarToolUIPart = ToolUIPart<GoogleCalendarUITools>

const GOOGLE_CALENDAR_TOOL_NAMES = new Set<GoogleCalendarToolName>([
  'list_writable_calendars',
  'search_events',
  'get_event',
  'check_availability',
  'create_event',
  'update_event',
  'reschedule_event',
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
  list_writable_calendars: { label: 'List writable calendars', done: 'Checked which calendars can be updated.', doing: 'Checking which calendars can be updated.' },
  search_events: { label: 'Search calendar events', done: 'Looked for matching events.', doing: 'Looking for matching events.' },
  get_event: { label: 'Load event details', done: 'Loaded the selected event.', doing: 'Loading the selected event.' },
  check_availability: { label: 'Check availability', done: 'Checked calendar availability.', doing: 'Checking calendar availability.' },
  create_event: { label: 'Create calendar event', done: 'Created the calendar event.', doing: 'Creating the calendar event.' },
  update_event: { label: 'Update calendar event', done: 'Updated the calendar event.', doing: 'Updating the calendar event.' },
  reschedule_event: { label: 'Reschedule calendar event', done: 'Rescheduled the calendar event.', doing: 'Rescheduling the calendar event.' },
  delete_event: { label: 'Delete calendar event', done: 'Deleted the calendar event.', doing: 'Deleting the calendar event.' },
}

function extractToolName(toolType: string): GoogleCalendarToolName {
  return toolType.slice(TOOL_PREFIX.length) as GoogleCalendarToolName
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
