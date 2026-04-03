import type { FileUIPart, ToolUIPart, UIMessage } from 'ai'
import type { ChatNotice, SourceInput } from '@/lib/contracts'

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
  GoogleCalendarToolName,
  { input: unknown; output: unknown }
>

export type AppChatMessage = UIMessage<
  never,
  { chatNotice: ChatNotice },
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

export function isMessageReasoning(message: AppChatMessage): boolean {
  return message.parts.some((part) => part.type === 'reasoning')
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

export function getGoogleCalendarToolLabel(
  toolPart: Pick<GoogleCalendarToolUIPart, 'type'>,
): string {
  const name = toolPart.type.slice('tool-'.length) as GoogleCalendarToolName

  if (name === 'list_writable_calendars') {
    return 'List writable calendars'
  }

  if (name === 'search_events') {
    return 'Search calendar events'
  }

  if (name === 'get_event') {
    return 'Load event details'
  }

  if (name === 'check_availability') {
    return 'Check availability'
  }

  if (name === 'create_event') {
    return 'Create calendar event'
  }

  if (name === 'update_event') {
    return 'Update calendar event'
  }

  if (name === 'reschedule_event') {
    return 'Reschedule calendar event'
  }

  return 'Delete calendar event'
}

export function getGoogleCalendarToolSummary(
  toolPart: GoogleCalendarToolUIPart,
): string {
  if (toolPart.state === 'input-streaming') {
    return 'Preparing the calendar request.'
  }

  if (toolPart.state === 'approval-requested') {
    return 'Waiting for approval before making this calendar change.'
  }

  if (toolPart.state === 'approval-responded') {
    return toolPart.approval.approved
      ? 'Approval received and the calendar change is continuing.'
      : 'This calendar change was not approved.'
  }

  if (toolPart.state === 'output-error') {
    return 'Google Calendar returned an error for this step.'
  }

  if (toolPart.state === 'output-denied') {
    return 'This calendar step was denied.'
  }

  const name = toolPart.type.slice('tool-'.length) as GoogleCalendarToolName

  if (name === 'list_writable_calendars') {
    return toolPart.state === 'output-available'
      ? 'Checked which calendars can be updated.'
      : 'Checking which calendars can be updated.'
  }

  if (name === 'search_events') {
    return toolPart.state === 'output-available'
      ? 'Looked for matching events.'
      : 'Looking for matching events.'
  }

  if (name === 'get_event') {
    return toolPart.state === 'output-available'
      ? 'Loaded the selected event.'
      : 'Loading the selected event.'
  }

  if (name === 'check_availability') {
    return toolPart.state === 'output-available'
      ? 'Checked calendar availability.'
      : 'Checking calendar availability.'
  }

  if (name === 'create_event') {
    return toolPart.state === 'output-available'
      ? 'Created the calendar event.'
      : 'Creating the calendar event.'
  }

  if (name === 'update_event') {
    return toolPart.state === 'output-available'
      ? 'Updated the calendar event.'
      : 'Updating the calendar event.'
  }

  if (name === 'reschedule_event') {
    return toolPart.state === 'output-available'
      ? 'Rescheduled the calendar event.'
      : 'Rescheduling the calendar event.'
  }

  return toolPart.state === 'output-available'
    ? 'Deleted the calendar event.'
    : 'Deleting the calendar event.'
}

export function isGoogleCalendarToolPart(
  part: AppChatMessage['parts'][number],
): part is GoogleCalendarToolUIPart {
  if (!part.type.startsWith('tool-')) {
    return false
  }

  return GOOGLE_CALENDAR_TOOL_NAMES.has(
    part.type.slice('tool-'.length) as GoogleCalendarToolName,
  )
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

export function getMessageNotice(message: AppChatMessage): ChatNotice | null {
  const noticePart = message.parts.find((part) => part.type === 'data-chatNotice')
  return noticePart?.data ?? null
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
