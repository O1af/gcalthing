import { generateObject, generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import type {
  AssistantTurnResponse,
  ChatArtifact,
  ChatTurnInput,
  FactsContext,
  ReviewDraft,
  SubmitEventRequest,
} from '@/lib/contracts'
import { emptyFactsContext } from '@/lib/contracts'
import { getOpenAIModel } from '@/lib/server/ai-model'
import { logDebug, withDebugTiming } from '@/lib/server/debug'
import { getServerEnv } from '@/lib/server/env'

const draftPatchSchema = z.object({
  allDay: z.boolean().optional(),
  calendarId: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  endDate: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  recurrenceRule: z.string().nullable().optional(),
  selectedMatchEventId: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  updateIntent: z.enum(['keep', 'create', 'update']).default('keep'),
})

export async function runAssistantTurn(input: ChatTurnInput): Promise<AssistantTurnResponse> {
  const env = getServerEnv()
  const model = getOpenAIModel(env.OPENAI_MODEL)
  const { getSessionContext } = await import('@/lib/server/auth')
  const session = await getSessionContext()
  const latestUserText = [...input.history].reverse().find((message) => message.role === 'user')?.text ?? ''
  let latestArtifact = input.currentArtifact
  const turnId = crypto.randomUUID().slice(0, 8)

  logDebug('ai:chat', 'turn:start', {
    artifactKind: latestArtifact?.kind ?? 'none',
    historyCount: input.history.length,
    latestInputCount: input.latestInputs.length,
    model: env.OPENAI_MODEL,
    signedIn: Boolean(session),
    turnId,
  })

  if (!latestArtifact && input.latestInputs.length > 0) {
    const artifact = await executeLoggedTool('extract_event_from_inputs', turnId, async () => {
      const nextArtifact = await buildDraftArtifact({
        latestInputs: input.latestInputs,
        localTimeZone: input.localTimeZone,
        session,
      })
      latestArtifact = nextArtifact
      return nextArtifact
    })

    latestArtifact = artifact
  }

  const directAction = inferDirectAction(latestArtifact, latestUserText, input.latestInputs.length)
  if (directAction) {
    const outcome = await executeLoggedTool(directAction, turnId, async () => {
      const result = await submitCurrentArtifact({
        actionOverride: directAction === 'create_event' ? { type: 'create' } : null,
        currentArtifact: latestArtifact,
        session,
      })
      latestArtifact = result.artifact
      return result
    })

    return {
      artifact: outcome.artifact,
      text: outcome.detail,
    }
  }

  const tools = buildTurnTools({
    input,
    latestUserText,
    session,
    turnId,
    getArtifact: () => latestArtifact,
    updateArtifact: (artifact) => {
      latestArtifact = artifact
    },
  })
  const artifactContext = describeArtifactForPrompt(latestArtifact)

  const result = await withDebugTiming('ai:chat', 'generateText', () => generateText({
    messages: input.history
      .filter((message) => message.text.trim().length > 0)
      .map((message) => ({
        content: message.text,
        role: message.role,
      })),
    model,
    stopWhen: stepCountIs(4),
    system: [
      'You are a concise scheduling copilot inside a one-page chat workspace.',
      'Use tools only when they are actually needed.',
      'A draft may already have been prepared before this turn starts, so do not ask to extract it again unless the user is replacing the draft with new event details.',
      'When there is an existing draft and the user changes or clarifies it, call update_existing_draft.',
      'Only call create_event or update_event when the user clearly wants to write to Google Calendar.',
      'If a protected Google action is requested while signed out, explain that sign-in is required and keep the current draft intact.',
      'Keep the response short and practical.',
      artifactContext,
      `Google tools are currently ${session ? 'available' : 'unavailable because the user is signed out'}.`,
    ].join('\n'),
    tools,
  }), {
    model: env.OPENAI_MODEL,
    turnId,
  })

  logDebug('ai:chat', 'turn:done', {
    artifactKind: latestArtifact?.kind ?? 'none',
    responseTextLength: result.text.trim().length,
    turnId,
  })

  return {
    artifact: latestArtifact,
    text: result.text.trim() || fallbackAssistantText(latestArtifact),
  }
}

function buildTurnTools(params: {
  input: ChatTurnInput
  latestUserText: string
  session: Awaited<ReturnType<typeof import('@/lib/server/auth').getSessionContext>>
  turnId: string
  getArtifact: () => ChatArtifact | null
  updateArtifact: (artifact: ChatArtifact | null) => void
}) {
  const { input, latestUserText, session, turnId, getArtifact, updateArtifact } = params
  const initialArtifact = getArtifact()

  if (initialArtifact?.kind !== 'event-draft') {
    return {}
  }
  const draftArtifact = initialArtifact

  const tools = {
    update_existing_draft: tool({
      description:
        'Apply a natural-language change to the current draft and recompute warnings and suggestions.',
      inputSchema: z.object({}),
      execute: async () =>
        executeLoggedTool('update_existing_draft', turnId, async () => {
          const artifact = getArtifact()
          if (artifact?.kind !== 'event-draft') {
            return {
              artifact,
              detail: 'There is no current draft to update yet.',
            }
          }
          const factsContext = session
            ? await loadFactsForSession(session.profile.sub)
            : emptyFactsContext
          const patch = await inferDraftPatch({
            currentDraft: artifact.draft,
            factsContext,
            localTimeZone: input.localTimeZone,
            message: latestUserText,
          })
          const nextDraft = structuredClone(artifact.draft)
          applyDraftPatch(nextDraft, patch)
          const refreshed = await refreshDraft({
            draft: nextDraft,
            localTimeZone: input.localTimeZone,
            session,
          })
          const result = {
            artifact: {
              kind: 'event-draft' as const,
              draft: refreshed,
              sourceInputs: mergeSourceInputs(artifact.sourceInputs, input.latestInputs),
              supportsGoogleActions: Boolean(session),
            },
            detail:
              patch.updateIntent === 'update'
                ? 'Updated the current draft and kept the update-existing intent selected.'
                : 'Updated the current draft with the latest change.',
          }
          updateArtifact(result.artifact)
          return result
        }),
    }),
  }

  if (!session) {
    return tools
  }

  return {
    ...tools,
    fetch_recent_calendar_context: tool({
      description: 'Refresh recent Google Calendar context for the current draft.',
      inputSchema: z.object({}),
      execute: async () =>
        executeLoggedTool('fetch_recent_calendar_context', turnId, async () => {
          const currentArtifact = getArtifact()
          if (currentArtifact?.kind !== 'event-draft') {
            return {
              artifact: currentArtifact,
              detail: 'There is no current draft yet.',
            }
          }
          const artifact = await refreshEventDraftArtifact(currentArtifact, input.localTimeZone, session)
          const result = {
            artifact,
            detail: `Loaded recent context from ${artifact.draft.calendarContext.calendars.length} writable calendars.`,
          }
          updateArtifact(result.artifact)
          return result
        }),
    }),
    resolve_attendee_candidates: tool({
      description: 'Refresh attendee suggestions for the current draft.',
      inputSchema: z.object({}),
      execute: async () =>
        executeLoggedTool('resolve_attendee_candidates', turnId, async () => {
          const currentArtifact = getArtifact()
          if (currentArtifact?.kind !== 'event-draft') {
            return {
              artifact: currentArtifact,
              detail: 'There is no current draft yet.',
            }
          }
          const artifact = await refreshEventDraftArtifact(currentArtifact, input.localTimeZone, session)
          const result = {
            artifact,
            detail:
              artifact.draft.attendeeGroups.length > 0
                ? `Resolved ${artifact.draft.attendeeGroups.length} attendee mention${artifact.draft.attendeeGroups.length === 1 ? '' : 's'}.`
                : 'No attendee mentions were found in the current draft.',
          }
          updateArtifact(result.artifact)
          return result
        }),
    }),
    check_free_busy: tool({
      description: 'Run a Google Calendar conflict check for the current draft.',
      inputSchema: z.object({}),
      execute: async () =>
        executeLoggedTool('check_free_busy', turnId, async () => {
          const currentArtifact = getArtifact()
          if (currentArtifact?.kind !== 'event-draft') {
            return {
              artifact: currentArtifact,
              detail: 'There is no current draft yet.',
            }
          }
          const artifact = await refreshEventDraftArtifact(currentArtifact, input.localTimeZone, session)
          const result = {
            artifact,
            detail: artifact.draft.conflictCheck.hasConflict
              ? 'A time conflict was found in the selected calendar set.'
              : 'No conflicts were found in the checked calendars.',
          }
          updateArtifact(result.artifact)
          return result
        }),
    }),
    find_existing_event_matches: tool({
      description: 'Refresh existing-event matches for the current draft.',
      inputSchema: z.object({}),
      execute: async () =>
        executeLoggedTool('find_existing_event_matches', turnId, async () => {
          const currentArtifact = getArtifact()
          if (currentArtifact?.kind !== 'event-draft') {
            return {
              artifact: currentArtifact,
              detail: 'There is no current draft yet.',
            }
          }
          const artifact = await refreshEventDraftArtifact(currentArtifact, input.localTimeZone, session)
          const result = {
            artifact,
            detail:
              artifact.draft.existingEventMatches.length > 0
                ? `Found ${artifact.draft.existingEventMatches.length} existing event match${artifact.draft.existingEventMatches.length === 1 ? '' : 'es'}.`
                : 'No close existing-event match was found.',
          }
          updateArtifact(result.artifact)
          return result
        }),
    }),
    create_event: tool({
      description: 'Create the current draft as a new Google Calendar event.',
      inputSchema: z.object({}),
      execute: async () =>
        executeLoggedTool('create_event', turnId, async () => {
          const result = await submitCurrentArtifact({
            actionOverride: { type: 'create' },
            currentArtifact: getArtifact(),
            session,
          })
          updateArtifact(result.artifact)
          return result
        }),
    }),
    ...(draftArtifact.draft.existingEventMatches.length > 0
      ? {
          update_event: tool({
            description: 'Update the selected existing Google Calendar event from the current draft.',
            inputSchema: z.object({}),
            execute: async () =>
              executeLoggedTool('update_event', turnId, async () => {
                const result = await submitCurrentArtifact({
                  actionOverride: null,
                  currentArtifact: getArtifact(),
                  session,
                })
                updateArtifact(result.artifact)
                return result
              }),
          }),
        }
      : {}),
  }
}

function describeArtifactForPrompt(artifact: ChatArtifact | null) {
  if (!artifact) {
    return 'There is no active draft yet.'
  }

  if (artifact.kind === 'sign-in-required') {
    return `The current state is a sign-in requirement notice: ${artifact.detail}`
  }

  if (artifact.kind === 'event-success') {
    return `The latest action already ${artifact.response.actionPerformed} an event.`
  }

  return [
    'There is an active draft.',
    `Title: ${artifact.draft.event.title || '(untitled)'}`,
    `Date: ${artifact.draft.event.date || '(unknown)'}`,
    `Start time: ${artifact.draft.event.startTime || '(unknown)'}`,
    `Calendar: ${artifact.draft.event.calendarId}`,
    `Conflict: ${artifact.draft.conflictCheck.hasConflict ? 'yes' : 'no'}`,
    `Existing matches: ${artifact.draft.existingEventMatches.length}`,
    `Suggested action: ${artifact.draft.proposedAction.type}`,
  ].join('\n')
}

function inferDirectAction(
  artifact: ChatArtifact | null,
  latestUserText: string,
  latestInputCount: number,
): 'create_event' | 'update_event' | null {
  if (artifact?.kind !== 'event-draft' || latestInputCount > 0) {
    return null
  }

  const normalized = latestUserText.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  const isApproval =
    /^(yes|yep|yeah|sure|ok|okay|looks good|do it|go ahead|create it|add it|submit it)$/i.test(
      normalized,
    )
  if (!isApproval) {
    return null
  }

  return artifact.draft.proposedAction.type === 'update' ? 'update_event' : 'create_event'
}

async function buildDraftArtifact(params: {
  latestInputs: ChatTurnInput['latestInputs']
  localTimeZone: string
  session: Awaited<ReturnType<typeof import('@/lib/server/auth').getSessionContext>>
}) {
  const { latestInputs, localTimeZone, session } = params
  const { extractStructuredDraft } = await import('@/lib/server/extraction')
  const {
    buildExtractionOnlyReviewDraft,
    buildInitialReviewDraft,
  } = await import('@/lib/server/review-draft')
  const factsContext = session ? await loadFactsForSession(session.profile.sub) : emptyFactsContext
  const buildDraftInput = {
    inputs: latestInputs,
    localTimeZone,
  }
  const extracted = await extractStructuredDraft(buildDraftInput, factsContext)
  const draft = session
    ? await buildInitialReviewDraft({
        accessToken: session.tokens.accessToken,
        extracted,
        input: buildDraftInput,
        userSub: session.profile.sub,
      })
    : await buildExtractionOnlyReviewDraft({
        extracted,
        input: buildDraftInput,
      })

  return {
    kind: 'event-draft' as const,
    draft,
    sourceInputs: latestInputs,
    supportsGoogleActions: Boolean(session),
  }
}

async function refreshDraft(params: {
  draft: ReviewDraft
  localTimeZone: string
  session: Awaited<ReturnType<typeof import('@/lib/server/auth').getSessionContext>>
}) {
  const { draft, localTimeZone, session } = params
  const {
    refreshExtractionOnlyDraftState,
    refreshReviewDraftState,
  } = await import('@/lib/server/review-draft')

  return session
    ? refreshReviewDraftState({
        accessToken: session.tokens.accessToken,
        request: {
          draft,
          localTimeZone,
        },
        userSub: session.profile.sub,
      })
    : refreshExtractionOnlyDraftState({
        request: {
          draft,
          localTimeZone,
        },
      })
}

async function refreshEventDraftArtifact(
  artifact: Extract<ChatArtifact, { kind: 'event-draft' }>,
  localTimeZone: string,
  session: Awaited<ReturnType<typeof import('@/lib/server/auth').getSessionContext>>,
) {
  const draft = await refreshDraft({
    draft: artifact.draft,
    localTimeZone,
    session,
  })

  return {
    ...artifact,
    draft,
    supportsGoogleActions: Boolean(session),
  }
}

async function inferDraftPatch(params: {
  currentDraft: ReviewDraft
  factsContext: FactsContext
  localTimeZone: string
  message: string
}) {
  const env = getServerEnv()
  const model = getOpenAIModel(env.OPENAI_MODEL)
  return withDebugTiming('ai:chat', 'inferDraftPatch', async () => {
    const { object } = await generateObject({
      model,
      schema: draftPatchSchema,
      schemaName: 'draft_patch',
      system: [
        'You update an existing calendar draft from a short follow-up chat message.',
        'Return only changed fields.',
        'Never invent missing values.',
        'If the message does not specify a field change, omit it.',
        `Default local timezone: ${params.localTimeZone}.`,
        `Shared facts summary: ${JSON.stringify(params.factsContext.promptSummary)}`,
      ].join('\n'),
      prompt: [
        `Current draft: ${JSON.stringify(params.currentDraft)}`,
        `User follow-up: ${params.message}`,
      ].join('\n\n'),
    })

    return object
  }, {
    draftTitle: params.currentDraft.event.title || '(untitled)',
    messageLength: params.message.length,
    model: env.OPENAI_MODEL,
  })
}

function applyDraftPatch(draft: ReviewDraft, patch: z.infer<typeof draftPatchSchema>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue
    }
    if (key === 'updateIntent' || key === 'selectedMatchEventId') {
      continue
    }
    ;(draft.event as Record<string, unknown>)[key] = value
  }

  if (patch.updateIntent === 'create') {
    draft.proposedAction = { type: 'create' }
    draft.existingEventMatches = draft.existingEventMatches.map((match) => ({
      ...match,
      selected: false,
    }))
  }

  if (patch.updateIntent === 'update') {
    const selectedMatch =
      draft.existingEventMatches.find((match) => match.eventId === patch.selectedMatchEventId) ??
      draft.existingEventMatches[0]
    if (selectedMatch) {
      draft.proposedAction = {
        type: 'update',
        calendarId: selectedMatch.calendarId,
        eventId: selectedMatch.eventId,
      }
      draft.existingEventMatches = draft.existingEventMatches.map((match) => ({
        ...match,
        selected: match.eventId === selectedMatch.eventId,
      }))
    }
  }
}

