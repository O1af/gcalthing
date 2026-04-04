import { ToolLoopAgent, stepCountIs } from 'ai'
import { z } from 'zod'
import { executionModeSchema, sourceInputSchema, type ExecutionMode, type SourceInput } from '@/lib/contracts'
import { getOpenAIModel } from '@/lib/server/ai-model'
import { logDebug } from '@/lib/server/debug'
import { getServerEnv } from '@/lib/server/env'
import type { GoogleCalendarListEntry } from '@/lib/server/google-calendar'
import { buildChatSystemPrompt } from '@/lib/server/chat-system-prompt'
import { createCalendarToolSet, type CalendarAgentContext } from './tool-definitions'
import type { SessionContext } from './index'

export interface CalendarAgentCallOptions extends CalendarAgentContext {
  signedIn: boolean
}

const calendarAgentCallOptionsSchema = z
  .object({
    executionMode: executionModeSchema,
    latestUserText: z.string(),
    localTimeZone: z.string(),
    signedIn: z.boolean(),
    sourceInputs: z.array(sourceInputSchema),
    turnId: z.string(),
  })
  .passthrough() as unknown as z.ZodType<CalendarAgentCallOptions>

const agentCache = new Map<
  string,
  {
    approval: ToolLoopAgent<CalendarAgentCallOptions, ReturnType<typeof createCalendarToolSet>>
    direct: ToolLoopAgent<CalendarAgentCallOptions, ReturnType<typeof createCalendarToolSet>>
  }
>()

export function getCalendarAgents() {
  const env = getServerEnv()
  const cached = agentCache.get(env.OPENAI_MODEL)
  if (cached) {
    return cached
  }

  const model = getOpenAIModel(env.OPENAI_MODEL)
  const direct = createCalendarAgent({
    id: 'calendar-direct-agent',
    model,
    writeNeedsApproval: false,
  })
  const approval = createCalendarAgent({
    id: 'calendar-approval-agent',
    model,
    writeNeedsApproval: true,
  })
  const agents = { approval, direct }
  agentCache.set(env.OPENAI_MODEL, agents)
  return agents
}

function createCalendarAgent(params: {
  id: string
  model: ReturnType<typeof getOpenAIModel>
  writeNeedsApproval: boolean
}) {
  const { id, model, writeNeedsApproval } = params

  return new ToolLoopAgent<CalendarAgentCallOptions, ReturnType<typeof createCalendarToolSet>>({
    callOptionsSchema: calendarAgentCallOptionsSchema,
    id,
    model,
    onFinish: ({ experimental_context, text }) => {
      const context = experimental_context as CalendarAgentCallOptions | undefined
      logDebug('ai:chat', 'turn:done', {
        responseTextLength: text.trim().length,
        turnId: context?.turnId ?? 'unknown',
      })
    },
    prepareCall: async ({ options, ...baseCall }) => ({
      ...baseCall,
      experimental_context: options,
      instructions: buildChatSystemPrompt({
        executionMode: options?.executionMode ?? 'approval-first',
        signedIn: options?.signedIn ?? false,
      }),
    }),
    stopWhen: stepCountIs(6),
    tools: createCalendarToolSet(writeNeedsApproval),
  })
}

export function buildCalendarAgentOptions(params: {
  executionMode: ExecutionMode
  getCalendars: (() => Promise<GoogleCalendarListEntry[]>) | null
  latestUserText: string
  localTimeZone: string
  session: SessionContext | null
  sourceInputs: SourceInput[]
  turnId: string
}): CalendarAgentCallOptions {
  return {
    executionMode: params.executionMode,
    getCalendars: params.getCalendars,
    latestUserText: params.latestUserText,
    localTimeZone: params.localTimeZone,
    session: params.session,
    signedIn: Boolean(params.session),
    sourceInputs: params.sourceInputs,
    turnId: params.turnId,
  }
}
