import { ToolLoopAgent } from 'ai'
import { z } from 'zod'
import { executionModeSchema, factsContextSchema, type ExecutionMode, type FactRecord } from '@/lib/contracts'
import { getOpenAIModel } from '@/lib/server/ai-model'
import { getServerEnv } from '@/lib/server/env'
import type { GoogleCalendarEvent, GoogleCalendarListEntry } from '@/lib/server/google-calendar'
import { buildChatSystemPrompt } from '@/lib/server/chat-system-prompt'
import { createCalendarToolSet, type CalendarAgentContext } from './tool-definitions'
import type { SessionContext } from './index'

export interface CalendarAgentCallOptions extends CalendarAgentContext {
  signedIn: boolean
}

const calendarAgentCallOptionsSchema = z
  .object({
    calendars: z.array(z.any()),
    executionMode: executionModeSchema,
    facts: factsContextSchema,
    localTimeZone: z.string(),
    nearTermEvents: z.array(z.any()),
    signedIn: z.boolean(),
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
    onFinish: undefined,
    prepareCall: async ({ options, ...baseCall }) => ({
      ...baseCall,
      experimental_context: options,
      instructions: buildChatSystemPrompt({
        calendars: options?.calendars ?? [],
        executionMode: options?.executionMode ?? 'approval-first',
        facts: options?.facts ?? [],
        localTimeZone: options?.localTimeZone ?? 'UTC',
        nearTermEvents: options?.nearTermEvents ?? [],
        signedIn: options?.signedIn ?? false,
      }),
    }),
    tools: createCalendarToolSet(writeNeedsApproval),
  })
}

export function buildCalendarAgentOptions(params: {
  calendars: GoogleCalendarListEntry[]
  executionMode: ExecutionMode
  facts: FactRecord[]
  localTimeZone: string
  nearTermEvents: GoogleCalendarEvent[]
  session: SessionContext | null
}): CalendarAgentCallOptions {
  return {
    calendars: params.calendars,
    executionMode: params.executionMode,
    facts: params.facts,
    localTimeZone: params.localTimeZone,
    nearTermEvents: params.nearTermEvents,
    session: params.session,
    signedIn: Boolean(params.session),
  }
}
