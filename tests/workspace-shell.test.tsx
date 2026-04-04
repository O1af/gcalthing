// @vitest-environment jsdom

import * as React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceShell } from '@/components/app/workspace-shell'
import type { AppChatMessage } from '@/lib/chat-ui'

type MockChatState = {
  messages: AppChatMessage[]
  status: 'ready' | 'submitted' | 'streaming' | 'error'
}

type MatchMediaListener = (event: MediaQueryListEvent) => void

type StickToBottomMockState = {
  contentRef: { current: HTMLElement | null }
  escapedFromLock: boolean
  isAtBottom: boolean
  scrollRef: { current: HTMLElement | null }
  scrollToBottom: ReturnType<typeof vi.fn<() => boolean>>
  state: Record<string, never>
  stopScroll: ReturnType<typeof vi.fn<() => void>>
}

const subscribers = new Set<(state: MockChatState) => void>()
let chatState: MockChatState = {
  messages: [],
  status: 'ready',
}
const { stickToBottomState } = vi.hoisted(() => ({
  stickToBottomState: {
    contentRef: { current: null },
    escapedFromLock: false,
    isAtBottom: true,
    scrollRef: { current: null },
    scrollToBottom: vi.fn<() => boolean>(() => true),
    state: {},
    stopScroll: vi.fn<() => void>(() => {}),
  } as StickToBottomMockState,
}))

function resetStickToBottomState() {
  stickToBottomState.contentRef.current = null
  stickToBottomState.escapedFromLock = false
  stickToBottomState.isAtBottom = true
  stickToBottomState.scrollRef.current = null
  stickToBottomState.scrollToBottom.mockClear()
  stickToBottomState.stopScroll.mockClear()
}

function emitChatState(nextState: MockChatState) {
  chatState = nextState
  for (const subscriber of subscribers) {
    subscriber(chatState)
  }
}

function createTextMessage(
  role: AppChatMessage['role'],
  text: string,
  id = `${role}-${chatState.messages.length + 1}`,
): AppChatMessage {
  return {
    id,
    metadata: undefined,
    parts: text ? [{ text, type: 'text' }] : [],
    role,
  } as AppChatMessage
}

const sendMessageMock = vi.fn<(message: { text: string }) => Promise<void>>(async ({ text }) => {
  emitChatState({
    messages: [...chatState.messages, createTextMessage('user', text)],
    status: 'submitted',
  })
})

const addToolApprovalResponseMock = vi.fn<
  (response: { approved: boolean; id: string }) => Promise<void>
>(async () => {})

const stopMock = vi.fn<() => void>(() => {
  emitChatState({
    ...chatState,
    status: 'ready',
  })
})

const setMessagesMock = vi.fn<
  (value: AppChatMessage[] | ((messages: AppChatMessage[]) => AppChatMessage[])) => void
>((value) => {
  emitChatState({
    ...chatState,
    messages: typeof value === 'function' ? value(chatState.messages) : value,
  })
})

vi.mock('@ai-sdk/react', () => ({
  useChat: () => {
    const [state, setState] = React.useState(chatState)

    React.useEffect(() => {
      subscribers.add(setState)
      return () => {
        subscribers.delete(setState)
      }
    }, [])

    return {
      addToolApprovalResponse: addToolApprovalResponseMock,
      messages: state.messages,
      sendMessage: sendMessageMock,
      setMessages: setMessagesMock,
      status: state.status,
      stop: stopMock,
    }
  },
}))

vi.mock('use-stick-to-bottom', () => {
  const StickToBottomContext = React.createContext(stickToBottomState)

  function StickToBottom({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    children: React.ReactNode | ((context: StickToBottomMockState) => React.ReactNode)
  }) {
    return (
      <StickToBottomContext.Provider value={stickToBottomState}>
        <div {...props}>
          {typeof children === 'function' ? children(stickToBottomState) : children}
        </div>
      </StickToBottomContext.Provider>
    )
  }

  StickToBottom.Content = function StickToBottomContent({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    children: React.ReactNode | ((context: StickToBottomMockState) => React.ReactNode)
  }) {
    return (
      <div {...props}>
        {typeof children === 'function' ? children(stickToBottomState) : children}
      </div>
    )
  }

  return {
    StickToBottom,
    useStickToBottom: () => stickToBottomState,
    useStickToBottomContext: () => React.useContext(StickToBottomContext),
  }
})

