'use client'

import { DefaultChatTransport, type FileUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'
import { EventSuccessCard, SignInRequiredCard } from '@/components/app/chat-notice-card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AppChatMessage } from '@/lib/chat-ui'
import {
  getMessageFiles,
  getMessageNotice,
  getMessageReasoningText,
  getMessageText,
  isMessageReasoningStreaming,
} from '@/lib/chat-ui'
import {
  chatNoticeSchema,
  executionModeSchema,
  type ExecutionMode,
} from '@/lib/contracts'
import { CalendarDays, CircleHelp, LogIn, LogOut, Paperclip, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

const EXECUTION_MODE_KEY = 'gcalthing-execution-mode'
const FAQ_ITEMS = [
  {
    answer:
      'Ask questions, paste messy notes, or attach files into the composer. The assistant decides whether to answer directly, inspect your calendar, or prepare a write.',
    question: 'What can I send here?',
  },
  {
    answer:
      'Approval-first asks for a chat confirmation before writes. Direct execution lets explicit complete requests run immediately.',
    question: 'How does execution mode work?',
  },
  {
    answer:
      'Sign in with Google to inspect calendars, search events, check availability, and write changes. Without sign-in, the assistant can still chat but cannot access Google Calendar.',
    question: 'Why sign in?',
  },
] as const

interface WorkspaceShellProps {
  viewer: {
    email: string
    name: string
    picture: string | null
    sub: string
  } | null
}

export function WorkspaceShell({ viewer }: WorkspaceShellProps) {
  const [executionMode, setExecutionMode] = useExecutionMode()
  const { messages, sendMessage, setMessages, status, stop } =
    useWorkspaceChat(executionMode)

  const handleClearChat = useCallback(() => {
    stop()
    setMessages([])
  }, [stop, setMessages])

  const handlePromptSubmit = useCallback(async (message: PromptInputMessage) => {
    if (!message.text.trim() && message.files.length === 0) {
      return
    }

    await sendMessage({
      files: message.files,
      text: message.text,
    })
  }, [sendMessage])

  const handleSuggestionClick = useCallback((text: string) => {
    void sendMessage({ files: [], text })
  }, [sendMessage])

  const hasContent = messages.length > 0

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="size-5 text-[var(--primary)]" />
          <span className="text-sm font-semibold tracking-tight">GCalthing</span>
        </div>

        <div className="flex items-center gap-2">
          <Select onValueChange={setExecutionMode} value={executionMode}>
            <SelectTrigger className="hidden min-w-38 sm:flex" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="approval-first">Approval first</SelectItem>
              <SelectItem value="direct-execution">Direct execution</SelectItem>
            </SelectContent>
          </Select>

          {hasContent ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button aria-label="New conversation" className="size-8" onClick={handleClearChat} size="icon" variant="ghost">
                  <RotateCcw className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New conversation</TooltipContent>
            </Tooltip>
          ) : null}

          {viewer ? (
            <>
              <div className="hidden items-center gap-2 sm:flex">
                <Avatar className="size-7">
                  <AvatarImage alt={viewer.name} src={viewer.picture ?? undefined} />
                  <AvatarFallback className="text-xs">
                    {viewer.name
                      .split(' ')
                      .map((part) => part[0])
                      .join('')
                      .slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {viewer.name.split(' ')[0]}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild className="size-8" size="icon" variant="ghost">
                    <a aria-label="Sign out" href="/auth/logout">
                      <LogOut className="size-3.5" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sign out</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Button asChild className="h-8 gap-1.5 text-xs" size="sm" variant="outline">
              <a href="/auth/login?returnTo=/">
                <LogIn className="size-3.5" />
                Sign in
              </a>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden px-4 pb-4">
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-4 py-4">
            {messages.length === 0 ? (
              <ConversationEmptyState
                className="overflow-hidden"
                description=""
                icon={<CalendarDays className="size-8 text-[var(--primary)]" />}
                title=""
              >
                <EmptyWorkspaceState
                  onSuggestionClick={handleSuggestionClick}
                  viewer={viewer}
                />
              </ConversationEmptyState>
            ) : null}

            {messages.map((message) => {
              const notice = getMessageNotice(message)
              const messageFiles = getMessageFiles(message)
              const messageReasoning = getMessageReasoningText(message)
              const messageText = getMessageText(message)

              if (message.role === 'user') {
                return (
                  <Message from="user" key={message.id}>
                    <MessageContent>
                      {messageText ? <p className="whitespace-pre-wrap leading-relaxed">{messageText}</p> : null}
                      {messageFiles.length > 0 ? <ChatAttachments files={messageFiles} /> : null}
                    </MessageContent>
                  </Message>
                )
              }

              return (
                <div className="flex w-full flex-col gap-3" key={message.id}>
                  {messageReasoning ? (
                    <Reasoning isStreaming={isMessageReasoningStreaming(message)}>
                      <ReasoningTrigger />
                      <ReasoningContent>{messageReasoning}</ReasoningContent>
                    </Reasoning>
                  ) : null}
                  {messageText ? <MessageResponse className="text-sm">{messageText}</MessageResponse> : null}
                  {notice?.kind === 'event-success' ? <EventSuccessCard notice={notice} /> : null}
                  {notice?.kind === 'sign-in-required' ? (
                    <SignInRequiredCard notice={notice} />
                  ) : null}
                </div>
              )
            })}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="shrink-0 pt-2">
          <PromptInput
            canSubmit={status !== 'submitted' && status !== 'streaming'}
            className="w-full"
            globalDrop
            maxFiles={4}
            onSubmit={handlePromptSubmit}
          >
            <PromptInputHeader>
              <ComposerAttachments />
            </PromptInputHeader>
            <PromptInputBody>
              <PromptInputTextarea placeholder="Ask about your calendar or describe a change" />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <ComposerAttachButton />
              </PromptInputTools>

              <PromptInputSubmit onStop={stop} status={status} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </main>
    </div>
  )
}

function useExecutionMode(): [ExecutionMode, (nextMode: string) => void] {
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('approval-first')

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(EXECUTION_MODE_KEY)
      const parsed = executionModeSchema.safeParse(stored)
      if (parsed.success) {
        setExecutionMode(parsed.data)
      }
    } catch {
      // Ignore stale local storage.
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(EXECUTION_MODE_KEY, executionMode)
    } catch {
      // Ignore local storage write failures.
    }
  }, [executionMode])

  const handleExecutionModeChange = useCallback((nextMode: string) => {
    const parsed = executionModeSchema.safeParse(nextMode)
    if (parsed.success) {
      setExecutionMode(parsed.data)
    }
  }, [])

  return [executionMode, handleExecutionModeChange]
}

