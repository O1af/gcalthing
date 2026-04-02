import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
} from 'ai'
import { z } from 'zod'
import type { AppChatMessage } from '@/lib/chat-ui'
import { getMessageText, toSourceInputsFromMessage } from '@/lib/chat-ui'
import type {
  ChatNotice,
  DraftIntent,
  ExecutionMode,
  SourceInput,
  SubmitEventRequest,
  SubmitEventResponse,
} from '@/lib/contracts'
import { draftIntentSchema } from '@/lib/contracts'
import { deriveEndTime, formatRfc3339InTimeZone, getDurationMinutes } from '@/lib/domain/date-time'
import { buildChatSystemPrompt } from '@/lib/server/chat-system-prompt'
import { getOpenAIModel } from '@/lib/server/ai-model'
import { logDebug, withDebugTiming } from '@/lib/server/debug'
import { getServerEnv } from '@/lib/server/env'

const attendeeMentionInputSchema = z.object({
  email: z.string().email().nullable().optional(),
  name: z.string().trim().min(1),
  optional: z.boolean().optional(),
})

const eventInputSchema = z.object({
  allDay: z.boolean().optional(),
  attendeeMentions: z.array(attendeeMentionInputSchema).optional(),
  calendarId: z.string().trim().nullable().optional(),
  date: z.string().trim().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  endDate: z.string().trim().nullable().optional(),
  endTime: z.string().trim().nullable().optional(),
  location: z.string().trim().nullable().optional(),
  recurrenceRule: z.string().trim().nullable().optional(),
  startTime: z.string().trim().nullable().optional(),
  timezone: z.string().trim().nullable().optional(),
  title: z.string().trim().nullable().optional(),
})

const searchEventsInputSchema = z.object({
  calendarIds: z.array(z.string()).max(10).optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  limit: z.number().int().min(1).max(20).default(8),
  query: z.string().trim().max(120).optional(),
})

const getEventInputSchema = z.object({
  calendarId: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
})

const checkAvailabilityInputSchema = z.object({
  calendarIds: z.array(z.string()).max(10).optional(),
  date: z.string().min(1),
  durationMinutes: z.number().int().positive().max(720).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().optional(),
})

const updateEventInputSchema = eventInputSchema.extend({
  calendarId: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
})

const deleteEventInputSchema = z.object({
  calendarId: z.string().trim().min(1),
  eventId: z.string().trim().min(1),
  title: z.string().trim().optional(),
  when: z.string().trim().optional(),
})

interface AssistantTurnInput {
  executionMode: ExecutionMode
  latestUserText: string
  localTimeZone: string
  messages: AppChatMessage[]
  sourceInputs: SourceInput[]
}

type SessionContext = Awaited<ReturnType<typeof import('@/lib/server/auth').getSessionContext>>

export async function streamAssistantTurn(params: {
  messages: AppChatMessage[]
  executionMode: ExecutionMode
  localTimeZone: string
  abortSignal?: AbortSignal
}): Promise<Response> {
  const input = buildAssistantTurnInput(params)
  const env = getServerEnv()
  const model = getOpenAIModel(env.OPENAI_MODEL)
  const { getSessionContext } = await import('@/lib/server/auth')
  const session = await getSessionContext()
  const turnId = crypto.randomUUID().slice(0, 8)
  let latestNotice: ChatNotice | null = null

  logDebug('ai:chat', 'turn:start', {
    executionMode: input.executionMode,
    messageCount: input.messages.length,
    model: env.OPENAI_MODEL,
    signedIn: Boolean(session),
    sourceInputCount: input.sourceInputs.length,
    turnId,
  })

  const tools = buildTurnTools({
    executionMode: input.executionMode,
    input,
    session,
    setNotice: (notice) => {
      latestNotice = notice
    },
    turnId,
  })

  const modelMessages = await convertToModelMessages(
    params.messages.map(({ id: _id, ...message }) => message),
  )

  const stream = createUIMessageStream<AppChatMessage>({
    originalMessages: params.messages,
    execute: ({ writer }) => {
      const result = streamText({
        abortSignal: params.abortSignal,
        messages: modelMessages,
        model,
        onFinish: () => {
          if (latestNotice) {
            writer.write({
              data: latestNotice,
              type: 'data-chatNotice',
            })
          }
        },
        stopWhen: stepCountIs(6),
        system: buildChatSystemPrompt({
          executionMode: input.executionMode,
          signedIn: Boolean(session),
        }),
        tools,
      })

      writer.merge(result.toUIMessageStream<AppChatMessage>({ sendReasoning: true }))
    },
    onFinish: ({ responseMessage }) => {
      logDebug('ai:chat', 'turn:done', {
        noticeKind: latestNotice?.kind ?? 'none',
        responseTextLength: getMessageText(responseMessage).trim().length,
        turnId,
      })
    },
  })

  return createUIMessageStreamResponse({ stream })
}

