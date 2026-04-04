import { format, parseISO } from 'date-fns'
import type { ExecutionMode, FactRecord } from '@/lib/contracts'
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from '@/lib/server/google-calendar'

export function buildChatSystemPrompt(params: {
  calendars: GoogleCalendarListEntry[]
  executionMode: ExecutionMode
  facts: FactRecord[]
  localTimeZone: string
  nearTermEvents: GoogleCalendarEvent[]
  signedIn: boolean
}): string {
  const { calendars, executionMode, facts, localTimeZone, nearTermEvents, signedIn } = params

  const sections: string[] = [
    buildInstructions(executionMode, signedIn),
    buildCalendarsSection(calendars),
    buildMemorySection(facts),
    buildScheduleSection(nearTermEvents, localTimeZone),
  ]

  return sections.filter(Boolean).join('\n\n')
}

function buildInstructions(executionMode: ExecutionMode, signedIn: boolean): string {
  const lines = [
    'You are GCalthing, a concise Google Calendar assistant.',
    '',
    '## Instructions',
    '- Answer calendar questions directly from the context below when possible.',
    '- Use search_events or get_event only when the answer is not in your context window.',
    '- For writes (create/update/delete), provide all required fields: title, date, startTime (or allDay: true), and calendarId.',
    '- Resolve attendee names to emails using your memory and the attendee info visible in events below. If you cannot find an email, ask the user.',
    '- Pick the right calendar from the list below. Default to the primary calendar if unsure.',
    '- Use manage_facts to proactively remember anything useful: attendee emails, preferences, patterns. Remove facts that are outdated or wrong.',
    '- If required details are missing, ask a short follow-up question instead of guessing.',
    executionMode === 'approval-first'
      ? '- Execution mode is approval-first. When a calendar write is fully specified, call the write tool. The UI will handle approval before execution.'
      : '- Execution mode is direct-execution. Explicit complete write requests may run immediately. If details are incomplete or ambiguous, ask first.',
    signedIn
      ? '- Google Calendar tools are available.'
      : '- The user is signed out. Calendar tools will report that Google sign-in is required.',
    '- Keep responses short, practical, and action-oriented.',
  ]

  return lines.join('\n')
}

function buildCalendarsSection(calendars: GoogleCalendarListEntry[]): string {
  if (calendars.length === 0) return ''

  const lines = ['## Your Calendars']
  for (const cal of calendars) {
    const primary = cal.primary ? ' (primary)' : ''
    const tz = cal.timeZone ? ` — ${cal.timeZone}` : ''
    lines.push(`- ${cal.summary}${primary} [${cal.id}]${tz}`)
  }
  return lines.join('\n')
}

function buildMemorySection(facts: FactRecord[]): string {
  if (facts.length === 0) {
    return '## Your Memory\nNo saved facts yet. Use manage_facts to remember things.'
  }

  const lines = ['## Your Memory']
  for (const fact of facts.slice(0, 30)) {
    const date = fact.addedAt.slice(0, 10)
    lines.push(`- [${fact.id}] ${fact.fact} (${date})`)
  }
  return lines.join('\n')
}

function buildScheduleSection(events: GoogleCalendarEvent[], localTimeZone: string): string {
  if (events.length === 0) return ''

  const byDate = new Map<string, GoogleCalendarEvent[]>()
  for (const event of events) {
    const date = getEventDate(event)
    if (!date) continue
    const bucket = byDate.get(date) ?? []
    bucket.push(event)
    byDate.set(date, bucket)
  }

  const sortedDates = [...byDate.keys()].sort()
  if (sortedDates.length === 0) return ''

  const first = sortedDates[0]!
  const last = sortedDates[sortedDates.length - 1]!
  const rangeLabel = `${formatDateLabel(first)} – ${formatDateLabel(last)}`

  const lines = [`## Schedule (${rangeLabel})`]

  for (const date of sortedDates) {
    lines.push(`### ${formatDateLabel(date)}`)
    for (const event of byDate.get(date)!) {
      lines.push(formatEventLine(event))
    }
  }

  const today = new Date()
  const todayStr = format(today, 'EEEE, MMMM d, yyyy')
  lines.push('')
  lines.push(`For events outside this window, use search_events.`)
  lines.push(`Today is ${todayStr}. Timezone: ${localTimeZone}.`)

  return lines.join('\n')
}

function getEventDate(event: GoogleCalendarEvent): string | null {
  if (event.start?.date) return event.start.date
  if (event.start?.dateTime) return event.start.dateTime.slice(0, 10)
  return null
}

function formatDateLabel(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'EEE MMM d')
  } catch {
    return dateStr
  }
}

function formatEventLine(event: GoogleCalendarEvent): string {
  const parts: string[] = []

  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime)
  if (isAllDay) {
    parts.push('  (all day)')
  } else {
    const startTime = event.start?.dateTime?.slice(11, 16) ?? '??:??'
    const endTime = event.end?.dateTime?.slice(11, 16)
    parts.push(endTime ? `  ${startTime}–${endTime}` : `  ${startTime}`)
  }

  parts.push(` ${event.summary ?? '(untitled)'}`)
  parts.push(` · ${event.calendarName}`)

  if (event.location) {
    parts.push(` · ${event.location}`)
  }

  const attendees = (event.attendees ?? [])
    .filter((a): a is { email: string; displayName?: string } => Boolean(a.email))
    .slice(0, 20)
  if (attendees.length > 0) {
    const total = event.attendees?.length ?? 0
    const remaining = total - attendees.length
    const labels = attendees.map((a) =>
      a.displayName && a.displayName !== a.email
        ? `${a.displayName} <${a.email}>`
        : a.email,
    )
    const suffix = remaining > 0 ? `, +${remaining} more` : ''
    parts.push(` · ${labels.join(', ')}${suffix}`)
  }

  return `-${parts.join('')}`
}