function useWorkspaceChat(executionMode: ExecutionMode) {
  const executionModeRef = useRef(executionMode)
  const localTimeZoneRef = useRef(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const transportRef = useRef<DefaultChatTransport<AppChatMessage> | null>(null)

  useEffect(() => {
    executionModeRef.current = executionMode
  }, [executionMode])

  if (!transportRef.current) {
    transportRef.current = new DefaultChatTransport<AppChatMessage>({
      api: '/api/chat',
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          executionMode: executionModeRef.current,
          localTimeZone: localTimeZoneRef.current,
          messages,
        },
      }),
    })
  }

  return useChat<AppChatMessage>({
    dataPartSchemas: {
      chatNotice: chatNoticeSchema,
    },
    id: 'workspace-chat',
    transport: transportRef.current,
  })
}

function ComposerAttachments(): React.JSX.Element | null {
  const { files, remove } = usePromptInputAttachments()
  if (files.length === 0) {
    return null
  }

  return <ChatAttachments files={files} onRemove={remove} />
}

function ComposerAttachButton(): React.JSX.Element {
  const { fileInputId } = usePromptInputAttachments()

  return (
    <label htmlFor={fileInputId} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-within:ring-2 focus-within:ring-ring">
      <Paperclip className="size-4" />
      <span className="sr-only">Attach file</span>
    </label>
  )
}

function ChatAttachments(props: {
  files: Array<FileUIPart | (FileUIPart & { id: string })>
  onRemove?: (id: string) => void
}): React.JSX.Element {
  const { files, onRemove } = props
  const variant = onRemove ? 'grid' : 'list'
  const attachments = files.map((file, index) => ({
    ...file,
    id: 'id' in file ? file.id : `${file.url}:${index}`,
  }))

  return (
    <Attachments className="ml-0 w-full justify-start" variant={variant}>
      {attachments.map((file) => (
        <Attachment
          data={file}
          key={file.id}
          onRemove={onRemove ? () => onRemove(file.id) : undefined}
          title={file.filename ?? file.mediaType}
        >
          <AttachmentPreview />
          {onRemove ? <AttachmentRemove /> : <AttachmentInfo showMediaType />}
        </Attachment>
      ))}
    </Attachments>
  )
}

function EmptyWorkspaceState(props: {
  onSuggestionClick: (text: string) => void
  viewer: WorkspaceShellProps['viewer']
}): React.JSX.Element {
  const { onSuggestionClick, viewer } = props

  return (
    <div className="relative flex w-full flex-col items-center gap-4 px-4 pt-8 text-center">
      <div className="pointer-events-none absolute inset-x-16 top-10 -z-10 h-40 rounded-full bg-[radial-gradient(circle_at_center,rgba(39,110,241,0.14),transparent_70%)] blur-2xl" />

      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          A conversational Google Calendar assistant
        </h1>
        <p className="mx-auto max-w-2xl text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
          Ask what is on your schedule, check availability, find something to edit, or describe a
          new event in plain language. The assistant will answer directly when it can and use
          Google Calendar tools only when needed.
        </p>
      </div>

      <Suggestions className="max-w-2xl justify-center">
        <Suggestion onClick={onSuggestionClick} suggestion="What's on my calendar today?" />
        <Suggestion onClick={onSuggestionClick} suggestion="Am I free tomorrow afternoon?" />
        <Suggestion onClick={onSuggestionClick} suggestion="Schedule a meeting for\u2026" />
      </Suggestions>

      <div className="flex w-full max-w-2xl items-start justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 px-4 py-4 text-left backdrop-blur">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {viewer ? `Signed in as ${viewer.email}` : 'Sign in for live calendar access'}
          </p>
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            {viewer
              ? 'Search calendars, inspect events, check availability, and make changes without leaving the chat.'
              : 'Without Google sign-in the assistant can still discuss plans, but calendar reads and writes stay unavailable.'}
          </p>
          {!viewer ? (
            <Button asChild className="mt-3 h-8 gap-1.5" size="sm">
              <a href="/auth/login?returnTo=/">
                <LogIn className="size-3.5" />
                Sign in with Google
              </a>
            </Button>
          ) : null}
        </div>

        <HoverCard openDelay={100}>
          <HoverCardTrigger asChild>
            <Button aria-label="FAQ" className="size-8 shrink-0" size="icon" variant="ghost">
              <CircleHelp className="size-4" />
            </Button>
          </HoverCardTrigger>
          <HoverCardContent align="end" className="w-80 space-y-3">
            <p className="text-sm font-medium">FAQ</p>
            {FAQ_ITEMS.map((item) => (
              <div className="space-y-1" key={item.question}>
                <p className="text-sm font-medium">{item.question}</p>
                <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                  {item.answer}
                </p>
              </div>
            ))}
          </HoverCardContent>
        </HoverCard>
      </div>
    </div>
  )
}
