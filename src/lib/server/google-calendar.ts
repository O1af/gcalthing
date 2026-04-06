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

  return perCalendar.flat().sort(compareGoogleCalendarEvents).slice(0, limit);
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
