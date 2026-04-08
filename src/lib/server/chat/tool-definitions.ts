import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import {
  attendeeInputSchema,
  checkAvailabilityToolOutputSchema,
  manageFactsToolOutputSchema,
  searchEventsToolOutputSchema,
  writeCalendarToolOutputSchema,
  type ExecutionMode,
  type FactRecord,
} from "@/lib/contracts";
import { deriveEndTime, formatRfc3339InTimeZone, getDurationMinutes } from "@/lib/domain/date-time";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "@/lib/server/google-calendar";
import type { SessionContext } from "./index";
import {
  buildWriteEventRequest,
  submitCreateEvent,
  submitUpdateEvent,
  withSession,
} from "./chat-helpers";

const eventInputSchema = z.object({
  allDay: z.boolean().optional(),
  attendees: z.array(attendeeInputSchema).optional(),
  calendarId: z.string().trim().nullable().optional(),
  date: z.string().trim().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  endTime: z.string().trim().nullable().optional(),
  location: z.string().trim().nullable().optional(),
  recurrenceRule: z.string().trim().nullable().optional(),
  startTime: z.string().trim().nullable().optional(),
  timezone: z.string().trim().nullable().optional(),
  title: z.string().trim().nullable().optional(),
});

const searchEventsInputSchema = z.object({
  calendarIds: z.array(z.string()).max(10).optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  limit: z.number().int().min(1).max(20).default(10),
  query: z.string().trim().max(120).optional(),
});

const checkAvailabilityInputSchema = z.object({
  calendarIds: z.array(z.string()).max(10).optional(),
  date: z.string().min(1),
  durationMinutes: z.number().int().positive().max(720).optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().optional(),
});

const updateEventInputSchema = eventInputSchema.extend({
  calendarId: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
});

const deleteEventInputSchema = z.object({
  calendarId: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  title: z.string().trim().optional(),
  when: z.string().trim().optional(),
});

const manageFactsInputSchema = z.object({
  action: z.enum(["add", "remove"]),
  fact: z.string().min(1).optional().describe("The fact to remember (required for add)"),
  id: z.string().min(1).optional().describe("The id of the fact to remove (required for remove)"),
});

export interface CalendarAgentContext {
  calendars: GoogleCalendarListEntry[];
  executionMode: ExecutionMode;
  facts: FactRecord[];
  localTimeZone: string;
  nearTermEvents: GoogleCalendarEvent[];
  session: SessionContext | null;
}

type WriteToolResult = z.infer<typeof writeCalendarToolOutputSchema>;