async function submitCurrentArtifact(params: {
  actionOverride: SubmitEventRequest['action'] | null
  currentArtifact: ChatArtifact | null
  session: Awaited<ReturnType<typeof import('@/lib/server/auth').getSessionContext>>
}) {
  const { actionOverride, currentArtifact, session } = params
  if (currentArtifact?.kind !== 'event-draft') {
    return {
      artifact: currentArtifact,
      detail: 'There is no active draft to write yet.',
    }
  }

  if (!session) {
    return {
      artifact: signInArtifact('Sign in with Google before creating or updating calendar events.'),
      detail: 'Google sign-in is required before writing calendar events.',
    }
  }

  const request: SubmitEventRequest = {
    action: actionOverride ?? currentArtifact.draft.proposedAction,
    appendSourceDetails: true,
    attendeeGroups: currentArtifact.draft.attendeeGroups,
    event: currentArtifact.draft.event,
    extracted: currentArtifact.draft.extracted,
    sourceInputs: currentArtifact.sourceInputs,
  }

  if (request.action.type === 'update' || actionOverride?.type === 'create') {
    // pass through
  } else if (currentArtifact.draft.proposedAction.type !== 'update' && actionOverride == null) {
    return {
      artifact: currentArtifact,
      detail: 'Choose an existing match in the draft card before asking me to update it.',
    }
  }

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
    artifact: {
      kind: 'event-success' as const,
      response: {
        actionPerformed: result.actionPerformed,
        calendarId: result.calendarId,
        eventId: result.eventId,
        factChangesApplied,
        htmlLink: result.htmlLink,
        sendUpdates: result.sendUpdates,
      },
    },
    detail:
      result.actionPerformed === 'created'
        ? 'Created the event in Google Calendar.'
        : 'Updated the existing Google Calendar event.',
  }
}

