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
  PromptInputActionMenuItem,
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { chatArtifactSchema, type ChatArtifact, type SourceInput, type SubmitEventRequest } from '@/lib/contracts'
import { chatTurnFn, submitEventFn } from '@/lib/server/server-fns'
import { Bot, ImageIcon, LogIn, LogOut, MessageSquareText, Paperclip, Sparkles, Trash2 } from 'lucide-react'
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
  const [artifactMessageId, setArtifactMessageId] = useState<string | null>(null)
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false)
  const [textSourceType, setTextSourceType] = useState<TextSourceType>('pasted-text')
  const currentArtifactRef = useRef<ChatArtifact | null>(null)
  const textSourceTypeRef = useRef<TextSourceType>(textSourceType)
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

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY)
      if (!raw) {
        return
      }
      const parsed = JSON.parse(raw) as {
        artifact: ChatArtifact | null
        artifactMessageId: string | null
        messages: AppChatMessage[]
        textSourceType: TextSourceType
      }
      setMessages(parsed.messages ?? [])
      setCurrentArtifact(parsed.artifact ?? null)
      setArtifactMessageId(parsed.artifactMessageId ?? null)
      setTextSourceType(parsed.textSourceType ?? 'pasted-text')
    } catch {
      // ignore stale session storage
    }
  }, [setMessages])

  useEffect(() => {
    const latestArtifactEntry = findLatestArtifact(messages)
    if (!latestArtifactEntry) {
      return
    }
    setCurrentArtifact(latestArtifactEntry.artifact)
    setArtifactMessageId(latestArtifactEntry.messageId)
  }, [messages])

  useEffect(() => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        artifact: currentArtifact,
        artifactMessageId,
        messages,
        textSourceType,
      }),
    )
  }, [artifactMessageId, currentArtifact, messages, textSourceType])

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
      setArtifactMessageId(nextMessage.id)
    },
    [setMessages],
  )

  const handleSubmitDraft = useCallback(() => {
    const artifact = currentArtifactRef.current
    if (!artifact || artifact.kind !== 'event-draft') {
      return
    }

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
            {
              kind: 'event-success',
              response,
            },
          )
        })
        .catch((error) => {
          toast.error(getErrorMessage(error, 'Failed to write the event to Google Calendar.'))
        })
        .finally(() => {
          setIsSubmittingDraft(false)
        })
    })
  }, [pushAssistantArtifactMessage, viewer])

  const handlePromptSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (!message.text.trim() && message.files.length === 0) {
        return
      }

      await sendMessage({
        files: message.files,
        text: message.text,
      })
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
    setArtifactMessageId(null)
    setIsSubmittingDraft(false)
    setTextSourceType('pasted-text')
    textSourceTypeRef.current = 'pasted-text'
    window.sessionStorage.removeItem(STORAGE_KEY)
    toast.success('Cleared the current chat.')
  }, [setMessages, stop])

  return (
    <main className="page-shell flex min-h-screen flex-col px-4 pb-8 pt-5 sm:px-6">
      <header className="mb-4 flex items-center justify-between gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-[var(--shadow-panel)] backdrop-blur">
        <div className="flex items-start gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">GCalthing</Badge>
              <Badge variant="secondary">AI scheduling copilot</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Paste text, drop a screenshot, or keep drafting in chat.
            </p>
          </div>

          <Button
            disabled={messages.length === 0 && currentArtifact == null}
            onClick={handleClearChat}
            size="sm"
            variant="outline"
          >
            <Trash2 className="size-4" />
            Clear chat
          </Button>
        </div>

        {viewer ? (
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{viewer.name}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{viewer.email}</p>
            </div>
            <Avatar className="size-10 border border-[var(--border)]">
              <AvatarImage alt={viewer.name} src={viewer.picture ?? undefined} />
              <AvatarFallback>
                {viewer.name
                  .split(' ')
                  .map((part) => part[0])
                  .join('')
                  .slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <Button asChild size="icon" variant="outline">
              <a aria-label="Sign out" href="/auth/logout">
                <LogOut className="size-4" />
              </a>
            </Button>
          </div>
        ) : (
          <Button onClick={handleSignIn}>
            <LogIn className="size-4" />
            Sign in with Google
          </Button>
        )}
      </header>

      <section className="glass-panel fade-up flex flex-1 flex-col overflow-hidden rounded-[2rem] border-white/40">
        <Conversation className="min-h-[60vh]">
          <ConversationContent className="gap-5 p-4 sm:p-6">
            {messages.length === 0 ? (
              <ConversationEmptyState
                description="Try “coffee with Alex tomorrow afternoon” or drop in an email screenshot."
                icon={<Bot className="size-10" />}
                title="Start with messy event info"
              >
                <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
                  <div className="rounded-full bg-[var(--primary-soft)] p-4 text-[var(--primary)]">
                    <Sparkles className="size-8" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold">One chat, all scheduling actions</h2>
                    <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                      I can extract an event draft from text or images, enrich it with recent
                      calendar context when you are signed in, and create or update the event after
                      your review.
                    </p>
                  </div>
                </div>
              </ConversationEmptyState>
            ) : null}

            {messages.map((message) => {
              const messageText = getMessageText(message)
              const messageFiles = message.parts.filter((part) => part.type === 'file')
              const artifact = getArtifactForMessage(message, artifactMessageId, currentArtifact)

              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent className="w-full max-w-[58rem]">
                    {message.role === 'assistant' ? (
                      messageText ? <MessageResponse>{messageText}</MessageResponse> : null
                    ) : (
                      <div className="space-y-3">
                        {messageText ? <p className="whitespace-pre-wrap leading-6">{messageText}</p> : null}
                        {messageFiles.length > 0 ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {messageFiles.map((file) => (
                              <UserFilePreview key={`${message.id}:${file.url}`} file={file} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {artifact?.kind === 'event-draft' ? (
                      <EventDraftCard
                        artifact={artifact}
                        isSaving={isSubmittingDraft}
                        onSignIn={handleSignIn}
                        onSubmit={handleSubmitDraft}
                      />
                    ) : null}

                    {artifact?.kind === 'event-success' ? (
                      <EventSuccessCard artifact={artifact} />
                    ) : null}

                    {artifact?.kind === 'sign-in-required' ? (
                      <SignInRequiredCard artifact={artifact} onSignIn={handleSignIn} />
                    ) : null}
                  </MessageContent>
                </Message>
              )
            })}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t border-[var(--border)] px-4 py-4 sm:px-6">
          <PromptInput
            accept="image/*"
            className="w-full"
            maxFiles={4}
            onSubmit={handlePromptSubmit}
          >
            <PromptInputBody>
              <PromptInputTextarea placeholder="Describe the event, paste an email, or ask me to revise the current draft..." />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger tooltip="Add attachments">
                    <Paperclip className="size-4" />
                  </PromptInputActionMenuTrigger>
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                    <PromptInputActionAddScreenshot />
                    <PromptInputActionMenuItem disabled>
                      <MessageSquareText className="mr-2 size-4" />
                      Chat accepts pasted text directly
                    </PromptInputActionMenuItem>
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>

                <div className="hidden sm:block">
                  <Select
                    value={textSourceType}
                    onValueChange={(value) => setTextSourceType(value as TextSourceType)}
                  >
                    <SelectTrigger className="h-8 w-[160px]">
                      <SelectValue placeholder="Text source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pasted-text">Pasted text</SelectItem>
                      <SelectItem value="email-body">Email body</SelectItem>
                      <SelectItem value="forwarded-email">Forwarded email</SelectItem>
                      <SelectItem value="manual">Manual note</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="hidden items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted-foreground)] md:flex">
                  <ImageIcon className="size-3.5" />
                  Images and screenshots supported
                </div>
              </PromptInputTools>

              <PromptInputSubmit onStop={stop} status={status} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </section>
    </main>
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
  if (!text) {
    return ['']
  }

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
    if (part.type !== 'file' || !part.mediaType.startsWith('image/')) {
      continue
    }
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
  for (const message of [...messages].reverse()) {
    const part = [...message.parts].reverse().find((item) => item.type === 'data-chatArtifact')
    if (part) {
      return {
        artifact: part.data,
        messageId: message.id,
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

function UserFilePreview({
  file,
}: {
  file: FileUIPart
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--secondary)]">
      {file.mediaType.startsWith('image/') ? (
        <img
          alt={file.filename ?? 'Uploaded image'}
          className="aspect-[4/3] w-full object-cover"
          src={file.url}
        />
      ) : null}
      <div className="px-3 py-2 text-sm text-[var(--muted-foreground)]">
        {file.filename ?? file.mediaType}
      </div>
    </div>
  )
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}
