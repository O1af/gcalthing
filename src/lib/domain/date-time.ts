export function deriveEndTime(startTime: string, minutes: number) {
  const [hours, mins] = startTime.split(':').map(Number)
  const totalMinutes = hours * 60 + mins + minutes
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const endHours = Math.floor(normalized / 60)
  const endMinutes = normalized % 60
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`
}

export function formatRfc3339InTimeZone(
  date: string,
  time: string,
  timeZone: string,
) {
  const utcGuess = new Date(`${date}T${time}:00Z`)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  })
  const zoneName =
    formatter
      .formatToParts(utcGuess)
      .find((part) => part.type === 'timeZoneName')
      ?.value ?? 'GMT'

  const offset = normalizeOffset(zoneName)
  return `${date}T${time}:00${offset}`
}

export function getDurationMinutes(event: {
  end?: { dateTime?: string }
  start?: { dateTime?: string }
}) {
  const start = event.start?.dateTime ? new Date(event.start.dateTime) : null
  const end = event.end?.dateTime ? new Date(event.end.dateTime) : null
  if (!start || !end) {
    return null
  }

  return Math.max(Math.round((end.getTime() - start.getTime()) / 60000), 1)
}

function normalizeOffset(zoneName: string) {
  if (zoneName === 'GMT' || zoneName === 'UTC') {
    return 'Z'
  }

  const match = zoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
  if (!match) {
    return 'Z'
  }

  const [, sign, hours, minutes] = match
  return `${sign}${hours.padStart(2, '0')}:${(minutes ?? '00').padStart(2, '0')}`
}