function buildAssistantTurnInput(params: {
  executionMode: ExecutionMode
  localTimeZone: string
  messages: AppChatMessage[]
}): AssistantTurnInput {
  const latestUserMessage = [...params.messages].reverse().find((message) => message.role === 'user')

  return {
    executionMode: params.executionMode,
    latestUserText: latestUserMessage ? getMessageText(latestUserMessage) : '',
    localTimeZone: params.localTimeZone,
    messages: params.messages,
    sourceInputs: collectConversationSourceInputs(params.messages),
  }
}

function buildTurnTools(params: {
  executionMode: ExecutionMode
  input: AssistantTurnInput
  session: SessionContext
  setNotice: (notice: ChatNotice | null) => void
  turnId: string
}) {
  const { executionMode, input, session, setNotice, turnId } = params

  return {
    list_writable_calendars: tool({
      description: 'List writable Google Calendars for the signed-in user.',
      inputSchema: z.object({}),
      execute: async () =>
        executeLoggedTool('list_writable_calendars', turnId, async () => {
          if (!session) {
            return signInRequiredResult(setNotice, 'Sign in with Google to list your calendars.')
          }

          const { listWritableCalendars } = await import('@/lib/server/google-calendar')
          const calendars = await listWritableCalendars(session.tokens.accessToken)

          return {
            calendars: calendars.map((calendar) => ({
              accessRole: calendar.accessRole,
              id: calendar.id,
              primary: Boolean(calendar.primary),
              summary: calendar.summary,
              timeZone: calendar.timeZone ?? null,
            })),
            detail:
              calendars.length > 0
                ? `Found ${calendars.length} writable calendar${calendars.length === 1 ? '' : 's'}.`
                : 'No writable calendars were found.',
          }
        }),
    }),
    search_events: tool({
      description: 'Search Google Calendar events by text query, date range, and optional calendar IDs.',
      inputSchema: searchEventsInputSchema,
      execute: async ({ calendarIds, dateFrom, dateTo, limit, query }) =>
        executeLoggedTool('search_events', turnId, async () => {
          if (!session) {
            return signInRequiredResult(setNotice, 'Sign in with Google to search your calendar events.')
          }

          const {
            listWritableCalendars,
            searchGoogleCalendarEvents,
          } = await import('@/lib/server/google-calendar')
          const calendars = await listWritableCalendars(session.tokens.accessToken)
          const events = await searchGoogleCalendarEvents({
            accessToken: session.tokens.accessToken,
            calendarIds,
            calendars,
            limit,
            query,
            timeMax: dateTo ? `${dateTo}T23:59:59Z` : undefined,
            timeMin: dateFrom ? `${dateFrom}T00:00:00Z` : undefined,
          })

          return {
            detail:
              events.length > 0
                ? `Found ${events.length} matching event${events.length === 1 ? '' : 's'}.`
                : 'No matching events were found.',
            events: events.map((event) => ({
              calendarId: event.calendarId,
              calendarName: event.calendarName,
              end: event.end ?? null,
              id: event.id,
              location: event.location ?? null,
              start: event.start ?? null,
              summary: event.summary ?? '(untitled)',
            })),
          }
        }),
    }),
    get_event: tool({
      description: 'Fetch a specific Google Calendar event by calendar ID and event ID.',
      inputSchema: getEventInputSchema,
      execute: async ({ calendarId, eventId }) =>
        executeLoggedTool('get_event', turnId, async () => {
          if (!session) {
            return signInRequiredResult(setNotice, 'Sign in with Google to inspect calendar events.')
          }

          const {
            getGoogleCalendarEvent,
            listWritableCalendars,
          } = await import('@/lib/server/google-calendar')
          const calendars = await listWritableCalendars(session.tokens.accessToken)
          const calendarName =
            calendars.find((calendar) => calendar.id === calendarId)?.summary ?? calendarId
          const event = await getGoogleCalendarEvent(
            session.tokens.accessToken,
            calendarId,
            calendarName,
            eventId,
          )

          return {
            detail: `Loaded ${event.summary ?? 'the selected event'}.`,
            event: {
              attendees: event.attendees ?? [],
              calendarId: event.calendarId,
              calendarName: event.calendarName,
              description: event.description ?? null,
              end: event.end ?? null,
              id: event.id,
              location: event.location ?? null,
              start: event.start ?? null,
              summary: event.summary ?? '(untitled)',
            },
          }
        }),
    }),
    check_availability: tool({
      description: 'Check Google Calendar availability for a given date/time window.',
      inputSchema: checkAvailabilityInputSchema,
      execute: async ({ calendarIds, date, durationMinutes, endTime, startTime, timezone }) =>
        executeLoggedTool('check_availability', turnId, async () => {
          if (!session) {
            return signInRequiredResult(setNotice, 'Sign in with Google to check calendar availability.')
          }

          const {
            listWritableCalendars,
            queryFreeBusy,
          } = await import('@/lib/server/google-calendar')
          const calendars = await listWritableCalendars(session.tokens.accessToken)
          const targetCalendarIds =
            calendarIds && calendarIds.length > 0
              ? calendarIds
              : calendars.slice(0, 5).map((calendar) => calendar.id)
          const resolvedTimeZone = timezone ?? input.localTimeZone
          const resolvedEndTime = endTime ?? deriveEndTime(startTime, durationMinutes ?? 60)
          const timeMin = formatRfc3339InTimeZone(date, startTime, resolvedTimeZone)
          const timeMax = formatRfc3339InTimeZone(date, resolvedEndTime, resolvedTimeZone)
          const busy = await queryFreeBusy(
            session.tokens.accessToken,
            targetCalendarIds,
            timeMin,
            timeMax,
          )

          return {
            calendars: targetCalendarIds.map((calendarId) => ({
              busy: busy[calendarId]?.busy ?? [],
              calendarId,
              calendarName:
                calendars.find((calendar) => calendar.id === calendarId)?.summary ?? calendarId,
            })),
            detail: `Checked availability across ${targetCalendarIds.length} calendar${targetCalendarIds.length === 1 ? '' : 's'} from ${startTime} to ${resolvedEndTime} on ${date}.`,
            timeMax,
            timeMin,
            timezone: resolvedTimeZone,
          }
        }),
    }),
    create_event: tool({
      description: 'Create a Google Calendar event from explicit event fields.',
      inputSchema: eventInputSchema,
      execute: async (eventInput) =>
        executeLoggedTool('create_event', turnId, async () => {
          if (!session) {
            return signInRequiredResult(setNotice, 'Sign in with Google before creating events.')
          }

          const normalized = await normalizeCreateRequest({
            accessToken: session.tokens.accessToken,
            eventInput,
            localTimeZone: input.localTimeZone,
            sourceInputs: input.sourceInputs,
            userSub: session.profile.sub,
          })
          if (normalized.request == null) {
            return { detail: normalized.detail }
          }

          const approvalBlock = ensureApprovalAllowed({
            action: 'create',
            executionMode,
            latestUserText: input.latestUserText,
            messages: input.messages,
            summary: normalized.summary,
          })
          if (approvalBlock) {
            return { detail: approvalBlock }
          }

          return submitWriteRequest({
            request: normalized.request,
            session,
            setNotice,
          })
        }),
    }),
    update_event: tool({
      description: 'Update an existing Google Calendar event. Provide the event id, calendar id, and changed fields.',
      inputSchema: updateEventInputSchema,
      execute: async ({ calendarId, eventId, ...eventInput }) =>
        executeUpdateOrReschedule('update_event', 'update', { calendarId, eventId, eventInput, executionMode, input, session, setNotice, turnId }),
    }),
    reschedule_event: tool({
      description: 'Reschedule an existing Google Calendar event by changing its date and or time fields.',
      inputSchema: updateEventInputSchema,
      execute: async ({ calendarId, eventId, ...eventInput }) =>
        executeUpdateOrReschedule('reschedule_event', 'reschedule', { calendarId, eventId, eventInput, executionMode, input, session, setNotice, turnId }),
    }),
    delete_event: tool({
      description: 'Delete a specific Google Calendar event by calendar id and event id.',
      inputSchema: deleteEventInputSchema,
      execute: async ({ calendarId, eventId, title, when }) =>
        executeLoggedTool('delete_event', turnId, async () => {
          if (!session) {
            return signInRequiredResult(setNotice, 'Sign in with Google before deleting events.')
          }

          const summary = summarizeDeleteAction({
            title: title?.trim() || 'Untitled event',
            when: when?.trim() || null,
          })
          const approvalBlock = ensureApprovalAllowed({
            action: 'delete',
            executionMode,
            latestUserText: input.latestUserText,
            messages: input.messages,
            summary,
          })
          if (approvalBlock) {
            return { detail: approvalBlock }
          }

          const { deleteGoogleCalendarEvent } = await import('@/lib/server/google-calendar')
          const deletion = await deleteGoogleCalendarEvent(
            session.tokens.accessToken,
            calendarId,
            eventId,
          )
          const response = {
            actionPerformed: deletion.actionPerformed,
            calendarId: deletion.calendarId,
            eventId: deletion.eventId,
            factChangesApplied: {
              created: [],
              staled: [],
              updated: [],
            },
            htmlLink: deletion.htmlLink,
            sendUpdates: deletion.sendUpdates,
          } satisfies SubmitEventResponse
          setNotice({
            kind: 'event-success',
            response,
          })

          return {
            detail: `Deleted ${title?.trim() || 'the selected event'} from Google Calendar.`,
          }
        }),
    }),
  }
}