export function createCalendarToolSet(writeNeedsApproval: boolean) {
  return {
    search_events: tool({
      description:
        "Search Google Calendar events by text query, date range, and optional calendar IDs. Use this both for finding events and for resolving attendee details from prior calendar history. Returns full event details (attendees with RSVP, description, organizer, links) when 5 or fewer events match. When more than 5 match, returns summaries only — narrow the query or date range to get full details.",
      inputSchema: searchEventsInputSchema,
      outputSchema: searchEventsToolOutputSchema,
      execute: async ({ calendarIds, dateFrom, dateTo, limit, query }, options) => {
        const context = getCalendarAgentContext(options);
        return withSession(
          context.session,
          "Sign in with Google to search your calendar events.",
          async (session) => {
            const { searchGoogleCalendarEvents } = await import("@/lib/server/google-calendar");
            const events = await searchGoogleCalendarEvents({
              accessToken: session.tokens.accessToken,
              calendarIds,
              calendars: context.calendars,
              limit,
              query,
              timeMax: dateTo
                ? formatRfc3339InTimeZone(dateTo, "23:59", context.localTimeZone)
                : undefined,
              timeMin: dateFrom
                ? formatRfc3339InTimeZone(dateFrom, "00:00", context.localTimeZone)
                : undefined,
            });

            const hasFullDetails = events.length <= 5;

            let detail = events.length > 0
              ? `Found ${events.length} matching event${events.length === 1 ? "" : "s"}.`
              : "No matching events were found.";
            if (events.length > 5) {
              detail += " Narrow your search to see full details (attendees, description, links).";
            }

            return {
              detail,
              events: events.map((event) => ({
                attendees: hasFullDetails
                  ? (event.attendees ?? []).slice(0, 100).map((a) => ({
                      comment: a.comment ?? undefined,
                      displayName: a.displayName ?? undefined,
                      email: a.email ?? undefined,
                      optional: a.optional ?? undefined,
                      organizer: a.organizer ?? undefined,
                      responseStatus: a.responseStatus ?? undefined,
                      self: a.self ?? undefined,
                    }))
                  : [],
                calendarId: event.calendarId,
                calendarName: event.calendarName,
                description: hasFullDetails ? (event.description ?? null) : null,
                end: event.end ?? null,
                hangoutLink: hasFullDetails ? (event.hangoutLink ?? null) : null,
                htmlLink: hasFullDetails ? (event.htmlLink ?? null) : null,
                id: event.id,
                location: event.location ?? null,
                organizer: hasFullDetails ? (event.organizer ?? null) : null,
                start: event.start ?? null,
                summary: event.summary ?? "(untitled)",
              })),
              hasFullDetails,
              status: "ok" as const,
            };
          },
        );
      },
    }),
    check_availability: tool({
      description: "Check Google Calendar availability for a given date/time window.",
      inputSchema: checkAvailabilityInputSchema,
      outputSchema: checkAvailabilityToolOutputSchema,
      execute: async (
        { calendarIds, date, durationMinutes, endTime, startTime, timezone },
        options,
      ) => {
        const context = getCalendarAgentContext(options);
        return withSession(
          context.session,
          "Sign in with Google to check calendar availability.",
          async (session) => {
            const { queryFreeBusy } = await import("@/lib/server/google-calendar");
            const targetCalendarIds =
              calendarIds && calendarIds.length > 0
                ? calendarIds
                : context.calendars.slice(0, 5).map((c) => c.id);
            const resolvedTimeZone = timezone ?? context.localTimeZone;
            const resolvedEndTime = endTime ?? deriveEndTime(startTime, durationMinutes ?? 60);
            const timeMin = formatRfc3339InTimeZone(date, startTime, resolvedTimeZone);
            const timeMax = formatRfc3339InTimeZone(date, resolvedEndTime, resolvedTimeZone);
            const busy = await queryFreeBusy(
              session.tokens.accessToken,
              targetCalendarIds,
              timeMin,
              timeMax,
            );

            return {
              calendars: targetCalendarIds.map((calId) => ({
                busy: busy[calId]?.busy ?? [],
                calendarId: calId,
                calendarName: context.calendars.find((c) => c.id === calId)?.summary ?? calId,
              })),
              detail: `Checked availability across ${targetCalendarIds.length} calendar${targetCalendarIds.length === 1 ? "" : "s"} from ${startTime} to ${resolvedEndTime} on ${date}.`,
              status: "ok" as const,
              timeMax,
              timeMin,
              timezone: resolvedTimeZone,
            };
          },
        );
      },
    }),
    create_event: tool({
      description:
        "Create a Google Calendar event. Provide title, date, startTime (or allDay), calendarId, and optionally attendees, location, duration, description, recurrence.",
      inputSchema: eventInputSchema,
      needsApproval: writeNeedsApproval,
      outputSchema: writeCalendarToolOutputSchema,
      execute: async (eventInput, options): Promise<WriteToolResult> => {
        const context = getCalendarAgentContext(options);
        return withSession(
          context.session,
          "Sign in with Google before creating events.",
          async (session) => {
            const { validateRequiredFields } = await import("./chat-helpers");
            const missing = validateRequiredFields(eventInput);
            if (missing.length > 0) {
              return {
                detail: `Missing required fields: ${missing.join(", ")}. Ask the user for these details.`,
                status: "needs-input" as const,
              };
            }

            const request = buildWriteEventRequest(
              eventInput as Record<string, unknown>,
              context.localTimeZone,
            );

            return submitCreateEvent({ calendars: context.calendars, request, session });
          },
        );
      },
    }),
    update_event: tool({
      description:
        "Update or reschedule an existing Google Calendar event. Provide calendarId, eventId, and the fields to change. Unchanged fields are preserved from the existing event.",
      inputSchema: updateEventInputSchema,
      needsApproval: writeNeedsApproval,
      outputSchema: writeCalendarToolOutputSchema,
      execute: async (
        { calendarId, eventId, ...eventInput },
        options,
      ): Promise<WriteToolResult> => {
        const context = getCalendarAgentContext(options);
        return withSession(
          context.session,
          "Sign in with Google before updating events.",
          async (session) => {
            const { getGoogleCalendarEvent } = await import("@/lib/server/google-calendar");
            const calendarName =
              context.calendars.find((c) => c.id === calendarId)?.summary ?? calendarId;
            const current = await getGoogleCalendarEvent(
              session.tokens.accessToken,
              calendarId,
              calendarName,
              eventId,
            );

            const isAllDay =
              eventInput.allDay ?? Boolean(current.start?.date && !current.start?.dateTime);
            const merged = {
              title: eventInput.title ?? current.summary ?? "",
              date:
                eventInput.date ??
                current.start?.date ??
                current.start?.dateTime?.slice(0, 10) ??
                "",
              startTime: eventInput.startTime ?? current.start?.dateTime?.slice(11, 16) ?? null,
              endTime: eventInput.endTime ?? current.end?.dateTime?.slice(11, 16) ?? null,
              durationMinutes: eventInput.durationMinutes ?? getDurationMinutes(current) ?? null,
              allDay: isAllDay,
              timezone: eventInput.timezone ?? current.start?.timeZone ?? context.localTimeZone,
              location: eventInput.location ?? current.location ?? null,
              description: eventInput.description ?? current.description ?? null,
              recurrenceRule: eventInput.recurrenceRule ?? null,
              calendarId,
              attendees:
                eventInput.attendees ??
                (current.attendees ?? [])
                  .filter((a): a is { email: string; displayName?: string } => Boolean(a.email))
                  .map((a) => ({ email: a.email, name: a.displayName ?? a.email })),
            };

            const { validateRequiredFields } = await import("./chat-helpers");
            const missing = validateRequiredFields(merged);
            if (missing.length > 0) {
              return {
                detail: `Missing required fields after merge: ${missing.join(", ")}.`,
                status: "needs-input" as const,
              };
            }

            const request = buildWriteEventRequest(
              merged as Record<string, unknown>,
              context.localTimeZone,
            );

            return submitUpdateEvent({ calendars: context.calendars, calendarId, eventId, request, session });
          },
        );
      },
    }),
    delete_event: tool({
      description: "Delete a specific Google Calendar event by calendar id and event id.",
      inputSchema: deleteEventInputSchema,
      needsApproval: writeNeedsApproval,
      outputSchema: writeCalendarToolOutputSchema,
      execute: async ({ calendarId, eventId, title }, options): Promise<WriteToolResult> => {
        const context = getCalendarAgentContext(options);
        return withSession(
          context.session,
          "Sign in with Google before deleting events.",
          async (session) => {
            const { deleteGoogleCalendarEvent } = await import("@/lib/server/google-calendar");
            const deletion = await deleteGoogleCalendarEvent(
              session.tokens.accessToken,
              calendarId,
              eventId,
            );

            return {
              actionPerformed: deletion.actionPerformed,
              calendarId: deletion.calendarId,
              detail: `Deleted ${title?.trim() || "the selected event"} from Google Calendar.`,
              eventId: deletion.eventId,
              htmlLink: deletion.htmlLink,
              sendUpdates: deletion.sendUpdates,
              status: "ok" as const,
            };
          },
        );
      },
    }),
    manage_facts: tool({
      description:
        "Add or remove a fact from your long-term memory. You decide what is worth remembering. " +
        "Facts persist across conversations and appear in your system context. " +
        "Proactively save useful information (names, emails, preferences, patterns). " +
        "Remove facts that are outdated or contradicted by new information.",
      inputSchema: manageFactsInputSchema,
      outputSchema: manageFactsToolOutputSchema,
      execute: async ({ action, fact, id }, options) => {
        const context = getCalendarAgentContext(options);
        return withSession(context.session, "Sign in to manage facts.", async (session) => {
          const { addFact, removeFact } = await import("@/lib/server/facts");

          if (action === "add") {
            if (!fact) {
              return {
                detail: "A fact string is required when adding.",
                status: "ok" as const,
              };
            }
            const record = await addFact(session.profile.sub, fact);
            return {
              detail: `Saved fact: "${fact}" (id: ${record.id})`,
              status: "ok" as const,
            };
          }

          if (!id) {
            return {
              detail: "A fact id is required when removing.",
              status: "ok" as const,
            };
          }
          const removed = await removeFact(session.profile.sub, id);
          return {
            detail: removed ? `Removed fact ${id}.` : `No fact found with id ${id}.`,
            status: "ok" as const,
          };
        });
      },
    }),
  };
}

function getCalendarAgentContext(options: ToolExecutionOptions): CalendarAgentContext {
  return options.experimental_context as CalendarAgentContext;
}
