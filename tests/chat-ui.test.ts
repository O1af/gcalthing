import { describe, expect, it } from 'vitest'
import {
  getGoogleCalendarToolLabel,
  getGoogleCalendarToolSummary,
  type GoogleCalendarToolUIPart,
} from '@/lib/chat-ui'

function toolPart(
  overrides: Partial<GoogleCalendarToolUIPart>,
): GoogleCalendarToolUIPart {
  return {
    input: undefined,
    providerExecuted: undefined,
    state: 'input-available',
    toolCallId: 'tool-call-1',
    type: 'tool-search_events',
    ...overrides,
  } as GoogleCalendarToolUIPart
}

describe('chat UI tool summaries', () => {
  it('maps tool names to compact labels', () => {
    expect(
      getGoogleCalendarToolLabel(toolPart({ type: 'tool-check_availability' })),
    ).toBe('Check availability')
  })

  it('uses concise active summaries for tool calls', () => {
    expect(
      getGoogleCalendarToolSummary(toolPart({ type: 'tool-search_events' })),
    ).toBe('Looking for matching events.')
  })

  it('uses concise completed summaries for tool results', () => {
    expect(
      getGoogleCalendarToolSummary(
        toolPart({
          state: 'output-available',
          type: 'tool-create_event',
        }),
      ),
    ).toBe('Created the calendar event.')
  })

  it('falls back to approval-specific summaries when needed', () => {
    expect(
      getGoogleCalendarToolSummary(
        toolPart({
          approval: { approved: false },
          state: 'approval-responded',
          type: 'tool-delete_event',
        }),
      ),
    ).toBe('This calendar change was not approved.')
  })
})
