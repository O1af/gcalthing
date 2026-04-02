import type {
  DraftIntent,
  FactsContext,
  RefreshReviewDraftRequest,
  ReviewDraft,
} from "@/lib/contracts";
import { emptyFactsContext, existingEventMatchSchema, reviewDraftSchema } from "@/lib/contracts";
import { deriveEndTime, formatRfc3339InTimeZone, getDurationMinutes } from "@/lib/domain/date-time";
import { normalizeText, similarity } from "@/lib/domain/text";
import {
  CALENDAR_CONFIDENCE_GAP,
  CALENDAR_CONFIDENCE_THRESHOLD,
  SIMILARITY_MODERATE,
  SIMILARITY_STRICT,
} from "@/lib/server/similarity-thresholds";
import { logDebugError } from "@/lib/server/debug";
import {
  buildConflictCheckResult,
  buildReviewBlockers,
  buildSmartSignals,
  detectExistingEventMatches,
  resolveAttendeeGroups,
  suggestCalendars,
  summarizeCalendarContext,
} from "@/lib/server/calendar-context";
import { loadFactsContext } from "@/lib/server/facts";
import {
  listRecentEvents,
  listWritableCalendars,
  queryFreeBusy,
  type GoogleCalendarEvent,
  type GoogleCalendarListEntry,
} from "@/lib/server/google-calendar";

interface ExplicitUpdateTarget {
  calendarId: string;
  eventId: string;
  start?: string | null;
  title: string;
}

export async function buildSignedInReviewDraft(params: {
  accessToken: string;
  intent: DraftIntent;
  localTimeZone: string;
  previousDraft?: ReviewDraft | null;
  selectedUpdateTarget?: ExplicitUpdateTarget | null;
  userSub: string;
}) {
  const {
    accessToken,
    intent,
    localTimeZone,
    previousDraft = null,
    selectedUpdateTarget,
    userSub,
  } = params;
  const { calendars, factsContext, recentEvents } = await loadReviewContext(accessToken, userSub);

  return finalizeReviewDraft({
    accessToken,
    calendars,
    factsContext,
    intent,
    localTimeZone,
    previousDraft,
    recentEvents,
    selectedUpdateTarget: selectedUpdateTarget ?? null,
  });
}

export async function buildUnsignedReviewDraft(params: {
  intent: DraftIntent;
  localTimeZone: string;
  previousDraft?: ReviewDraft | null;
  selectedUpdateTarget?: ExplicitUpdateTarget | null;
}) {
  const { intent, localTimeZone, previousDraft = null, selectedUpdateTarget } = params;

  return finalizeReviewDraft({
    accessToken: null,
    calendars: [],
    factsContext: emptyFactsContext,
    intent,
    localTimeZone,
    previousDraft,
    recentEvents: [],
    selectedUpdateTarget: selectedUpdateTarget ?? null,
  });
}

export async function refreshSignedInReviewDraft(params: {
  accessToken: string;
  request: RefreshReviewDraftRequest;
  userSub: string;
}) {
  const { accessToken, request, userSub } = params;
  const intent = syncIntentWithEvent(request.draft.intent, request.draft.event);

  return buildSignedInReviewDraft({
    accessToken,
    intent,
    localTimeZone: request.localTimeZone,
    previousDraft: request.draft,
    selectedUpdateTarget: selectedUpdateTargetFromDraft(request.draft),
    userSub,
  });
}

export async function refreshUnsignedReviewDraft(params: { request: RefreshReviewDraftRequest }) {
  const { request } = params;
  const intent = syncIntentWithEvent(request.draft.intent, request.draft.event);

  return buildUnsignedReviewDraft({
    intent,
    localTimeZone: request.localTimeZone,
    previousDraft: request.draft,
    selectedUpdateTarget: selectedUpdateTargetFromDraft(request.draft),
  });
}

