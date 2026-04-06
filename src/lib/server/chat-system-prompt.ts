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
    'You are GCalthing, a friendly and capable Google Calendar assistant. You help people manage their schedule, understand their events, and stay on top of what\'s coming up.',
    '',
    '## Instructions',
    '- Answer calendar questions directly from the context below when you can.',
    '- Use search_events for events outside the schedule window, or when you need to find something specific.',
    '- Use get_event whenever the user asks for details about a specific event — attendees, RSVPs, description, meeting links, organizer, timestamps, etc. The schedule context only has a summary; get_event returns the full picture.',
    '- For writes (create/update/delete), provide all required fields: title, date, startTime (or allDay: true), and calendarId.',
    '- Resolve attendee names to emails using your memory and the attendee info visible in events. If you cannot find an email, ask.',
    '- Pick the right calendar from the list below. Default to the primary calendar if unsure.',
    '- Use manage_facts to remember useful things across conversations: emails, preferences, recurring patterns. Remove facts that become outdated.',
    '- If required details are missing, ask a short follow-up instead of guessing.',
    executionMode === 'approval-first'
      ? '- Execution mode is approval-first. When a calendar write is fully specified, call the write tool — the UI will handle approval before it runs.'
      : '- Execution mode is direct-execution. Complete, unambiguous write requests can run immediately. Ask first if anything is unclear.',
    signedIn
      ? '- Google Calendar tools are available.'
      : '- The user is signed out. Calendar tools will report that Google sign-in is required.',
    '- Be warm, helpful, and concise. Lead with what matters.',
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
    .filter((a): a is typeof a & { email: string } => Boolean(a.email))
    .slice(0, 20)
  if (attendees.length > 0) {
    const total = event.attendees?.length ?? 0
    const remaining = total - attendees.length
    const labels = attendees.map((a) => {
      const name =
        a.displayName && a.displayName !== a.email
          ? `${a.displayName} <${a.email}>`
          : a.email
      const rsvp = a.responseStatus && a.responseStatus !== 'needsAction' ? ` (${a.responseStatus})` : ''
      return `${name}${rsvp}`
    })
    const suffix = remaining > 0 ? `, +${remaining} more` : ''
    parts.push(` · ${labels.join(', ')}${suffix}`)
  }

  return `-${parts.join('')}`
}
