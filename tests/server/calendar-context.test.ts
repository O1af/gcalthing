import { describe, expect, it } from 'vitest'
import {
  detectExistingEventMatches,
  resolveAttendeeGroups,
  suggestCalendars,
  summarizeCalendarContext,
} from '@/lib/server/calendar-context'
import { emptyFactsContext } from '@/lib/contracts'

const calendars = [
  {
    accessRole: 'owner',
    id: 'primary',
    primary: true,
    summary: 'Primary',
    timeZone: 'America/Detroit',
  },
  {
    accessRole: 'writer',
    id: 'team',
    primary: false,
    summary: 'Team',
    timeZone: 'America/Detroit',
  },
]

const recentEvents = [
  {
    attendees: [{ displayName: 'Sarah Kim', email: 'sarah@example.com' }],
    calendarId: 'primary',
    calendarName: 'Primary',
    id: 'evt-1',
    location: 'Frita Batidos',
    start: { dateTime: '2026-03-29T17:00:00-04:00' },
    end: { dateTime: '2026-03-29T18:00:00-04:00' },
    summary: 'Meet Sarah at Frita Batidos',
  },
  {
    attendees: [{ displayName: 'Design Team', email: 'design@example.com' }],
    calendarId: 'team',
    calendarName: 'Team',
    id: 'evt-2',
    location: 'Studio A',
    start: { dateTime: '2026-03-28T13:00:00-04:00' },
    end: { dateTime: '2026-03-28T14:00:00-04:00' },
    summary: 'Design review',
  },
]

describe('calendar context heuristics', () => {
  it('summarizes recent titles, locations, and attendee directory', () => {
    const summary = summarizeCalendarContext(calendars, recentEvents)

    expect(summary.recentTitles[0]?.title).toBe('Meet Sarah at Frita Batidos')
    expect(summary.frequentLocations[0]?.location).toBe('Frita Batidos')
    expect(summary.attendeeDirectory[0]?.email).toBe('sarah@example.com')
  })

  it('resolves attendees and prefers the strongest calendar suggestion', () => {
    const intent = {
      allDay: false,
      attendeeMentions: [{ email: null, name: 'Sarah', optional: false }],
      calendarId: null,
      date: '2026-03-31',
      description: null,
      durationMinutes: 60,
      endDate: '2026-03-31',
      endTime: '18:00',
      location: 'Frita Batidos',
      recurrenceRule: null,
      startTime: '17:00',
      timezone: 'America/Detroit',
      title: 'Meet Sarah at Frita Batidos',
    }

    const attendees = resolveAttendeeGroups(intent, recentEvents, emptyFactsContext)
    const suggestions = suggestCalendars(
      intent,
      calendars,
      recentEvents,
      emptyFactsContext,
      attendees,
    )

    expect(attendees[0]?.candidates[0]?.email).toBe('sarah@example.com')
    expect(attendees[0]?.candidates[0]?.confidence).toBeGreaterThan(0.8)
    expect(suggestions[0]?.calendarId).toBe('primary')
  })

  it('flags a likely duplicate when a similar event exists on the same day', () => {
    const duplicateCandidate = {
      allDay: false,
      attendeeMentions: [],
      calendarId: null,
      date: '2026-03-29',
      description: null,
      durationMinutes: 60,
      endDate: '2026-03-29',
      endTime: '18:00',
      location: null,
      recurrenceRule: null,
      startTime: '17:00',
      timezone: 'America/Detroit',
      title: 'Meet Sarah at Frita Batidos',
    }

    const duplicates = detectExistingEventMatches(duplicateCandidate, recentEvents, calendars)

    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.calendarId).toBe('primary')
    expect(duplicates[0]?.score).toBeGreaterThan(0.8)
  })
})
