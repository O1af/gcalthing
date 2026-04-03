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

const subscribers = new Set<(state: MockChatState) => void>()
let chatState: MockChatState = {
  messages: [],
  status: 'ready',
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
      messages: state.messages,
      sendMessage: sendMessageMock,
      setMessages: setMessagesMock,
      status: state.status,
      stop: stopMock,
    }
  },
}))

describe('WorkspaceShell', () => {
  beforeEach(() => {
    chatState = {
      messages: [],
      status: 'ready',
    }
    sendMessageMock.mockClear()
    setMessagesMock.mockClear()
    stopMock.mockClear()
    HTMLElement.prototype.scrollTo = vi.fn<() => void>()
    const addEventListenerMock = vi.fn<
      (type: string, listener: MatchMediaListener) => void
    >()
    const addListenerMock = vi.fn<(listener: MatchMediaListener) => void>()
    const dispatchEventMock = vi.fn<(event: Event) => boolean>()
    const removeEventListenerMock = vi.fn<
      (type: string, listener: MatchMediaListener) => void
    >()
    const removeListenerMock = vi.fn<(listener: MatchMediaListener) => void>()

    window.matchMedia = vi.fn<(query: string) => MediaQueryList>().mockImplementation((query) => ({
      addEventListener: addEventListenerMock,
      addListener: addListenerMock,
      dispatchEvent: dispatchEventMock,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: removeEventListenerMock,
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
    expect(screen.queryByRole('link', { name: 'Sign in with Google' })).toBeNull()
  })

  it('keeps the signed-in account chip in the top-right and sign out in the sidebar', () => {
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
    expect(topAuth?.textContent).toContain('Olaf')
    expect(screen.getByRole('link', { name: 'Sign out' })).toBeTruthy()
  })

  it('scrolls the latest user message into the top region and shows a response runway on submit', async () => {
    const user = userEvent.setup()
    const { container } = render(<WorkspaceShell viewer={null} />)

    await user.type(
      screen.getByRole('textbox', { name: 'Ask about your calendar or describe a change' }),
      'Plan lunch tomorrow',
    )
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(container.querySelector('[data-slot="response-runway"]')).not.toBeNull()
    })

    const runway = container.querySelector('[data-slot="response-runway"]')
    expect(runway?.className).toContain('min-h-[clamp(18rem,40vh,28rem)]')
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled()
  })

  it('re-anchors the runway to the next user message on a second turn', async () => {
    const user = userEvent.setup()
    const { container } = render(<WorkspaceShell viewer={null} />)

    await user.type(
      screen.getByRole('textbox', {
        name: 'Ask about your calendar or describe a change',
      }),
      'First turn',
    )
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(container.querySelector('[data-slot="response-runway"]')).not.toBeNull()
    })

    emitChatState({
      messages: [
        ...chatState.messages,
        createTextMessage('assistant', 'First response'),
      ],
      status: 'ready',
    })

    await user.type(
      screen.getByRole('textbox', {
        name: 'Ask about your calendar or describe a change',
      }),
      'Second turn',
    )
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(
        container.querySelector('[data-slot="response-runway"]'),
      ).toBeTruthy()
    })
  })
})