async function normalizeCreateRequest(params: {
  accessToken: string
  eventInput: z.infer<typeof eventInputSchema>
  localTimeZone: string
  sourceInputs: SourceInput[]
  userSub: string
}) {
  const { accessToken, eventInput, localTimeZone, sourceInputs, userSub } = params
  const { buildSignedInReviewDraft } = await import('@/lib/server/review-draft')
  const intent = mergeIntent(defaultDraftIntent(localTimeZone), eventInput, localTimeZone)
  const draft = await buildSignedInReviewDraft({
    accessToken,
    intent,
    localTimeZone,
    userSub,
  })
  const blocking = draft.reviewBlockers.filter((blocker) => blocker.severity === 'blocking')
  if (blocking.length > 0) {
    return {
      detail: buildMissingFieldsMessage(blocking),
      request: null,
      summary: summarizeEventAction('create', draft.event),
    }
  }

  return {
    detail: null,
    request: {
      action: { type: 'create' as const },
      appendSourceDetails: true,
      attendeeGroups: draft.attendeeGroups,
      event: draft.event,
      sourceInputs,
    } satisfies SubmitEventRequest,
    summary: summarizeEventAction('create', draft.event),
  }
}

async function normalizeUpdateRequest(params: {
  accessToken: string
  calendarId: string
  eventId: string
  eventInput: z.infer<typeof eventInputSchema>
  localTimeZone: string
  sourceInputs: SourceInput[]
  userSub: string
}) {
  const {
    accessToken,
    calendarId,
    eventId,
    eventInput,
    localTimeZone,
    sourceInputs,
    userSub,
  } = params
  const {
    getGoogleCalendarEvent,
    listWritableCalendars,
  } = await import('@/lib/server/google-calendar')
  const { buildSignedInReviewDraft } = await import('@/lib/server/review-draft')
  const [calendars, currentEvent] = await Promise.all([
    listWritableCalendars(accessToken),
    getGoogleCalendarEvent(accessToken, calendarId, calendarId, eventId),
  ])
  const calendarName = calendars.find((calendar) => calendar.id === calendarId)?.summary ?? calendarId
  currentEvent.calendarName = calendarName
  const intent = mergeIntent(
    buildIntentFromGoogleEvent(currentEvent, localTimeZone),
    eventInput,
    localTimeZone,
  )
  const draft = await buildSignedInReviewDraft({
    accessToken,
    intent,
    localTimeZone,
    selectedUpdateTarget: {
      calendarId,
      eventId,
      start: currentEvent.start?.dateTime ?? currentEvent.start?.date ?? null,
      title: currentEvent.summary ?? 'Untitled event',
    },
    userSub,
  })
  const blocking = draft.reviewBlockers.filter((blocker) => blocker.severity === 'blocking')
  if (blocking.length > 0) {
    return {
      detail: buildMissingFieldsMessage(blocking),
      request: null,
      summary: summarizeEventAction('update', draft.event),
    }
  }

  return {
    detail: null,
    request: {
      action: {
        type: 'update' as const,
        calendarId,
        eventId,
      },
      appendSourceDetails: true,
      attendeeGroups: draft.attendeeGroups,
      event: draft.event,
      sourceInputs,
    } satisfies SubmitEventRequest,
    summary: summarizeEventAction('update', draft.event),
  }
}

