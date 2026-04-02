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
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
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
import { useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'gcalthing-chat-session'
const EXECUTION_MODE_KEY = 'gcalthing-execution-mode'
const FAQ_ITEMS = [
  {
    answer:
      'Ask questions, paste messy notes, or drop screenshots into the composer. The assistant decides whether to answer directly, inspect your calendar, or prepare a write.',
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
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('approval-first')
  const executionModeRef = useRef<ExecutionMode>('approval-first')
  const localTimeZoneRef = useRef(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const transportRef = useRef<DefaultChatTransport<AppChatMessage> | null>(null)

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

  const { messages, sendMessage, setMessages, status, stop } = useChat<AppChatMessage>({
    dataPartSchemas: {
      chatNotice: chatNoticeSchema,
    },
    id: 'workspace-chat',
    transport: transportRef.current,
  })

  useEffect(() => {
    executionModeRef.current = executionMode
  }, [executionMode])

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

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY)
      if (!raw) {
        return
      }

      const parsed = JSON.parse(raw) as {
        messages: AppChatMessage[]
      }

      setMessages(parsed.messages ?? [])
    } catch {
      // Ignore stale session storage.
    }
  }, [setMessages])

  useEffect(() => {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          messages,
        }),
      )
    }, 500)

    return () => clearTimeout(saveTimerRef.current)
  }, [messages])

  function handleClearChat(): void {
    stop()
    setMessages([])
    window.sessionStorage.removeItem(STORAGE_KEY)
  }

  function handleExecutionModeChange(nextMode: string): void {
    const parsed = executionModeSchema.safeParse(nextMode)
    if (parsed.success) {
      setExecutionMode(parsed.data)
    }
  }

  async function handlePromptSubmit(message: PromptInputMessage): Promise<void> {
    if (!message.text.trim() && message.files.length === 0) {
      return
    }

    await sendMessage({
      files: message.files,
      text: message.text,
    })
  }

  function handleSignIn(): void {
    window.location.href = '/auth/login?returnTo=/'
  }

  const hasContent = messages.length > 0

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="size-5 text-[var(--primary)]" />
          <span className="text-sm font-semibold tracking-tight">GCalthing</span>
        </div>

        <div className="flex items-center gap-2">
          <Select onValueChange={handleExecutionModeChange} value={executionMode}>
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
                <Button className="size-8" onClick={handleClearChat} size="icon" variant="ghost">
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
            <Button className="h-8 gap-1.5 text-xs" onClick={handleSignIn} size="sm" variant="outline">
              <LogIn className="size-3.5" />
              Sign in
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-6">
        <Conversation className="flex-1">
          <ConversationContent className="gap-4 py-4">
            {messages.length === 0 ? (
              <ConversationEmptyState
                description=""
                icon={<CalendarDays className="size-8 text-[var(--primary)]" />}
                title=""
              >
                <EmptyWorkspaceState executionMode={executionMode} onSignIn={handleSignIn} viewer={viewer} />
              </ConversationEmptyState>
            ) : null}

            {messages.map((message) => {
              const notice = getMessageNotice(message)
              const messageFiles = getMessageFiles(message)
              const messageReasoning = getMessageReasoningText(message)
              const messageText = getMessageText(message)

              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent className="w-full max-w-none space-y-3">
                    {message.role === 'assistant' ? (
                      <>
                        {messageReasoning ? (
                          <Reasoning isStreaming={isMessageReasoningStreaming(message)}>
                            <ReasoningTrigger />
                            <ReasoningContent>{messageReasoning}</ReasoningContent>
                          </Reasoning>
                        ) : null}
                        {messageText ? <MessageResponse>{messageText}</MessageResponse> : null}
                      </>
                    ) : (
                      <div className="space-y-3">
                        {messageText ? <p className="whitespace-pre-wrap leading-relaxed">{messageText}</p> : null}
                        {messageFiles.length > 0 ? <ChatAttachments files={messageFiles} /> : null}
                      </div>
                    )}

                    {notice?.kind === 'event-success' ? <EventSuccessCard notice={notice} /> : null}
                    {notice?.kind === 'sign-in-required' ? (
                      <SignInRequiredCard notice={notice} onSignIn={handleSignIn} />
                    ) : null}
                  </MessageContent>
                </Message>
              )
            })}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="pt-2">
          <PromptInput
            accept="image/*"
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
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger tooltip="Attach">
                    <Paperclip className="size-4" />
                  </PromptInputActionMenuTrigger>
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments label="Add photo" />
                    <PromptInputActionAddScreenshot />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
              </PromptInputTools>

              <PromptInputSubmit onStop={stop} status={status} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </main>
    </div>
  )
}

function ComposerAttachments(): React.JSX.Element | null {
  const { files, remove } = usePromptInputAttachments()
  if (files.length === 0) {
    return null
  }

  return <ChatAttachments files={files} onRemove={remove} />
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
  executionMode: ExecutionMode
  onSignIn: () => void
  viewer: WorkspaceShellProps['viewer']
}): React.JSX.Element {
  const { executionMode, onSignIn, viewer } = props

  return (
    <div className="relative flex w-full flex-col items-center gap-6 px-4 pt-[12vh] text-center">
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

      <div className="flex w-full max-w-2xl flex-wrap items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
        <span className="rounded-full border border-[var(--border)] px-3 py-1">Ask naturally</span>
        <span className="rounded-full border border-[var(--border)] px-3 py-1">Drop screenshots</span>
        <span className="rounded-full border border-[var(--border)] px-3 py-1">
          {executionMode === 'approval-first' ? 'Confirms before writes' : 'Executes explicit writes'}
        </span>
      </div>

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
            <Button className="mt-3 h-8 gap-1.5" onClick={onSignIn} size="sm">
              <LogIn className="size-3.5" />
              Sign in with Google
            </Button>
          ) : null}
        </div>

        <HoverCard openDelay={100}>
          <HoverCardTrigger asChild>
            <Button className="size-8 shrink-0" size="icon" variant="ghost">
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