async function loadFactsForSession(userSub: string) {
  const { loadFactsContext } = await import('@/lib/server/facts')
  return loadFactsContext(userSub)
}

function mergeSourceInputs(left: ChatTurnInput['latestInputs'], right: ChatTurnInput['latestInputs']) {
  const seen = new Set<string>()
  return [...left, ...right].filter((input) => {
    if (seen.has(input.id)) {
      return false
    }
    seen.add(input.id)
    return true
  })
}

function fallbackAssistantText(artifact: ChatArtifact | null) {
  if (!artifact) {
    return 'Tell me the event details or drop in a screenshot, and I’ll turn it into a calendar draft.'
  }

  switch (artifact.kind) {
    case 'event-draft':
      return artifact.supportsGoogleActions
        ? 'I updated the draft. Review the card below, then create or update the event when it looks right.'
        : 'I updated the draft. Sign in with Google if you want attendee suggestions, conflict checks, or calendar write actions.'
    case 'event-success':
      return `The event was ${artifact.response.actionPerformed}.`
    case 'sign-in-required':
      return artifact.detail
  }
}

function signInArtifact(detail: string): Extract<ChatArtifact, { kind: 'sign-in-required' }> {
  return {
    kind: 'sign-in-required',
    detail,
  }
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

function summarizeToolResult(result: unknown) {
  if (!result || typeof result !== 'object') {
    return String(result)
  }

  if ('artifact' in result) {
    const artifact = (result as { artifact?: ChatArtifact | null }).artifact
    return artifact?.kind ?? 'none'
  }

  return 'object'
}