async function submitWriteRequest(params: {
  request: SubmitEventRequest
  session: NonNullable<SessionContext>
  setNotice: (notice: ChatNotice | null) => void
}) {
  const { request, session, setNotice } = params
  const response = await writeCalendarEvent(session, request)
  setNotice({
    kind: 'event-success',
    response,
  })

  return {
    detail:
      response.actionPerformed === 'created'
        ? 'Created the event in Google Calendar.'
        : response.actionPerformed === 'updated'
          ? 'Updated the existing Google Calendar event.'
          : 'Deleted the Google Calendar event.',
  }
}

async function executeUpdateOrReschedule(
  toolName: string,
  action: 'update' | 'reschedule',
  params: {
    calendarId: string
    eventId: string
    eventInput: z.infer<typeof eventInputSchema>
    executionMode: ExecutionMode
    input: AssistantTurnInput
    session: SessionContext
    setNotice: (notice: ChatNotice | null) => void
    turnId: string
  },
) {
  const { calendarId, eventId, eventInput, executionMode, input, session, setNotice, turnId } = params
  return executeLoggedTool(toolName, turnId, async () => {
    if (!session) {
      return signInRequiredResult(setNotice, `Sign in with Google before ${action === 'reschedule' ? 'rescheduling' : 'updating'} events.`)
    }

    const normalized = await normalizeUpdateRequest({
      accessToken: session.tokens.accessToken,
      calendarId,
      eventId,
      eventInput,
      localTimeZone: input.localTimeZone,
      sourceInputs: input.sourceInputs,
      userSub: session.profile.sub,
    })
    if (normalized.request == null) {
      return { detail: normalized.detail }
    }

    const approvalBlock = ensureApprovalAllowed({
      action,
      executionMode,
      latestUserText: input.latestUserText,
      messages: input.messages,
      summary: normalized.summary,
    })
    if (approvalBlock) {
      return { detail: approvalBlock }
    }

    return submitWriteRequest({
      request: normalized.request,
      session,
      setNotice,
    })
  })
}

