import { addDays, subDays } from "date-fns";
import type { WriteEventRequest } from "@/lib/contracts";
import { deriveEndTime } from "@/lib/domain/date-time";

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
  timeZone?: string;
}

export interface GoogleEventAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  organizer?: boolean;
  optional?: boolean;
  comment?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  recurringEventId?: string;
  recurrence?: string[];
  status?: string;
  created?: string;
  updated?: string;
  visibility?: string;
  attendees?: GoogleEventAttendee[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  creator?: { email?: string; displayName?: string; self?: boolean };
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  calendarId: string;
  calendarName: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string; label?: string }>;
  };
}

export async function listWritableCalendars(accessToken: string) {
  const response = await googleFetch<{
    items?: GoogleCalendarListEntry[];
  }>("https://www.googleapis.com/calendar/v3/users/me/calendarList", accessToken);

  return (response.items ?? []).filter((calendar) =>
    ["owner", "writer"].includes(calendar.accessRole),
  );
}

export async function loadNearTermEvents(
  accessToken: string,
  calendars: GoogleCalendarListEntry[],
): Promise<GoogleCalendarEvent[]> {
  const now = new Date();
  const timeMin = subDays(now, 7).toISOString();
  const timeMax = addDays(now, 7).toISOString();

  const perCalendar = await Promise.all(
    calendars.slice(0, 10).map(async (calendar) => {
      const search = new URLSearchParams({
        maxResults: "25",
        orderBy: "startTime",
        singleEvents: "true",
        timeMax,
        timeMin,
      });

      const response = await googleFetch<{ items?: GoogleCalendarEvent[] }>(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${search.toString()}`,
        accessToken,
      );

      return enrichCalendarEvents(response.items ?? [], calendar);
    }),
  );

  return perCalendar.flat().sort(compareGoogleCalendarEvents).slice(0, 150);
}

export async function searchGoogleCalendarEvents(params: {
  accessToken: string;
  calendarIds?: string[];
  calendars: GoogleCalendarListEntry[];
  limit?: number;
  query?: string;
  timeMax?: string;
  timeMin?: string;
}) {
  const { accessToken, calendarIds, calendars, limit = 20, query, timeMax, timeMin } = params;
  const targetCalendars = selectTargetCalendars(calendars, calendarIds);
  const perCalendar = await Promise.all(
    targetCalendars.map(async (calendar) => {
      const search = new URLSearchParams({
        maxResults: String(Math.max(Math.min(limit, 50), 1)),
        orderBy: "startTime",
        singleEvents: "true",
      });

      if (query?.trim()) {
        search.set("q", query.trim());
      }
      if (timeMin) {
        search.set("timeMin", timeMin);
      }
      if (timeMax) {
        search.set("timeMax", timeMax);
      }

      const response = await googleFetch<{ items?: GoogleCalendarEvent[] }>(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${search.toString()}`,
        accessToken,
      );

      return enrichCalendarEvents(response.items ?? [], calendar);
    }),
  );

  const events = perCalendar.flat().sort(compareGoogleCalendarEvents).slice(0, limit);
  return enrichEventsWithAttendeeNames(accessToken, events);
}

export async function getGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  calendarName: string,
  eventId: string,
) {
  const event = await googleFetch<GoogleCalendarEvent>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
  );

  return {
    ...event,
    calendarId,
    calendarName,
  };
}

export async function queryFreeBusy(
  accessToken: string,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
) {
  const response = await googleFetch<{
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  }>("https://www.googleapis.com/calendar/v3/freeBusy", accessToken, {
    method: "POST",
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: calendarIds.map((id) => ({ id })),
    }),
  });

  return response.calendars ?? {};
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  request: WriteEventRequest,
  calendarNameById: Map<string, string>,
) {
  return saveGoogleCalendarEvent({
    accessToken,
    actionPerformed: "created",
    calendarId: request.calendarId,
    calendarNameById,
    method: "POST",
    request,
  });
}