async function finalizeReviewDraft(params: {
  accessToken: string | null;
  calendars: GoogleCalendarListEntry[];
  factsContext: FactsContext;
  intent: DraftIntent;
  localTimeZone: string;
  previousDraft: ReviewDraft | null;
  recentEvents: GoogleCalendarEvent[];
  selectedUpdateTarget: ExplicitUpdateTarget | null;
}) {
  const {
    accessToken,
    calendars,
    factsContext,
    intent,
    localTimeZone,
    previousDraft,
    recentEvents,
    selectedUpdateTarget,
  } = params;

  const attendeeGroups = mergeAttendeeGroupState(
    resolveAttendeeGroups(intent, recentEvents, factsContext, previousDraft?.attendeeGroups ?? []),
    previousDraft?.attendeeGroups ?? [],
  );
  const calendarSuggestions = suggestCalendars(
    intent,
    calendars,
    recentEvents,
    factsContext,
    attendeeGroups,
  );
  const selectedCalendarId = pickCalendarId(calendars, calendarSuggestions, intent.calendarId);
  const event = buildEventFromIntent(
    intent,
    localTimeZone,
    selectedCalendarId,
    recentEvents,
    factsContext,
  );
  const normalizedIntent = syncIntentWithEvent(intent, event);
  const existingEventMatches = mergeSelectedUpdateTarget(
    detectExistingEventMatches(
      normalizedIntent,
      recentEvents,
      calendars,
      previousDraft?.existingEventMatches ?? [],
    ),
    selectedUpdateTarget,
  );
  const conflictCheck = await maybeRunConflictCheck({
    accessToken,
    calendars,
    calendarSuggestions,
    event,
  });
  const selectedMatch = selectExistingEventMatch(
    existingEventMatches,
    previousDraft,
    selectedUpdateTarget,
  );
  const proposedAction = selectedMatch
    ? {
        type: "update" as const,
        calendarId: selectedMatch.calendarId,
        eventId: selectedMatch.eventId,
      }
    : { type: "create" as const };

  const draft = {
    attendeeGroups,
    calendarContext: summarizeCalendarContext(calendars, recentEvents),
    calendarSuggestions,
    calendars: calendars.map((c) => ({
      id: c.id,
      summary: c.summary,
      primary: Boolean(c.primary),
      timeZone: c.timeZone ?? null,
      accessRole: c.accessRole,
    })),
    conflictCheck,
    event,
    existingEventMatches: existingEventMatches.map((match) => ({
      ...match,
      selected: selectedMatch?.eventId === match.eventId,
    })),
    factsContext,
    intent: normalizedIntent,
    proposedAction,
    reviewBlockers: [] as ReviewDraft["reviewBlockers"],
    smartSignals: [] as ReviewDraft["smartSignals"],
  };

  draft.reviewBlockers = buildReviewBlockers(draft);
  draft.smartSignals = buildSmartSignals(draft);
  appendFactsDrivenSuggestions(draft, recentEvents, factsContext);

  return reviewDraftSchema.parse(draft);
}

async function maybeRunConflictCheck(params: {
  accessToken: string | null;
  calendars: GoogleCalendarListEntry[];
  calendarSuggestions: ReviewDraft["calendarSuggestions"];
  event: ReviewDraft["event"];
}) {
  const { accessToken, calendars, calendarSuggestions, event } = params;
  if (!accessToken || !event.date || !event.startTime) {
    return buildConflictCheckResult([], []);
  }

  const checkedCalendarIds = [
    ...new Set([event.calendarId, ...calendarSuggestions.map((item) => item.calendarId)]),
  ].slice(0, 10);
  const timeMin = formatRfc3339InTimeZone(event.date, event.startTime, event.timezone ?? "UTC");
  const endTime = event.endTime ?? deriveEndTime(event.startTime, event.durationMinutes ?? 60);
  const timeMax = formatRfc3339InTimeZone(
    event.endDate ?? event.date,
    endTime,
    event.timezone ?? "UTC",
  );

  let busy;
  try {
    busy = await queryFreeBusy(accessToken, checkedCalendarIds, timeMin, timeMax);
  } catch (error) {
    logDebugError("review-draft", "freeBusyCheck:failed", error, {
      calendarCount: checkedCalendarIds.length,
      timeMax,
      timeMin,
      timeZone: event.timezone ?? "UTC",
    });
    return buildConflictCheckResult([], []);
  }

  const intervals = checkedCalendarIds.flatMap((calendarId) =>
    (busy[calendarId]?.busy ?? []).map((interval) => ({
      calendarId,
      calendarName: calendars.find((calendar) => calendar.id === calendarId)?.summary ?? calendarId,
      end: interval.end,
      start: interval.start,
    })),
  );

  return buildConflictCheckResult(checkedCalendarIds, intervals);
}