function ensureApprovalAllowed(params: {
  action: 'create' | 'delete' | 'reschedule' | 'update'
  executionMode: ExecutionMode
  latestUserText: string
  messages: AppChatMessage[]
  summary: string
}) {
  const { action, executionMode, latestUserText, messages, summary } = params
  if (executionMode !== 'approval-first') {
    return null
  }

  if (!isApprovalReply(latestUserText)) {
    return `Approval-first mode is enabled. Ask the user to confirm this action in chat before writing: ${summary}`
  }

  const previousAssistantText = getPreviousAssistantText(messages)
  if (!previousAssistantText) {
    return `Approval-first mode is enabled. Ask the user to confirm this action in chat before writing: ${summary}`
  }

  if (!assistantAskedForConfirmation(previousAssistantText, action, summary)) {
    return `Approval-first mode is enabled. Ask the user to confirm this action in chat before writing: ${summary}`
  }

  return null
}

function assistantAskedForConfirmation(
  text: string,
  action: 'create' | 'delete' | 'reschedule' | 'update',
  summary: string,
) {
  const normalized = text.toLowerCase()
  const asksConfirmation =
    normalized.includes('confirm') ||
    normalized.includes('reply yes') ||
    normalized.includes('should i') ||
    normalized.includes('want me to')
  if (!asksConfirmation) {
    return false
  }

  const actionKeywords: Record<typeof action, string[]> = {
    create: ['create', 'add', 'schedule'],
    delete: ['delete', 'remove', 'cancel'],
    reschedule: ['reschedule', 'move', 'change the time'],
    update: ['update', 'edit', 'change'],
  }
  const mentionsAction = actionKeywords[action].some((keyword) => normalized.includes(keyword))
  if (!mentionsAction) {
    return false
  }

  const summaryTitle = extractSummaryTitle(summary)
  return summaryTitle ? normalized.includes(summaryTitle) : true
}