describe('WorkspaceShell', () => {
  beforeEach(() => {
    chatState = {
      messages: [],
      status: 'ready',
    }
    resetStickToBottomState()
    sendMessageMock.mockClear()
    addToolApprovalResponseMock.mockClear()
    setMessagesMock.mockClear()
    stopMock.mockClear()
    const addEventListenerMock = vi.fn<
      MediaQueryList['addEventListener']
    >()
    const addListenerMock = vi.fn<(listener: MatchMediaListener) => void>()
    const dispatchEventMock = vi.fn<(event: Event) => boolean>()
    const removeEventListenerMock = vi.fn<
      MediaQueryList['removeEventListener']
    >()
    const removeListenerMock = vi.fn<(listener: MatchMediaListener) => void>()

    window.matchMedia = vi.fn<(query: string) => MediaQueryList>().mockImplementation((query) => ({
      addEventListener: addEventListenerMock as MediaQueryList['addEventListener'],
      addListener: addListenerMock,
      dispatchEvent: dispatchEventMock,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: removeEventListenerMock as MediaQueryList['removeEventListener'],
      removeListener: removeListenerMock,
    }))
  })

  afterEach(() => {
    subscribers.clear()
    cleanup()
  })

  it('shows a small top-right login control without the old empty-state sign-in button', () => {
    const { container } = render(<WorkspaceShell viewer={null} />)

    const topAuthLink = container.querySelector('[data-slot="workspace-top-auth"] a')
    expect(topAuthLink).not.toBeNull()
    expect(topAuthLink?.textContent).toBe('Log in')
  })

  it('keeps sign out in the sidebar for a signed-in viewer', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <WorkspaceShell
        viewer={{
          email: 'olaf@example.com',
          name: 'Olaf D',
          picture: null,
          sub: 'viewer-1',
        }}
      />,
    )

    const topAuth = container.querySelector('[data-slot="workspace-top-auth"]')
    expect(topAuth?.textContent).toBe('')
    await user.click(screen.getByRole('button', { name: /Olaf D/ }))
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy()
  })

  it('submitting a message scrolls to the live edge without rendering a response runway', async () => {
    const user = userEvent.setup()
    const { container } = render(<WorkspaceShell viewer={null} />)
    const textbox = container.querySelector('textarea')
    expect(textbox).toBeTruthy()

    await user.type(textbox!, 'Plan lunch tomorrow')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({
        files: [],
        text: 'Plan lunch tomorrow',
      })
    })

    expect(stickToBottomState.scrollToBottom).toHaveBeenCalledWith('smooth')
    expect(container.querySelector('[data-slot="response-runway"]')).toBeNull()
  })

  it('hides the scroll-to-bottom control when already at the bottom', () => {
    emitChatState({
      messages: [
        createTextMessage('assistant', 'Already caught up', 'assistant-1'),
      ],
      status: 'ready',
    })

    render(<WorkspaceShell viewer={null} />)

    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull()
  })

  it('shows the scroll-to-bottom control when away from the bottom and uses it', async () => {
    const user = userEvent.setup()
    stickToBottomState.isAtBottom = false
    emitChatState({
      messages: [
        createTextMessage('assistant', 'Catch up available', 'assistant-1'),
      ],
      status: 'ready',
    })

    render(<WorkspaceShell viewer={null} />)

    await user.click(screen.getByRole('button', { name: 'Scroll to bottom' }))

    expect(stickToBottomState.scrollToBottom).toHaveBeenCalled()
  })

  it('renders approval controls for approval-requested tools', async () => {
    const user = userEvent.setup()
    emitChatState({
      messages: [
        {
          id: 'assistant-approval',
          metadata: undefined,
          parts: [
            {
              approval: { id: 'approval-1' },
              input: {
                date: '2026-04-05',
                startTime: '12:00',
                title: 'Lunch',
              },
              state: 'approval-requested',
              toolCallId: 'tool-call-approval',
              type: 'tool-create_event',
            },
          ],
          role: 'assistant',
        } as AppChatMessage,
      ],
      status: 'ready',
    })

    render(<WorkspaceShell viewer={null} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(addToolApprovalResponseMock).toHaveBeenCalledWith({
      approved: true,
      id: 'approval-1',
    })
  })

  it('renders success and sign-in cards from tool outputs', () => {
    emitChatState({
      messages: [
        {
          id: 'assistant-tools',
          metadata: undefined,
          parts: [
            {
              input: {},
              output: {
                actionPerformed: 'created',
                calendarId: 'primary',
                detail: 'Created the event in Google Calendar.',
                eventId: 'evt-1',
                htmlLink: 'https://calendar.google.com/event?eid=abc',
                sendUpdates: false,
                status: 'ok',
              },
              state: 'output-available',
              toolCallId: 'tool-call-create',
              type: 'tool-create_event',
            },
            {
              input: {},
              output: {
                detail: 'Sign in with Google to search your calendar events.',
                status: 'sign-in-required',
              },
              state: 'output-available',
              toolCallId: 'tool-call-search',
              type: 'tool-search_events',
            },
          ],
          role: 'assistant',
        } as AppChatMessage,
      ],
      status: 'ready',
    })

    render(<WorkspaceShell viewer={null} />)

    expect(screen.getByText('Event created')).toBeTruthy()
    expect(screen.getByText('Google sign-in needed')).toBeTruthy()
  })
})
