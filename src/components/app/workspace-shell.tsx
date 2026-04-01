'use client'

import type { FileUIPart, UIMessage, UIMessageChunk } from 'ai'
import { useChat } from '@ai-sdk/react'
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '@/components/ai-elements/conversation'
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
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { EventDraftCard, EventSuccessCard, SignInRequiredCard } from '@/components/app/event-draft-card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { chatArtifactSchema, type ChatArtifact, type SourceInput, type SubmitEventRequest } from '@/lib/contracts'
import { chatTurnFn, submitEventFn } from '@/lib/server/server-fns'
import { CalendarDays, LogIn, LogOut, Paperclip, RotateCcw } from 'lucide-react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

type AppChatMessage = UIMessage<never, { chatArtifact: ChatArtifact }>
type TextSourceType = Extract<SourceInput, { kind: 'text' }>['sourceType']

const STORAGE_KEY = 'gcalthing-chat-session'

interface WorkspaceShellProps {
  viewer: {
    email: string
    name: string
    picture: string | null
    sub: string
  } | null
}

export function WorkspaceShell({ viewer }: WorkspaceShellProps) {
  const [currentArtifact, setCurrentArtifact] = useState<ChatArtifact | null>(null)
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false)
  const [textSourceType, setTextSourceType] = useState<TextSourceType>('pasted-text')
  const currentArtifactRef = useRef<ChatArtifact | null>(null)
  const textSourceTypeRef = useRef<TextSourceType>(textSourceType)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const localTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  )

  const transportRef = useRef(
    new WorkspaceChatTransport({
      getCurrentArtifact: () => currentArtifactRef.current,
      getTextSourceType: () => textSourceTypeRef.current,
      getLocalTimeZone: () => localTimeZone,
    }),
  )

  const { messages, sendMessage, setMessages, status, stop } = useChat<AppChatMessage>({
    dataPartSchemas: {
      chatArtifact: chatArtifactSchema,
    },
    id: 'workspace-chat',
    transport: transportRef.current,
  })

  useEffect(() => {
    currentArtifactRef.current = currentArtifact
  }, [currentArtifact])

  useEffect(() => {
    textSourceTypeRef.current = textSourceType
  }, [textSourceType])

  useEffect(() => {
    setCurrentArtifact((current) =>
      current?.kind === 'event-draft'
        ? {
            ...current,
            supportsGoogleActions: Boolean(viewer),
          }
        : current,
    )
  }, [viewer])

  // Restore session on mount
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        artifact: ChatArtifact | null
        messages: AppChatMessage[]
        textSourceType: TextSourceType
      }
      setMessages(parsed.messages ?? [])
      setCurrentArtifact(parsed.artifact ?? null)
      setTextSourceType(parsed.textSourceType ?? 'pasted-text')
    } catch {
      // ignore stale session storage
    }
  }, [setMessages])

  // Track latest artifact from messages
  useEffect(() => {
    const latestArtifactEntry = findLatestArtifact(messages)
    if (latestArtifactEntry) {
      setCurrentArtifact(latestArtifactEntry.artifact)
    }
  }, [messages])

  // Throttled session save
  useEffect(() => {
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          artifact: currentArtifact,
          messages,
          textSourceType,
        }),
      )
    }, 500)
    return () => clearTimeout(saveTimerRef.current)
  }, [currentArtifact, messages, textSourceType])

  const artifactMessageId = useMemo(() => {
    return findLatestArtifact(messages)?.messageId ?? null
  }, [messages])

  const pushAssistantArtifactMessage = useCallback(
    (text: string, artifact: ChatArtifact) => {
      const nextMessage: AppChatMessage = {
        id: crypto.randomUUID(),
        parts: [
          { text, type: 'text' },
          { data: artifact, type: 'data-chatArtifact' },
        ],
        role: 'assistant',
      }
      setMessages((current) => [...current, nextMessage])
      setCurrentArtifact(artifact)
    },
    [setMessages],
  )

  const handleSubmitDraft = useCallback(() => {
    const artifact = currentArtifactRef.current
    if (!artifact || artifact.kind !== 'event-draft') return

    if (!viewer) {
      pushAssistantArtifactMessage(
        'Sign in with Google before creating or updating calendar events.',
        {
          kind: 'sign-in-required',
          detail: 'Your draft is preserved. Sign in and I can continue from the same conversation.',
        },
      )
      return
    }

    const request: SubmitEventRequest = {
      action: artifact.draft.proposedAction,
      appendSourceDetails: true,
      attendeeGroups: artifact.draft.attendeeGroups,
      event: artifact.draft.event,
      extracted: artifact.draft.extracted,
      sourceInputs: artifact.sourceInputs,
    }

    setIsSubmittingDraft(true)
    startTransition(() => {
      void submitEventFn({ data: request })
        .then((response) => {
          pushAssistantArtifactMessage(
            response.actionPerformed === 'created'
              ? 'The event is on Google Calendar.'
              : 'The existing Google Calendar event is updated.',
            { kind: 'event-success', response },
          )
        })
        .catch((error) => {
          toast.error(getErrorMessage(error, 'Failed to write the event to Google Calendar.'))
        })
        .finally(() => setIsSubmittingDraft(false))
    })
  }, [pushAssistantArtifactMessage, viewer])

  const handlePromptSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (!message.text.trim() && message.files.length === 0) return
      await sendMessage({ files: message.files, text: message.text })
    },
    [sendMessage],
  )

  const handleSignIn = useCallback(() => {
    window.location.href = '/auth/login?returnTo=/app'
  }, [])

  const handleClearChat = useCallback(() => {
    stop()
    setMessages([])
    setCurrentArtifact(null)
    currentArtifactRef.current = null
    setIsSubmittingDraft(false)
    setTextSourceType('pasted-text')
    textSourceTypeRef.current = 'pasted-text'
    window.sessionStorage.removeItem(STORAGE_KEY)
  }, [setMessages, stop])

  const hasContent = messages.length > 0 || currentArtifact != null

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="size-5 text-[var(--primary)]" />
          <span className="text-sm font-semibold tracking-tight">GCalthing</span>
        </div>

        <div className="flex items-center gap-2">
          {hasContent && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleClearChat}
                  size="icon"
                  variant="ghost"
                  className="size-8"
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New conversation</TooltipContent>
            </Tooltip>
          )}

          {viewer ? (
            <>
              <div className="hidden items-center gap-2 sm:flex">
                <Avatar className="size-7">
                  <AvatarImage alt={viewer.name} src={viewer.picture ?? undefined} />
                  <AvatarFallback className="text-xs">
                    {viewer.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-[var(--muted-foreground)]">{viewer.name.split(' ')[0]}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild size="icon" variant="ghost" className="size-8">
                    <a aria-label="Sign out" href="/auth/logout">
                      <LogOut className="size-3.5" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sign out</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Button onClick={handleSignIn} size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <LogIn className="size-3.5" />
              Sign in
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-6">
        <Conversation className="flex-1">
          <ConversationContent className="gap-4 py-4">
            {messages.length === 0 && (
              <ConversationEmptyState
                description=""
                icon={<CalendarDays className="size-8 text-[var(--primary)]" />}
                title=""
              >
                <div className="flex flex-col items-center gap-3 pt-[12vh] text-center">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    What event do you need scheduled?
                  </h1>
                  <p className="max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
                    Paste text, drop a screenshot, or just describe it. I'll draft the calendar event for your review.
                  </p>
                </div>
              </ConversationEmptyState>
            )}

            {messages.map((message) => {
              const messageText = getMessageText(message)
              const messageFiles = message.parts.filter((part) => part.type === 'file')
              const artifact = getArtifactForMessage(message, artifactMessageId, currentArtifact)

              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent className="w-full max-w-none">
                    {message.role === 'assistant' ? (
                      messageText ? <MessageResponse>{messageText}</MessageResponse> : null
                    ) : (
                      <div className="space-y-2">
                        {messageText && <p className="whitespace-pre-wrap leading-relaxed">{messageText}</p>}
                        {messageFiles.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {messageFiles.map((file) => (
                              <UserFilePreview key={`${message.id}:${file.url}`} file={file} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {artifact?.kind === 'event-draft' && (
                      <EventDraftCard
                        artifact={artifact}
                        isSaving={isSubmittingDraft}
                        onSignIn={handleSignIn}
                        onSubmit={handleSubmitDraft}
                      />
                    )}
                    {artifact?.kind === 'event-success' && (
                      <EventSuccessCard artifact={artifact} />
                    )}
                    {artifact?.kind === 'sign-in-required' && (
                      <SignInRequiredCard artifact={artifact} onSignIn={handleSignIn} />
                    )}
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
            maxFiles={4}
            onSubmit={handlePromptSubmit}
          >
            <PromptInputBody>
              <PromptInputTextarea placeholder="Describe an event, paste an email, or ask me to revise..." />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger tooltip="Attach">
                    <Paperclip className="size-4" />
                  </PromptInputActionMenuTrigger>
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                    <PromptInputActionAddScreenshot />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>

                <Select
                  value={textSourceType}
                  onValueChange={(value) => setTextSourceType(value as TextSourceType)}
                >
                  <SelectTrigger className="h-7 w-[140px] border-none bg-transparent text-xs text-[var(--muted-foreground)] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pasted-text">Pasted text</SelectItem>
                    <SelectItem value="email-body">Email body</SelectItem>
                    <SelectItem value="forwarded-email">Forwarded email</SelectItem>
                    <SelectItem value="manual">Manual note</SelectItem>
                  </SelectContent>
                </Select>
              </PromptInputTools>

              <PromptInputSubmit onStop={stop} status={status} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </main>
    </div>
  )
}

class WorkspaceChatTransport {
  constructor(
    private readonly options: {
      getCurrentArtifact: () => ChatArtifact | null
      getLocalTimeZone: () => string
      getTextSourceType: () => TextSourceType
    },
  ) {}

  async sendMessages({
    messages,
  }: {
    messages: AppChatMessage[]
  }): Promise<ReadableStream<UIMessageChunk<never, { chatArtifact: ChatArtifact }>>> {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    const latestInputs = latestUserMessage
      ? toSourceInputs(latestUserMessage, this.options.getTextSourceType())
      : []
    const history = messages
      .filter(
        (message): message is AppChatMessage & { role: 'assistant' | 'user' } =>
          message.role === 'assistant' || message.role === 'user',
      )
      .map((message) => ({
        role: message.role,
        text: getMessageText(message),
      }))
    const response = await chatTurnFn({
      data: {
        currentArtifact: this.options.getCurrentArtifact(),
        history,
        latestInputs,
        localTimeZone: this.options.getLocalTimeZone(),
      },
    })

    return createAssistantMessageStream(response)
  }

  async reconnectToStream() {
    return null
  }
}

function createAssistantMessageStream(response: Awaited<ReturnType<typeof chatTurnFn>>) {
  const textPartId = crypto.randomUUID()
  const textChunks = chunkText(response.text)

  return new ReadableStream<UIMessageChunk<never, { chatArtifact: ChatArtifact }>>({
    start(controller) {
      controller.enqueue({
        messageId: crypto.randomUUID(),
        type: 'start',
      })
      controller.enqueue({
        id: textPartId,
        type: 'text-start',
      })
      for (const chunk of textChunks) {
        controller.enqueue({
          delta: chunk,
          id: textPartId,
          type: 'text-delta',
        })
      }
      controller.enqueue({
        id: textPartId,
        type: 'text-end',
      })
      if (response.artifact) {
        controller.enqueue({
          data: response.artifact,
          type: 'data-chatArtifact',
        })
      }
      controller.enqueue({
        finishReason: 'stop',
        type: 'finish',
      })
      controller.close()
    },
  })
}

function chunkText(text: string) {
  if (!text) return ['']
  return text.match(/.{1,48}(\s|$)/g) ?? [text]
}

function getMessageText(message: AppChatMessage) {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function toSourceInputs(message: AppChatMessage, textSourceType: TextSourceType): SourceInput[] {
  const text = getMessageText(message).trim()
  const inputs: SourceInput[] = []

  if (text) {
    inputs.push({
      kind: 'text',
      id: crypto.randomUUID(),
      label:
        textSourceType === 'email-body'
          ? 'Email body'
          : textSourceType === 'forwarded-email'
            ? 'Forwarded email'
            : textSourceType === 'manual'
              ? 'Manual note'
              : 'Pasted text',
      sourceType: textSourceType,
      text,
    })
  }

  for (const part of message.parts) {
    if (part.type !== 'file' || !part.mediaType.startsWith('image/')) continue
    inputs.push({
      dataUrl: part.url,
      filename: part.filename,
      id: crypto.randomUUID(),
      kind: 'image',
      label: part.filename ?? 'Image upload',
      mediaType: part.mediaType,
    })
  }

  return inputs
}

function findLatestArtifact(messages: AppChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    for (let j = message.parts.length - 1; j >= 0; j--) {
      const part = message.parts[j]
      if (part.type === 'data-chatArtifact') {
        return { artifact: part.data, messageId: message.id }
      }
    }
  }
  return null
}

function getArtifactForMessage(
  message: AppChatMessage,
  artifactMessageId: string | null,
  currentArtifact: ChatArtifact | null,
) {
  if (artifactMessageId === message.id && currentArtifact) {
    return currentArtifact
  }
  const part = message.parts.find((item) => item.type === 'data-chatArtifact')
  return part?.data ?? null
}

function UserFilePreview({ file }: { file: FileUIPart }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      {file.mediaType.startsWith('image/') && (
        <img
          alt={file.filename ?? 'Uploaded image'}
          className="max-h-48 w-auto object-cover"
          src={file.url}
        />
      )}
      <div className="px-3 py-1.5 text-xs text-[var(--muted-foreground)]">
        {file.filename ?? file.mediaType}
      </div>
    </div>
  )
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}