function extractSummaryTitle(summary: string) {
  const match = summary.toLowerCase().match(/"([^"]+)"/)
  return match?.[1] ?? null
}

function isApprovalReply(text: string) {
  return /^(yes|yep|yeah|sure|ok|okay|looks good|do it|go ahead|confirm|please do|sounds good)$/i.test(
    text.trim(),
  )
}

function getPreviousAssistantText(messages: AppChatMessage[]) {
  let seenLatestUser = false

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!seenLatestUser && message.role === 'user') {
      seenLatestUser = true
      continue
    }

    if (seenLatestUser && message.role === 'assistant') {
      return getMessageText(message)
    }
  }

  return ''
}

function signInRequiredResult(
  setNotice: (notice: ChatNotice | null) => void,
  detail: string,
) {
  setNotice({
    kind: 'sign-in-required',
    detail,
  })

  return { detail }
}

async function writeCalendarEvent(
  session: NonNullable<SessionContext>,
  request: SubmitEventRequest,
) {
  const {
    createGoogleCalendarEvent,
    listWritableCalendars,
    updateGoogleCalendarEvent,
  } = await import('@/lib/server/google-calendar')
  const { applyFactChangesForSubmission } = await import('@/lib/server/facts')
  const calendars = await listWritableCalendars(session.tokens.accessToken)
  const calendarNameById = new Map(calendars.map((calendar) => [calendar.id, calendar.summary]))
  const result =
    request.action.type === 'update'
      ? await updateGoogleCalendarEvent(
          session.tokens.accessToken,
          request.action.eventId,
          request.action.calendarId,
          request,
          calendarNameById,
        )
      : await createGoogleCalendarEvent(
          session.tokens.accessToken,
          request,
          calendarNameById,
        )
  const factChangesApplied = await applyFactChangesForSubmission(
    session.profile.sub,
    request,
    { actionPerformed: result.actionPerformed },
  )

  return {
    actionPerformed: result.actionPerformed,
    calendarId: result.calendarId,
    eventId: result.eventId,
    factChangesApplied,
    htmlLink: result.htmlLink,
    sendUpdates: result.sendUpdates,
  } satisfies SubmitEventResponse
}

