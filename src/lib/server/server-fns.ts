import { createServerFn } from '@tanstack/react-start'
import {
  buildDraftInputSchema,
  chatTurnInputSchema,
  refreshReviewDraftRequestSchema,
  reviewDraftSchema,
  assistantTurnResponseSchema,
  submitEventRequestSchema,
  submitEventResponseSchema,
} from '@/lib/contracts'
import { logDebug, withDebugTiming } from '@/lib/server/debug'

export const getViewerSnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  const { getViewer } = await import('@/lib/server/auth')
  return getViewer()
})

export const buildDraft = createServerFn({ method: 'POST' })
  .inputValidator(buildDraftInputSchema)
  .handler(async ({ data }) => {
    return withDebugTiming('server-fn', 'buildDraft', async () => {
      const { getSessionContext } = await import('@/lib/server/auth')
      const { extractStructuredDraft } = await import('@/lib/server/extraction')
      const { loadFactsContext } = await import('@/lib/server/facts')
      const {
        buildExtractionOnlyReviewDraft,
        buildInitialReviewDraft,
      } = await import('@/lib/server/review-draft')
      const session = await getSessionContext()
      const factsContext = session ? await loadFactsContext(session.profile.sub) : { facts: [], promptSummary: [] }
      const extracted = await extractStructuredDraft(data, factsContext)
      const reviewDraft = session
        ? await buildInitialReviewDraft({
            accessToken: session.tokens.accessToken,
            extracted,
            input: data,
            userSub: session.profile.sub,
          })
        : await buildExtractionOnlyReviewDraft({
            extracted,
            input: data,
          })

      logDebug('server-fn', 'buildDraft:result', {
        calendarCount: reviewDraft.calendars.length,
        signedIn: Boolean(session),
        title: reviewDraft.event.title || '(untitled)',
      })

      return reviewDraftSchema.parse(reviewDraft)
    }, {
      inputCount: data.inputs.length,
      localTimeZone: data.localTimeZone,
    })
  })

export const refreshReviewDraftFn = createServerFn({ method: 'POST' })
  .inputValidator(refreshReviewDraftRequestSchema)
  .handler(async ({ data }) => {
    return withDebugTiming('server-fn', 'refreshReviewDraft', async () => {
      const { getSessionContext } = await import('@/lib/server/auth')
      const {
        refreshExtractionOnlyDraftState,
        refreshReviewDraftState,
      } = await import('@/lib/server/review-draft')
      const session = await getSessionContext()
      const reviewDraft = session
        ? await refreshReviewDraftState({
            accessToken: session.tokens.accessToken,
            request: data,
            userSub: session.profile.sub,
          })
        : await refreshExtractionOnlyDraftState({
            request: data,
          })

      logDebug('server-fn', 'refreshReviewDraft:result', {
        blockerCount: reviewDraft.reviewBlockers.length,
        hasConflict: reviewDraft.conflictCheck.hasConflict,
        signedIn: Boolean(session),
        title: reviewDraft.event.title || '(untitled)',
      })

      return reviewDraftSchema.parse(reviewDraft)
    }, {
      localTimeZone: data.localTimeZone,
      title: data.draft.event.title || '(untitled)',
    })
  })

export const chatTurnFn = createServerFn({ method: 'POST' })
  .inputValidator(chatTurnInputSchema)
  .handler(async ({ data }) => {
    const { runAssistantTurn } = await import('@/lib/server/chat')
    return assistantTurnResponseSchema.parse(await runAssistantTurn(data))
  })

export const submitEventFn = createServerFn({ method: 'POST' })
  .inputValidator(submitEventRequestSchema)
  .handler(async ({ data }) => {
    return withDebugTiming('server-fn', 'submitEvent', async () => {
      const { requireSessionContext } = await import('@/lib/server/auth')
      const {
        createGoogleCalendarEvent,
        listWritableCalendars,
        updateGoogleCalendarEvent,
      } = await import('@/lib/server/google-calendar')
      const { applyFactChangesForSubmission } = await import('@/lib/server/facts')
      const session = await requireSessionContext()
      const calendars = await listWritableCalendars(session.tokens.accessToken)
      const calendarNameById = new Map(calendars.map((calendar) => [calendar.id, calendar.summary]))

      const result =
        data.action.type === 'update'
          ? await updateGoogleCalendarEvent(
              session.tokens.accessToken,
              data.action.eventId,
              data.action.calendarId,
              data,
              calendarNameById,
            )
          : await createGoogleCalendarEvent(
              session.tokens.accessToken,
              data,
              calendarNameById,
            )

      const factChangesApplied = await applyFactChangesForSubmission(
        session.profile.sub,
        data,
        { actionPerformed: result.actionPerformed },
      )

      logDebug('server-fn', 'submitEvent:result', {
        action: result.actionPerformed,
        calendarId: result.calendarId,
        factChangeCount:
          factChangesApplied.created.length +
          factChangesApplied.updated.length +
          factChangesApplied.staled.length,
        title: data.event.title || '(untitled)',
      })

      return submitEventResponseSchema.parse({
        actionPerformed: result.actionPerformed,
        calendarId: result.calendarId,
        eventId: result.eventId,
        factChangesApplied,
        htmlLink: result.htmlLink,
        sendUpdates: result.sendUpdates,
      })
    }, {
      action: data.action.type,
      attendeeCount: data.attendeeGroups.length,
      calendarId: data.event.calendarId,
      title: data.event.title || '(untitled)',
    })
  })