export async function updateGoogleCalendarEvent(
  accessToken: string,
  eventId: string,
  calendarId: string,
  request: WriteEventRequest,
  calendarNameById: Map<string, string>,
) {
  return saveGoogleCalendarEvent({
    accessToken,
    actionPerformed: "updated",
    calendarId,
    calendarNameById,
    eventId,
    method: "PATCH",
    request,
  });
}

export async function deleteGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
) {
  await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    accessToken,
    {
      method: "DELETE",
    },
  );

  return {
    actionPerformed: "deleted" as const,
    calendarId,
    eventId,
    htmlLink: null,
    sendUpdates: true,
  };
}

function buildGoogleEventPayload(request: WriteEventRequest) {
  const descriptionParts = [request.description?.trim()];

  if (request.appendSourceDetails && request.sourceInputs.length > 0) {
    descriptionParts.push("", "Source details", ...request.sourceInputs.map(formatSourceInput));
  }

  const attendees = request.attendees.map((a) => ({
    displayName: a.name,
    email: a.email,
  }));

  const recurrence = request.recurrenceRule
    ? [
        request.recurrenceRule.startsWith("RRULE:")
          ? request.recurrenceRule
          : `RRULE:${request.recurrenceRule}`,
      ]
    : undefined;

  if (request.allDay && request.date) {
    const endDate = request.date;
    return {
      attendees,
      description: descriptionParts.filter(Boolean).join("\n"),
      end: { date: endDate },
      location: request.location ?? undefined,
      recurrence,
      start: { date: request.date },
      summary: request.title || "Untitled event",
    };
  }

  if (!request.date || !request.startTime) {
    throw new Error("A start date and start time are required to create the event");
  }

  const endTime = request.endTime ?? deriveEndTime(request.startTime, request.durationMinutes ?? 60);
  const endDate = request.date;

  return {
    attendees,
    description: descriptionParts.filter(Boolean).join("\n"),
    end: {
      dateTime: `${endDate}T${endTime}:00`,
      timeZone: request.timezone ?? "UTC",
    },
    location: request.location ?? undefined,
    recurrence,
    start: {
      dateTime: `${request.date}T${request.startTime}:00`,
      timeZone: request.timezone ?? "UTC",
    },
    summary: request.title || "Untitled event",
  };
}

function formatSourceInput(input: WriteEventRequest["sourceInputs"][number]) {
  if (input.kind === "text") {
    return `- ${input.label}: ${input.text.slice(0, 300)}`;
  }

  return `- ${input.label}: ${input.filename ?? input.mediaType}`;
}

async function saveGoogleCalendarEvent(params: {
  accessToken: string;
  actionPerformed: "created" | "updated";
  calendarId: string;
  calendarNameById: Map<string, string>;
  eventId?: string;
  method: "POST" | "PATCH";
  request: WriteEventRequest;
}) {
  const { accessToken, actionPerformed, calendarId, calendarNameById, eventId, method, request } =
    params;
  const eventBody = buildGoogleEventPayload(request);
  const sendUpdates = request.attendees.length > 0;
  const path = eventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  const response = await googleFetch<{
    id: string;
    htmlLink: string;
  }>(`${path}?conferenceDataVersion=1&sendUpdates=${sendUpdates ? "all" : "none"}`, accessToken, {
    method,
    body: JSON.stringify(eventBody),
  });

  return {
    actionPerformed,
    calendarId,
    calendarName: calendarNameById.get(calendarId) ?? calendarId,
    eventId: response.id,
    htmlLink: response.htmlLink,
    sendUpdates,
  };
}

function enrichCalendarEvents(items: GoogleCalendarEvent[], calendar: GoogleCalendarListEntry) {
  return items
    .filter((event) => event.status !== "cancelled")
    .map((event) => ({
      ...event,
      calendarId: calendar.id,
      calendarName: calendar.summary,
    }));
}