function pickCalendarId(
  calendars: GoogleCalendarListEntry[],
  suggestions: ReviewDraft["calendarSuggestions"],
  requestedCalendarId: string | null,
) {
  if (requestedCalendarId && calendars.some((calendar) => calendar.id === requestedCalendarId)) {
    return requestedCalendarId;
  }

  const top = suggestions[0];
  const second = suggestions[1];
  if (
    top &&
    top.confidence >= CALENDAR_CONFIDENCE_THRESHOLD &&
    (!second || top.confidence - second.confidence >= CALENDAR_CONFIDENCE_GAP)
  ) {
    return top.calendarId;
  }

  return calendars.find((calendar) => calendar.primary)?.id ?? requestedCalendarId ?? "primary";
}

function inferDuration(
  intent: DraftIntent,
  events: GoogleCalendarEvent[],
  factsContext: FactsContext,
) {
  if (!intent.title) {
    return 60;
  }

  const normalizedTitle = normalizeText(intent.title);
  const matchingDurations = events
    .filter(
      (event) =>
        similarity(normalizeText(event.summary ?? ""), normalizedTitle) >= SIMILARITY_MODERATE,
    )
    .map((event) => getDurationMinutes(event))
    .filter((value): value is number => value != null);

  const factDurations = factsContext.facts
    .filter(
      (fact) =>
        fact.status === "active" &&
        fact.kind === "duration-pattern" &&
        similarity(normalizeText(fact.subject), normalizedTitle) >= SIMILARITY_MODERATE,
    )
    .map((fact) => Number.parseInt(fact.value, 10))
    .filter((value) => Number.isFinite(value));

  const allDurations = [...matchingDurations, ...factDurations];
  if (allDurations.length === 0) {
    return 60;
  }

  const buckets = new Map<number, number>();
  for (const minutes of allDurations) {
    buckets.set(minutes, (buckets.get(minutes) ?? 0) + 1);
  }

  return [...buckets.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 60;
}

function appendFactsDrivenSuggestions(
  draft: ReviewDraft,
  events: GoogleCalendarEvent[],
  factsContext: FactsContext,
) {
  if (!draft.event.location) {
    const location = suggestLocation(draft.intent, events, factsContext);
    if (location) {
      draft.smartSignals.push({
        label: "Location candidate",
        detail: `Shared context suggests ${location}. It remains editable because the source did not state it explicitly.`,
      });
    }
  }

  if (!draft.intent.durationMinutes && draft.event.durationMinutes) {
    draft.smartSignals.unshift({
      label: "Duration suggestion",
      detail: `Suggested ${draft.event.durationMinutes} minutes from recent history and shared facts.`,
    });
  }
}

function suggestLocation(
  intent: DraftIntent,
  events: GoogleCalendarEvent[],
  factsContext: FactsContext,
) {
  if (!intent.title) {
    return null;
  }

  const normalizedTitle = normalizeText(intent.title);
  const recentLocation = events.find(
    (event) =>
      event.location &&
      similarity(normalizeText(event.summary ?? ""), normalizedTitle) >= SIMILARITY_STRICT,
  )?.location;
  if (recentLocation) {
    return recentLocation;
  }

  return (
    factsContext.facts.find(
      (fact) =>
        fact.status === "active" &&
        fact.kind === "location-pattern" &&
        similarity(normalizeText(fact.subject), normalizedTitle) >= SIMILARITY_STRICT,
    )?.value ?? null
  );
}

function syncIntentWithEvent(intent: DraftIntent, event: ReviewDraft["event"]) {
  return {
    ...intent,
    allDay: event.allDay,
    calendarId: event.calendarId,
    date: event.date,
    description: event.description,
    durationMinutes: event.durationMinutes,
    endDate: event.endDate,
    endTime: event.endTime,
    location: event.location,
    recurrenceRule: event.recurrenceRule,
    startTime: event.startTime,
    timezone: event.timezone,
    title: event.title || intent.title,
  } satisfies DraftIntent;
}

function selectExistingEventMatch(
  matches: ReviewDraft["existingEventMatches"],
  previousDraft: ReviewDraft | null,
  selectedUpdateTarget: ExplicitUpdateTarget | null,
) {
  if (selectedUpdateTarget) {
    return matches.find((match) => match.eventId === selectedUpdateTarget.eventId) ?? null;
  }

  const previousAction = previousDraft?.proposedAction;
  if (previousAction?.type === "update") {
    return matches.find((match) => match.eventId === previousAction.eventId) ?? matches[0] ?? null;
  }

  return matches.find((match) => match.selected) ?? null;
}

function buildEventFromIntent(
  intent: DraftIntent,
  localTimeZone: string,
  calendarId: string,
  recentEvents: GoogleCalendarEvent[],
  factsContext: FactsContext,
) {
  const inferredDuration = inferDuration(intent, recentEvents, factsContext);
  const duration = intent.durationMinutes ?? inferredDuration;

  return {
    allDay: intent.allDay,
    calendarId,
    date: intent.date,
    description: intent.description,
    durationMinutes: duration,
    endDate: intent.endDate ?? intent.date,
    endTime:
      intent.endTime ??
      (intent.allDay || !intent.startTime ? null : deriveEndTime(intent.startTime, duration)),
    location: intent.location,
    recurrenceRule: intent.recurrenceRule,
    startTime: intent.startTime,
    timezone: intent.timezone ?? localTimeZone,
    title: intent.title ?? "",
  };
}

function mergeAttendeeGroupState(
  groups: ReviewDraft["attendeeGroups"],
  previousGroups: ReviewDraft["attendeeGroups"],
) {
  return groups.map((group) => {
    const previous = previousGroups.find((item) => item.mention === group.mention);
    return previous
      ? {
          ...group,
          approved: previous.approved,
          manualEmail: previous.manualEmail,
          selectedEmail: previous.manualEmail
            ? null
            : (previous.selectedEmail ?? group.selectedEmail),
        }
      : group;
  });
}

function mergeSelectedUpdateTarget(
  matches: ReviewDraft["existingEventMatches"],
  selectedUpdateTarget: ExplicitUpdateTarget | null,
) {
  if (!selectedUpdateTarget) {
    return matches;
  }

  const existingMatch = matches.find((match) => match.eventId === selectedUpdateTarget.eventId);
  if (existingMatch) {
    return matches.map((match) => ({
      ...match,
      selected: match.eventId === selectedUpdateTarget.eventId,
    }));
  }

  const selectedMatch = existingEventMatchSchema.parse({
    calendarId: selectedUpdateTarget.calendarId,
    calendarName: selectedUpdateTarget.calendarId,
    eventId: selectedUpdateTarget.eventId,
    reason: "Explicitly selected by the agent for update.",
    score: 1,
    selected: true,
    start: selectedUpdateTarget.start ?? null,
    title: selectedUpdateTarget.title,
  });

  return [selectedMatch, ...matches].slice(0, 5);
}

function selectedUpdateTargetFromDraft(draft: ReviewDraft): ExplicitUpdateTarget | null {
  if (draft.proposedAction.type !== "update") {
    return null;
  }

  const updateAction = draft.proposedAction;

  const selectedMatch = draft.existingEventMatches.find(
    (match) => match.eventId === updateAction.eventId,
  );

  return {
    calendarId: updateAction.calendarId,
    eventId: updateAction.eventId,
    start: selectedMatch?.start ?? null,
    title: selectedMatch?.title ?? (draft.event.title || "Untitled event"),
  };
}

async function loadReviewContext(accessToken: string, userSub: string) {
  const [calendars, factsContext] = await Promise.all([
    listWritableCalendars(accessToken),
    loadFactsContext(userSub),
  ]);

  return {
    calendars,
    factsContext,
    recentEvents: await listRecentEvents(accessToken, calendars),
  };
}
