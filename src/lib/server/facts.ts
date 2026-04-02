import type {
  FactChangeSet,
  FactRecord,
  FactsContext,
  SubmitEventRequest,
  SubmitEventResponse,
} from '@/lib/contracts'
import {
  emptyFactsContext,
  factChangeSetSchema,
  factsContextSchema,
  getSelectedAttendees,
} from '@/lib/contracts'
import { normalizeText } from '@/lib/domain/text'
import { decryptJson, encryptJson } from '@/lib/server/crypto'
import { logDebugError } from '@/lib/server/debug'
import { getServerEnv } from '@/lib/server/env'

const FACTS_PREFIX = 'facts'

export async function loadFactsContext(userSub: string): Promise<FactsContext> {
  const env = getServerEnv()
  const stored = await env.AUTH_KV.get(factsKey(userSub))
  if (!stored) {
    return emptyFactsContext
  }

  try {
    const facts = await decryptJson<FactRecord[]>(env.TOKEN_ENCRYPTION_SECRET, stored)
    return buildFactsContext(facts)
  } catch (error) {
    logDebugError('facts', 'loadFactsContext:decrypt-failed', error, { userSub })
    return emptyFactsContext
  }
}

export async function applyFactChangesForSubmission(
  userSub: string,
  request: SubmitEventRequest,
  response: Pick<SubmitEventResponse, 'actionPerformed'>,
) {
  const factsContext = await loadFactsContext(userSub)
  const nextFacts = [...factsContext.facts]
  const factChanges = createFactChangeSet(nextFacts, request, response.actionPerformed)
  if (
    factChanges.created.length === 0 &&
    factChanges.updated.length === 0 &&
    factChanges.staled.length === 0
  ) {
    return factChanges
  }

  await saveFacts(userSub, nextFacts)
  return factChanges
}

export function buildFactsContext(facts: FactRecord[]): FactsContext {
  const activeFacts = facts.filter((fact) => fact.status === 'active')
  const promptSummary = activeFacts
    .sort((left, right) => (right.lastConfirmedAt ?? '').localeCompare(left.lastConfirmedAt ?? ''))
    .slice(0, 20)
    .map((fact) => `${fact.kind}: ${fact.subject} -> ${fact.value}`)

  return factsContextSchema.parse({
    facts,
    promptSummary,
  })
}

async function saveFacts(userSub: string, facts: FactRecord[]) {
  const env = getServerEnv()
  await env.AUTH_KV.put(
    factsKey(userSub),
    await encryptJson(env.TOKEN_ENCRYPTION_SECRET, facts),
  )
}

function createFactChangeSet(
  facts: FactRecord[],
  request: SubmitEventRequest,
  actionPerformed: SubmitEventResponse['actionPerformed'],
): FactChangeSet {
  const changes = factChangeSetSchema.parse({})
  const now = new Date().toISOString()
  const titleHint = normalizeText(request.event.title)
  const selectedAttendees = getSelectedAttendees(request.attendeeGroups)

  for (const attendee of selectedAttendees) {
    if (attendee.source === 'manual' && !attendee.email) {
      continue
    }
    upsertFact({
      actionPerformed,
      changes,
      facts,
      kind: 'attendee-alias',
      now,
      reason: 'Confirmed attendee selection from review',
      subject: normalizeText(attendee.mention),
      value: attendee.email.toLowerCase(),
    })
  }

  const eventFactSpecs: Array<{ guard: unknown; kind: FactRecord['kind']; value: string | undefined | null; reason: string }> = [
    { guard: request.event.durationMinutes, kind: 'duration-pattern', value: request.event.durationMinutes ? String(request.event.durationMinutes) : null, reason: 'Confirmed event duration after calendar write' },
    { guard: request.event.location, kind: 'location-pattern', value: request.event.location?.trim(), reason: 'Confirmed event location after calendar write' },
    { guard: request.event.calendarId, kind: 'calendar-pattern', value: request.event.calendarId, reason: 'Confirmed calendar choice after calendar write' },
    { guard: request.event.recurrenceRule, kind: 'recurrence-pattern', value: request.event.recurrenceRule, reason: 'Confirmed recurrence after calendar write' },
    { guard: true, kind: 'title-pattern', value: request.event.title.trim(), reason: 'Confirmed title pattern after calendar write' },
  ]

  for (const spec of eventFactSpecs) {
    if (titleHint && spec.guard && spec.value) {
      upsertFact({ actionPerformed, changes, facts, kind: spec.kind, now, reason: spec.reason, subject: titleHint, value: spec.value })
    }
  }

  return changes
}

function upsertFact({
  actionPerformed,
  changes,
  facts,
  kind,
  now,
  reason,
  subject,
  value,
}: {
  actionPerformed: SubmitEventResponse['actionPerformed']
  changes: FactChangeSet
  facts: FactRecord[]
  kind: FactRecord['kind']
  now: string
  reason: string
  subject: string
  value: string
}) {
  if (!subject || !value) {
    return
  }

  const activeMatches = facts.filter(
    (fact) => fact.kind === kind && fact.subject === subject && fact.status === 'active',
  )
  const exact = activeMatches.find((fact) => fact.value === value)
  if (exact) {
    exact.confidence = Math.min(exact.confidence + 0.05, 0.99)
    exact.lastObservedAt = now
    exact.lastConfirmedAt = now
    return
  }

  for (const fact of activeMatches) {
    fact.status = 'stale'
    fact.lastObservedAt = now
    changes.staled.push({
      action: 'staled',
      kind,
      nextValue: null,
      previousValue: fact.value,
      reason: `${reason}; replaced by a newer confirmed value after ${actionPerformed}.`,
      subject,
    })
  }

  const nextFact: FactRecord = {
    id: crypto.randomUUID(),
    kind,
    subject,
    value,
    status: 'active',
    confidence: 0.85,
    source: 'user-confirmed',
    evidence: [reason],
    lastObservedAt: now,
    lastConfirmedAt: now,
  }
  facts.push(nextFact)

  const action = activeMatches.length > 0 ? 'updated' : 'created'
  changes[action].push({
    action,
    kind,
    nextValue: value,
    previousValue: activeMatches[0]?.value ?? null,
    reason,
    subject,
  })
}

function factsKey(userSub: string) {
  return `${FACTS_PREFIX}:${userSub}`
}
