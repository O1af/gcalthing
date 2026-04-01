import { getServerEnv } from '@/lib/server/env'

type DebugValue = string | number | boolean | null | undefined | string[]

export function logDebug(scope: string, message: string, details?: Record<string, DebugValue>) {
  if (!isDebugEnabled()) {
    return
  }

  if (details && Object.keys(details).length > 0) {
    console.info(`[debug:${scope}] ${message}`, details)
    return
  }

  console.info(`[debug:${scope}] ${message}`)
}

export function logDebugError(
  scope: string,
  message: string,
  error: unknown,
  details?: Record<string, DebugValue>,
) {
  if (!isDebugEnabled()) {
    return
  }

  const payload = {
    ...details,
    error: error instanceof Error ? error.message : String(error),
  }
  console.error(`[debug:${scope}] ${message}`, payload)
}

export async function withDebugTiming<T>(
  scope: string,
  message: string,
  run: () => Promise<T>,
  details?: Record<string, DebugValue>,
) {
  const startedAt = Date.now()
  logDebug(scope, `${message}:start`, details)

  try {
    const result = await run()
    logDebug(scope, `${message}:done`, {
      ...details,
      durationMs: Date.now() - startedAt,
    })
    return result
  } catch (error) {
    logDebugError(scope, `${message}:failed`, error, {
      ...details,
      durationMs: Date.now() - startedAt,
    })
    throw error
  }
}

function isDebugEnabled() {
  const env = getServerEnv()
  return env.AI_DEBUG === '1' || env.APP_URL.includes('localhost')
}