async function enrichEventsWithAttendeeNames(
  accessToken: string,
  events: GoogleCalendarEvent[],
): Promise<GoogleCalendarEvent[]> {
  const emailsToResolve = new Set<string>();
  for (const event of events) {
    for (const attendee of event.attendees ?? []) {
      if (attendee.email && !attendee.displayName) {
        emailsToResolve.add(attendee.email);
      }
    }
  }

  if (emailsToResolve.size === 0) return events;

  const nameMap = await resolveAttendeeNames(accessToken, [...emailsToResolve]);
  if (nameMap.size === 0) return events;

  return events.map((event) => ({
    ...event,
    attendees: event.attendees?.map((a) => ({
      ...a,
      displayName: a.displayName ?? (a.email ? nameMap.get(a.email.toLowerCase()) : undefined),
    })),
  }));
}

export async function resolveAttendeeNames(
  accessToken: string,
  emails: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (emails.length === 0) return result;

  const normalizedEmails = emails.map((e) => e.toLowerCase());

  // Phase 1: fetch all other contacts in one call and match client-side.
  try {
    const params = new URLSearchParams({ pageSize: "1000", readMask: "names,emailAddresses" });
    const response = await fetch(
      `https://people.googleapis.com/v1/otherContacts?${params}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );

    if (response.ok) {
      const data = (await response.json()) as {
        otherContacts?: Array<{
          names?: Array<{ displayName?: string }>;
          emailAddresses?: Array<{ value?: string }>;
        }>;
      };

      for (const person of data.otherContacts ?? []) {
        const name = person.names?.[0]?.displayName;
        if (!name) continue;
        for (const addr of person.emailAddresses ?? []) {
          if (addr.value) result.set(addr.value.toLowerCase(), name);
        }
      }
    }
  } catch {
    // Non-fatal — continue to per-email fallback.
  }

  // Phase 2: for any emails still unresolved, search individually (batched at 5).
  const unresolved = normalizedEmails.filter((e) => !result.has(e));
  if (unresolved.length === 0) return result;

  const BATCH = 5;
  for (let i = 0; i < unresolved.length; i += BATCH) {
    const batch = unresolved.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (email) => {
        try {
          const params = new URLSearchParams({ query: email, readMask: "names,emailAddresses" });
          const [otherRes, contactsRes] = await Promise.allSettled([
            fetch(`https://people.googleapis.com/v1/otherContacts:search?${params}`, {
              headers: { authorization: `Bearer ${accessToken}` },
            }),
            fetch(`https://people.googleapis.com/v1/people:searchContacts?${params}`, {
              headers: { authorization: `Bearer ${accessToken}` },
            }),
          ]);

          for (const settled of [otherRes, contactsRes]) {
            if (settled.status !== "fulfilled" || !settled.value.ok) continue;
            const data = (await settled.value.json()) as {
              results?: Array<{
                person?: {
                  names?: Array<{ displayName?: string }>;
                  emailAddresses?: Array<{ value?: string }>;
                };
              }>;
            };
            for (const item of data.results ?? []) {
              const name = item.person?.names?.[0]?.displayName;
              const personEmail = item.person?.emailAddresses?.[0]?.value;
              if (name && personEmail) result.set(personEmail.toLowerCase(), name);
            }
            if (result.has(email)) break;
          }
        } catch {
          // Non-fatal — fall back to email address display.
        }
      }),
    );
  }

  return result;
}

async function googleFetch<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google API request failed (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
}

function selectTargetCalendars(calendars: GoogleCalendarListEntry[], calendarIds?: string[]) {
  if (calendarIds && calendarIds.length > 0) {
    const requested = new Set(calendarIds);
    return calendars.filter((calendar) => requested.has(calendar.id)).slice(0, 10);
  }

  return calendars.slice(0, 5);
}

function compareGoogleCalendarEvents(left: GoogleCalendarEvent, right: GoogleCalendarEvent) {
  return getSortableEventStart(left).localeCompare(getSortableEventStart(right));
}

function getSortableEventStart(event: GoogleCalendarEvent) {
  return event.start?.dateTime ?? event.start?.date ?? "";
}
