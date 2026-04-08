import { format, parseISO } from "date-fns";
import type { ExecutionMode, FactRecord } from "@/lib/contracts";
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from "@/lib/server/google-calendar";

export function buildChatSystemPrompt(params: {
  calendars: GoogleCalendarListEntry[];
  executionMode: ExecutionMode;
  facts: FactRecord[];
  localTimeZone: string;
  nearTermEvents: GoogleCalendarEvent[];
  signedIn: boolean;
}): string {
  const { calendars, executionMode, facts, localTimeZone, nearTermEvents, signedIn } = params;

  const sections: string[] = [
    buildInstructions(executionMode, signedIn),
    buildCalendarsSection(calendars),
    buildMemorySection(facts),
    buildScheduleSection(nearTermEvents, localTimeZone),
  ];

  return sections.filter(Boolean).join("\n\n");
}

function buildInstructions(executionMode: ExecutionMode, signedIn: boolean): string {
  const lines = [
    "You are GCalthing, a friendly Google Calendar assistant.",
    "",
    "## Core Principle",
    "Act first, ask later. Resolve missing information using your tools and context before asking the user anything. Never offer to do something you can do yourself — just do it in the same turn.",
    "",
    "## Resolving Missing Info",
    "Follow this order — move to the next step only if the previous one fails:",
    "1. Check the current message and any pasted/forwarded content",
    "2. Check saved memory (facts listed below)",
    "3. Check nearby events in the schedule context below",
    "4. Call search_events to look through calendar history",
    "5. Only then ask the user — and ask only about the unresolved pieces",
    "",
    "## Tool Usage",
    "- Use search_events for events outside the schedule window, or to find attendee emails and event patterns.",
    "- Use check_availability before suggesting meeting times.",
    "- Use manage_facts to save useful info (emails, preferences, patterns) that should persist across conversations. Remove facts when they become outdated.",
    "",
    "## Attendee Emails",
    "- Only include an attendee when their exact email is confirmed from: the user's message, pasted content, saved facts, or calendar event data showing that same person/email pair.",
    "- Never guess an email from a name, domain, or conversational context.",
    "- Always include the signed-in user in the attendee list for create/update calls.",
    "",
    "## Writes",
    "- Required fields for create/update: title, date, startTime (or allDay: true), and calendarId. Default to the primary calendar if unsure.",
    "- Only call create_event, update_event, or delete_event when the request is fully specified and unambiguous.",
    "- Do not copy pasted source content into descriptions unless explicitly asked.",
    executionMode === "approval-first"
      ? "- Execution mode is approval-first. When a write is fully specified, call the tool — the UI will handle approval before it runs."
      : "- Execution mode is direct-execution. Complete, unambiguous write requests run immediately. Ask first if anything is unclear.",
    "",
    "## Presenting Results",
    "- When listing people (attendees, organizers), always show names, not raw emails. If an attendee only appears as an email address, use search_events to find prior events involving that email — the attendee list there often has a display name.",
    "- Do all resolution work before replying. Never say \"I can also...\" or \"If you want, I can...\" for something you have the tools to do right now.",
    "",
    "## Style",
    "Format responses in markdown: use **bold** for emphasis, bullet lists for multiple items, and headers for structured responses. Be warm, helpful, and concise. Lead with what matters.",
    signedIn
      ? "- Google Calendar tools are available."
      : "- The user is signed out. Calendar tools will report that Google sign-in is required.",
  ];

  return lines.join("\n");
}

function buildCalendarsSection(calendars: GoogleCalendarListEntry[]): string {
  if (calendars.length === 0) return "";

  const lines = ["## Your Calendars"];
  for (const cal of calendars) {
    const primary = cal.primary ? " (primary)" : "";
    const tz = cal.timeZone ? ` — ${cal.timeZone}` : "";
    lines.push(`- ${cal.summary}${primary} [${cal.id}]${tz}`);
  }
  return lines.join("\n");
}

function buildMemorySection(facts: FactRecord[]): string {
  if (facts.length === 0) {
    return "## Your Memory\nNo saved facts yet. Use manage_facts to remember things.";
  }

  const lines = ["## Your Memory"];
  for (const fact of facts.slice(0, 30)) {
    const date = fact.addedAt.slice(0, 10);
    lines.push(`- [${fact.id}] ${fact.fact} (${date})`);
  }
  return lines.join("\n");
}

function buildScheduleSection(events: GoogleCalendarEvent[], localTimeZone: string): string {
  if (events.length === 0) return "";

  const byDate = new Map<string, GoogleCalendarEvent[]>();
  for (const event of events) {
    const date = getEventDate(event);
    if (!date) continue;
    const bucket = byDate.get(date) ?? [];
    bucket.push(event);
    byDate.set(date, bucket);
  }

  const sortedDates = [...byDate.keys()].sort();
  if (sortedDates.length === 0) return "";

  const first = sortedDates[0]!;
  const last = sortedDates[sortedDates.length - 1]!;
  const rangeLabel = `${formatDateLabel(first)} – ${formatDateLabel(last)}`;

  const lines = [`## Schedule (${rangeLabel})`];

  for (const date of sortedDates) {
    lines.push(`### ${formatDateLabel(date)}`);
    for (const event of byDate.get(date)!) {
      lines.push(formatEventLine(event));
    }
  }

  const today = new Date();
  const todayStr = format(today, "EEEE, MMMM d, yyyy");
  lines.push("");
  lines.push(`For events outside this window, use search_events.`);
  lines.push(`Today is ${todayStr}. Timezone: ${localTimeZone}.`);

  return lines.join("\n");
}

function getEventDate(event: GoogleCalendarEvent): string | null {
  if (event.start?.date) return event.start.date;
  if (event.start?.dateTime) return event.start.dateTime.slice(0, 10);
  return null;
}

function formatDateLabel(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "EEE MMM d");
  } catch {
    return dateStr;
  }
}

function formatEventLine(event: GoogleCalendarEvent): string {
  const parts: string[] = [];

  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
  if (isAllDay) {
    parts.push("  (all day)");
  } else {
    const startTime = event.start?.dateTime?.slice(11, 16) ?? "??:??";
    const endTime = event.end?.dateTime?.slice(11, 16);
    parts.push(endTime ? `  ${startTime}–${endTime}` : `  ${startTime}`);
  }

  parts.push(` ${event.summary ?? "(untitled)"}`);
  parts.push(` · ${event.calendarName}`);

  if (event.location) {
    parts.push(` · ${event.location}`);
  }

  const attendees = (event.attendees ?? [])
    .filter((a): a is typeof a & { email: string } => Boolean(a.email))
    .slice(0, 20);
  if (attendees.length > 0) {
    const total = event.attendees?.length ?? 0;
    const remaining = total - attendees.length;
    const labels = attendees.map((a) => {
      const name =
        a.displayName && a.displayName !== a.email ? `${a.displayName} <${a.email}>` : a.email;
      const rsvp =
        a.responseStatus && a.responseStatus !== "needsAction" ? ` (${a.responseStatus})` : "";
      return `${name}${rsvp}`;
    });
    const suffix = remaining > 0 ? `, +${remaining} more` : "";
    parts.push(` · ${labels.join(", ")}${suffix}`);
  }

  const organizer = event.organizer;
  if (organizer?.email) {
    const organizerLabel =
      organizer.displayName && organizer.displayName !== organizer.email
        ? `${organizer.displayName} <${organizer.email}>`
        : organizer.email;
    parts.push(` · organizer: ${organizerLabel}`);
  }

  return `-${parts.join("")}`;
}
