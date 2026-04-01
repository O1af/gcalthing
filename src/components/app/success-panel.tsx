'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { SubmitEventResponse } from '@/lib/contracts'

export function SuccessPanel({
  onReset,
  success,
}: {
  onReset: () => void
  success: SubmitEventResponse
}) {
  const factSummary = [
    ...success.factChangesApplied.created,
    ...success.factChangesApplied.updated,
    ...success.factChangesApplied.staled,
  ]

  return (
    <section className="mx-auto max-w-3xl">
      <Card className="rounded-[2rem]">
        <CardHeader>
          <Badge className="w-fit">Success</Badge>
          <CardTitle className="display-font text-5xl">
            Event {success.actionPerformed}.
          </CardTitle>
          <CardDescription className="text-base leading-7">
            The reviewed draft has been written to Google Calendar. Shared facts were
            updated after the successful write.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-[var(--secondary)] p-4">
              <p className="text-sm text-[var(--muted-foreground)]">Calendar</p>
              <p className="mt-1 font-medium">{success.calendarId}</p>
            </div>
            <div className="rounded-2xl bg-[var(--secondary)] p-4">
              <p className="text-sm text-[var(--muted-foreground)]">Notifications</p>
              <p className="mt-1 font-medium">
                {success.sendUpdates ? 'Sent to approved attendees' : 'No attendee updates sent'}
              </p>
            </div>
            <div className="rounded-2xl bg-[var(--secondary)] p-4">
              <p className="text-sm text-[var(--muted-foreground)]">Facts changed</p>
              <p className="mt-1 font-medium">{factSummary.length}</p>
            </div>
          </div>
          {factSummary.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Shared fact updates</p>
              <ul className="space-y-2 text-sm text-[var(--muted-foreground)]">
                {factSummary.map((change) => (
                  <li
                    key={`${change.action}:${change.kind}:${change.subject}:${change.nextValue ?? change.previousValue}`}
                    className="rounded-2xl bg-[var(--secondary)] p-3"
                  >
                    <span className="font-medium text-[var(--foreground)]">
                      {change.action}
                    </span>{' '}
                    {change.kind}: {change.subject}
                    {change.nextValue ? ` -> ${change.nextValue}` : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <a href={success.htmlLink} rel="noreferrer" target="_blank">
                Open In Google Calendar
              </a>
            </Button>
            <Button variant="outline" onClick={onReset}>
              Create Another Draft
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