function collectConversationSourceInputs(messages: AppChatMessage[]) {
  return mergeSourceInputs(
    [],
    messages
      .filter((message) => message.role === 'user')
      .flatMap((message) => toSourceInputsFromMessage(message)),
  )
}

function buildIntentFromGoogleEvent(
  event: Awaited<ReturnType<typeof import('@/lib/server/google-calendar').getGoogleCalendarEvent>>,
  fallbackTimeZone: string,
): DraftIntent {
  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime)
  const date = event.start?.date ?? event.start?.dateTime?.slice(0, 10) ?? null
  const endDate = event.end?.date ?? event.end?.dateTime?.slice(0, 10) ?? date
  const startTime = event.start?.dateTime?.slice(11, 16) ?? null
  const endTime = event.end?.dateTime?.slice(11, 16) ?? null
  const durationMinutes = !isAllDay ? getDurationMinutes(event) : null

  return draftIntentSchema.parse({
    allDay: isAllDay,
    attendeeMentions: (event.attendees ?? []).map((attendee) => ({
      email: attendee.email ?? null,
      name: attendee.displayName ?? attendee.email ?? 'Guest',
      optional: false,
    })),
    calendarId: event.calendarId,
    date,
    description: event.description ?? null,
    durationMinutes,
    endDate,
    endTime,
    location: event.location ?? null,
    recurrenceRule: null,
    startTime,
    timezone: event.start?.timeZone ?? event.end?.timeZone ?? fallbackTimeZone,
    title: event.summary ?? null,
  })
}

function defaultDraftIntent(localTimeZone: string): DraftIntent {
  return draftIntentSchema.parse({
    timezone: localTimeZone,
  })
}

function mergeIntent(
  base: DraftIntent,
  update: z.infer<typeof eventInputSchema>,
  fallbackTimeZone: string,
): DraftIntent {
  return draftIntentSchema.parse({
    ...base,
    ...removeUndefined(update),
    timezone:
      update.timezone === undefined
        ? (base.timezone ?? fallbackTimeZone)
        : update.timezone,
  })
}

function buildMissingFieldsMessage(
  blockers: Array<{ detail: string; label: string }>,
) {
  return `More detail is needed before writing to Google Calendar: ${blockers
    .map((blocker) => blocker.label)
    .join(', ')}. Ask the user for the missing information instead of writing now.`
}

function summarizeEventAction(
  action: 'create' | 'update',
  event: SubmitEventRequest['event'],
) {
  const when = event.allDay
    ? event.date
      ? `all day on ${event.date}`
      : 'with no date yet'
    : event.date && event.startTime
      ? `${event.date} at ${event.startTime}`
      : 'with missing time details'

  return `${action === 'create' ? 'Create' : 'Update'} "${event.title || 'Untitled event'}" ${when}.`
}

function summarizeDeleteAction(params: { title: string; when: string | null }) {
  const { title, when } = params
  return `Delete "${title}"${when ? ` scheduled ${when}` : ''}.`
}

function mergeSourceInputs(left: SourceInput[], right: SourceInput[]): SourceInput[] {
  const seen = new Set<string>()
  return [...left, ...right].filter((input) => {
    if (seen.has(input.id)) {
      return false
    }
    seen.add(input.id)
    return true
  })
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>
}

async function executeLoggedTool<T>(
  toolName: string,
  turnId: string,
  run: () => Promise<T>,
): Promise<T> {
  logDebug('ai:tool', 'start', {
    toolName,
    turnId,
  })

  return withDebugTiming('ai:tool', toolName, async () => {
    const result = await run()
    logDebug('ai:tool', 'result', {
      resultKind: summarizeToolResult(result),
      toolName,
      turnId,
    })
    return result
  }, {
    turnId,
  })
}

function summarizeToolResult(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return String(result)
  }

  if ('detail' in result && typeof (result as Record<string, unknown>).detail === 'string') {
    return (result as Record<string, string>).detail
  }

  return 'object'
}
