import type { FactRecord } from '@/lib/contracts'
import { factsContextSchema } from '@/lib/contracts'
import { decryptJson, encryptJson } from '@/lib/server/crypto'
import { logDebugError } from '@/lib/server/debug'
import { getServerEnv } from '@/lib/server/env'

const FACTS_PREFIX = 'facts'

// In-flight mutation queue per user — prevents parallel tool calls from clobbering each other
const locks = new Map<string, Promise<unknown>>()

function withLock<T>(userSub: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(userSub) ?? Promise.resolve()
  const next = prev.then(fn)
  locks.set(userSub, next.catch(() => {}))
  return next
}

export async function loadFacts(userSub: string): Promise<FactRecord[]> {
  const env = getServerEnv()
  const stored = await env.AUTH_KV.get(factsKey(userSub))
  if (!stored) return []

  try {
    const raw = await decryptJson<unknown>(env.TOKEN_ENCRYPTION_SECRET, stored)
    return factsContextSchema.parse(raw)
  } catch (error) {
    logDebugError('facts', 'loadFacts:decrypt-failed', error, { userSub })
    return []
  }
}

export function addFact(userSub: string, fact: string): Promise<FactRecord> {
  return withLock(userSub, async () => {
    const facts = await loadFacts(userSub)
    const record: FactRecord = {
      id: crypto.randomUUID(),
      fact,
      addedAt: new Date().toISOString(),
    }
    facts.push(record)
    await saveFacts(userSub, facts)
    return record
  })
}

export function removeFact(userSub: string, factId: string): Promise<boolean> {
  return withLock(userSub, async () => {
    const facts = await loadFacts(userSub)
    const index = facts.findIndex((f) => f.id === factId)
    if (index === -1) return false
    facts.splice(index, 1)
    await saveFacts(userSub, facts)
    return true
  })
}

async function saveFacts(userSub: string, facts: FactRecord[]) {
  const env = getServerEnv()
  await env.AUTH_KV.put(
    factsKey(userSub),
    await encryptJson(env.TOKEN_ENCRYPTION_SECRET, facts),
  )
}

function factsKey(userSub: string) {
  return `${FACTS_PREFIX}:${userSub}`
}
