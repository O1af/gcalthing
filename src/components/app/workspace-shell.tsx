'use client'

import { DefaultChatTransport, type FileUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@/components/ai-elements/attachments'
import {
  ConversationBody,
  ConversationEmptyState,
  ConversationRoot,
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
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import type { AppChatMessage } from '@/lib/chat-ui'
import { cn } from '@/lib/utils'
import {
  getGoogleCalendarToolLabel,
  getGoogleCalendarSignInDetail,
  getGoogleCalendarToolSummary,
  getGoogleCalendarWriteSuccess,
  getMessageFiles,
  getMessageReasoningText,
  getMessageGoogleCalendarToolParts,
  getMessageText,
  isMessageReasoningStreaming,
  type GoogleCalendarToolUIPart,
} from '@/lib/chat-ui'
import {
  executionModeSchema, type ExecutionMode
} from '@/lib/contracts'
import {
  CalendarDays,
  ChevronsUpDown,
  Clock3,
  ListChecks,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  PanelLeft,
  Paperclip,
  Settings,
  SquarePen,
  Sun,
} from 'lucide-react'
import { useStickToBottom } from 'use-stick-to-bottom'
import { useCallback, useEffect, useRef, useState } from 'react'

type WorkspaceChatStatus = ReturnType<typeof useWorkspaceChat>['status']

const EXECUTION_MODE_KEY = 'gcalthing-execution-mode'
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
  const { addToolApprovalResponse, messages, sendMessage, setMessages, status, stop } =
    useWorkspaceChat(executionMode)
  const [openChainMessageId, setOpenChainMessageId] = useState<string | null>(null)
  const [manuallyClosedChainMessageIds, setManuallyClosedChainMessageIds] = useState<
    Record<string, true>
  >({})
  const conversation = useStickToBottom({
    initial: 'smooth',
    resize: 'smooth',
  })

  const isResponding = status === 'submitted' || status === 'streaming'
  const lastMessage = messages.at(-1)

  const handleClearChat = useCallback(() => {
    stop()
    setMessages([])
    setOpenChainMessageId(null)
    setManuallyClosedChainMessageIds({})
  }, [stop, setMessages])

  const handlePromptSubmit = useCallback(async (message: PromptInputMessage) => {
    if (!message.text.trim() && message.files.length === 0) {
      return
    }

    void Promise.resolve(conversation.scrollToBottom('smooth'))
    await sendMessage({
      files: message.files,
      text: message.text,
    })
  }, [conversation, sendMessage])

  const handleSuggestionClick = useCallback((text: string) => {
    void Promise.resolve(conversation.scrollToBottom('smooth'))
    void sendMessage({ files: [], text })
  }, [conversation, sendMessage])

  const handleToolChainOpenChange = useCallback((messageId: string, open: boolean) => {
    if (open) {
      setOpenChainMessageId(messageId)
      setManuallyClosedChainMessageIds((current) => {
        if (!(messageId in current)) {
          return current
        }

        const next = { ...current }
        delete next[messageId]
        return next
      })
      return
    }

    setOpenChainMessageId((current) => (current === messageId ? null : current))
    setManuallyClosedChainMessageIds((current) => ({
      ...current,
      [messageId]: true,
    }))
  }, [])

  useEffect(() => {
    if (
      isResponding &&
      lastMessage?.role === 'assistant' &&
      !manuallyClosedChainMessageIds[lastMessage.id]
    ) {
      setOpenChainMessageId(lastMessage.id)
      return
    }

    if (isResponding && lastMessage?.role === 'user') {
      setOpenChainMessageId(null)
    }
  }, [isResponding, lastMessage, manuallyClosedChainMessageIds])

  const hasContent = messages.length > 0
  const shouldShowPendingAssistantMessage =
    isResponding && lastMessage?.role !== 'assistant'

  const renderMessageRow = useCallback((message: AppChatMessage, index: number) => (
    <div data-message-id={message.id} data-slot="chat-message-row" key={message.id}>
      <ChatMessageRow
        addToolApprovalResponse={addToolApprovalResponse}
        isChainOpen={openChainMessageId === message.id}
        isResponding={isResponding}
        message={message}
        onToolChainOpenChange={handleToolChainOpenChange}
        showStreamingIndicator={index === messages.length - 1}
      />
    </div>
  ), [
    addToolApprovalResponse,
    handleToolChainOpenChange,
    isResponding,
    messages.length,
    openChainMessageId,
  ])

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': '14.5rem',
        } as React.CSSProperties
      }
    >
      <Sidebar collapsible="icon">
        <WorkspaceSidebar
          executionMode={executionMode}
          onClearChat={handleClearChat}
          onExecutionModeChange={setExecutionMode}
          viewer={viewer}
        />
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <div
          ref={conversation.scrollRef}
          className="relative flex h-dvh flex-col overflow-y-auto"
          data-slot="workspace-main-scroll"
        >
          <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <SidebarTrigger className="size-8 rounded-lg md:hidden" />
            <TopAuthControl
              hasContent={hasContent}
              onClearChat={handleClearChat}
              viewer={viewer}
            />
          </header>

          <main
            ref={conversation.contentRef}
            className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 pb-4 sm:px-6"
          >
            <ConversationRoot className="flex-1" instance={conversation}>
              {messages.length === 0 ? (
                <ConversationEmptyState
                  className="overflow-visible"
                  description=""
                  icon={null}
                  title=""
                >
                  <EmptyWorkspaceState
                    onPromptSubmit={handlePromptSubmit}
                    onSuggestionClick={handleSuggestionClick}
                    status={status}
                    stop={stop}
                    viewer={viewer}
                  />
                </ConversationEmptyState>
              ) : (
                <>
                  <ConversationBody className="flex-1 py-6 pb-28">
                    {messages.map(renderMessageRow)}
                    {shouldShowPendingAssistantMessage ? (
                      <PendingAssistantMessage />
                    ) : null}
                  </ConversationBody>
                  <ConversationScrollButton containerClassName="bottom-24 z-20" />
                </>
              )}

              {hasContent ? (
                <div className="sticky bottom-0 shrink-0 bg-background/92 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                  <WorkspaceComposer
                    onSubmit={handlePromptSubmit}
                    status={status}
                    stop={stop}
                    variant="dock"
                  />
                </div>
              ) : null}
            </ConversationRoot>
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function readStoredExecutionMode(): ExecutionMode {
  try {
    const stored = window.localStorage.getItem(EXECUTION_MODE_KEY)
    const parsed = executionModeSchema.safeParse(stored)
    if (parsed.success) return parsed.data
  } catch {
    // Ignore stale local storage.
  }
  return 'approval-first'
}

function useExecutionMode(): [ExecutionMode, (nextMode: string) => void] {
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(readStoredExecutionMode)

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
    id: 'workspace-chat',
    transport: transportRef.current,
  })
}

function ChatMessageRow(props: {
  addToolApprovalResponse: (response: {
    approved: boolean
    id: string
  }) => void | PromiseLike<void>
  isChainOpen: boolean
  isResponding: boolean
  message: AppChatMessage
  onToolChainOpenChange: (messageId: string, open: boolean) => void
  showStreamingIndicator: boolean
}): React.JSX.Element {
  const {
    addToolApprovalResponse,
    isChainOpen,
    isResponding,
    message,
    onToolChainOpenChange,
    showStreamingIndicator,
  } = props
  const messageFiles = getMessageFiles(message)
  const messageReasoning = getMessageReasoningText(message)
  const messageText = getMessageText(message)
  const toolParts = getMessageGoogleCalendarToolParts(message)
  let signInDetail: string | null = null
  let successResult: ReturnType<typeof getGoogleCalendarWriteSuccess> = null
  const approvalRequestedParts: Extract<GoogleCalendarToolUIPart, { state: 'approval-requested' }>[] = []
  for (const part of toolParts) {
    signInDetail ??= getGoogleCalendarSignInDetail(part)
    successResult ??= getGoogleCalendarWriteSuccess(part)
    if (part.state === 'approval-requested') approvalRequestedParts.push(part)
  }

  if (message.role === 'user') {
    return (
      <Message from="user">
        <MessageContent>
          {messageText ? <p className="whitespace-pre-wrap leading-relaxed">{messageText}</p> : null}
          {messageFiles.length > 0 ? <ChatAttachments files={messageFiles} /> : null}
        </MessageContent>
      </Message>
    )
  }

  const showReasoning =
    messageReasoning.length > 0 || (showStreamingIndicator && isResponding && toolParts.length === 0)

  return (
    <div className="flex w-full flex-col gap-3">
      {toolParts.length > 0 ? (
        <CalendarToolChain
          isOpen={isChainOpen}
          onOpenChange={(open) => onToolChainOpenChange(message.id, open)}
          toolParts={toolParts}
        />
      ) : null}
      {showReasoning ? (
        <Reasoning
          isStreaming={
            showStreamingIndicator &&
            (isResponding || isMessageReasoningStreaming(message))
          }
        >
          <ReasoningTrigger />
          {messageReasoning ? (
            <ReasoningContent>{messageReasoning}</ReasoningContent>
          ) : null}
        </Reasoning>
      ) : null}
      {messageText ? <MessageResponse className="text-sm">{messageText}</MessageResponse> : null}
      {approvalRequestedParts.map((toolPart) => (
        <ToolApprovalCard
          key={toolPart.toolCallId}
          onRespond={(approved) =>
            addToolApprovalResponse({
              approved,
              id: toolPart.approval.id,
            })
          }
          toolPart={toolPart}
        />
      ))}
      {successResult ? <EventSuccessCard result={successResult} /> : null}
      {signInDetail ? <SignInRequiredCard detail={signInDetail} /> : null}
    </div>
  )
}

function PendingAssistantMessage(): React.JSX.Element {
  return (
    <div className="flex w-full flex-col gap-3">
      <Reasoning isStreaming>
        <ReasoningTrigger />
      </Reasoning>
    </div>
  )
}

function CalendarToolChain(props: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  toolParts: GoogleCalendarToolUIPart[]
}): React.JSX.Element {
  const { isOpen, onOpenChange, toolParts } = props
  const hasActiveTool = toolParts.some(isToolPartActive)

  return (
    <ChainOfThought onOpenChange={onOpenChange} open={isOpen}>
      <ChainOfThoughtHeader>
        <ListChecks className="size-4" />
        <span className="font-medium">Google Calendar activity</span>
        <Badge className="ml-1" variant="outline">
          {toolParts.length}
        </Badge>
        {hasActiveTool ? (
          <Badge variant="secondary">
            <Clock3 className="size-3" />
            Running
          </Badge>
        ) : null}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent className="space-y-2">
        {toolParts.map((toolPart) => (
          <ChainOfThoughtStep
            description={getGoogleCalendarToolSummary(toolPart)}
            key={toolPart.toolCallId}
            label={getGoogleCalendarToolLabel(toolPart)}
            status={getToolStepStatus(toolPart)}
          />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}

function isToolPartActive(toolPart: GoogleCalendarToolUIPart): boolean {
  return (
    toolPart.state === 'input-available' ||
    toolPart.state === 'approval-requested' ||
    toolPart.state === 'approval-responded'
  )
}

function getToolStepStatus(
  toolPart: GoogleCalendarToolUIPart,
): 'complete' | 'active' | 'pending' {
  if (toolPart.state === 'input-streaming') {
    return 'pending'
  }

  if (isToolPartActive(toolPart)) {
    return 'active'
  }

  return 'complete'
}

function ToolApprovalCard(props: {
  onRespond: (approved: boolean) => void | PromiseLike<void>
  toolPart: Extract<GoogleCalendarToolUIPart, { state: 'approval-requested' }>
}): React.JSX.Element {
  const { onRespond, toolPart } = props
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleResponse = useCallback(
    async (approved: boolean) => {
      setIsSubmitting(true)
      try {
        await onRespond(approved)
      } finally {
        setIsSubmitting(false)
      }
    },
    [onRespond],
  )

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <p className="text-sm font-medium">Approval required</p>
      <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
        {getGoogleCalendarToolLabel(toolPart)}
      </p>
      <div className="mt-3 flex gap-2">
        <Button disabled={isSubmitting} onClick={() => void handleResponse(true)} size="sm">
          Approve
        </Button>
        <Button
          disabled={isSubmitting}
          onClick={() => void handleResponse(false)}
          size="sm"
          variant="outline"
        >
          Deny
        </Button>
      </div>
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

function ComposerAttachButton(): React.JSX.Element {
  const { fileInputId } = usePromptInputAttachments()

  return (
    <label htmlFor={fileInputId} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-within:ring-2 focus-within:ring-ring">
      <Paperclip className="size-4" />
      <span className="sr-only">Attach file</span>
    </label>
  )
}

function WorkspaceSidebar(props: {
  executionMode: ExecutionMode
  onClearChat: () => void
  onExecutionModeChange: (value: string) => void
  viewer: WorkspaceShellProps['viewer']
}): React.JSX.Element {
  const {
    executionMode,
    onClearChat,
    onExecutionModeChange,
    viewer,
  } = props
  const { toggleSidebar } = useSidebar()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <>
      <SidebarHeader className="relative">
        <SidebarTrigger className="absolute right-2 top-2 z-10 hidden size-7 rounded-md text-sidebar-foreground/70 transition-opacity duration-200 ease-linear hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0 md:inline-flex" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="group/brand"
              onClick={toggleSidebar}
              tooltip="Open sidebar"
            >
              <div className="relative size-4 shrink-0">
                <CalendarDays className="absolute inset-0 size-4 transition-opacity duration-150 group-data-[collapsible=icon]:group-hover/brand:opacity-0" />
                <PanelLeft className="absolute inset-0 size-4 opacity-0 transition-opacity duration-150 group-data-[collapsible=icon]:group-hover/brand:opacity-100" />
              </div>
              <span className="font-semibold">GcalThing</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onClearChat} tooltip="New chat">
              <SquarePen className="size-4" />
              <span>New chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip={`Mode: ${getExecutionModeLabel(executionMode)}`}>
                  <Clock3 className="size-4" />
                  <span>{getExecutionModeLabel(executionMode)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            <div className="space-y-2 px-2 pt-2 group-data-[collapsible=icon]:hidden">
              <Select onValueChange={onExecutionModeChange} value={executionMode}>
                <SelectTrigger className="w-full bg-background/70" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="approval-first">Approval first</SelectItem>
                  <SelectItem value="direct-execution">Direct execution</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-relaxed text-sidebar-foreground/50">
                Approval-first pauses before writes. Direct execution runs immediately.
              </p>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator className="transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:opacity-0" />
      <SidebarFooter>
        {viewer ? (
          <NavUser
            executionMode={executionMode}
            onExecutionModeChange={onExecutionModeChange}
            onOpenSettings={() => setSettingsOpen(true)}
            viewer={viewer}
          />
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setSettingsOpen(true)} tooltip="Settings">
                <Settings className="size-4" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Sign in">
                <a href="/auth/login?returnTo=/">
                  <LogIn className="size-4" />
                  <span>Sign in</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>

      <SettingsDialog
        executionMode={executionMode}
        onExecutionModeChange={onExecutionModeChange}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        viewer={viewer}
      />
    </>
  )
}

function NavUser(props: {
  executionMode: ExecutionMode
  onExecutionModeChange: (value: string) => void
  onOpenSettings: () => void
  viewer: NonNullable<WorkspaceShellProps['viewer']>
}): React.JSX.Element {
  const { onOpenSettings, viewer } = props
  const { isMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <ViewerAvatar viewer={viewer} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{viewer.name}</span>
                <span className="truncate text-xs">{viewer.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <ViewerAvatar viewer={viewer} />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{viewer.name}</span>
                  <span className="truncate text-xs">{viewer.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenSettings}>
              <Settings className="size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/auth/logout">
                <LogOut className="size-4" />
                Sign out
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function ViewerAvatar({ viewer, className }: { viewer: { name: string; picture: string | null }; className?: string }) {
  const initials = viewer.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)

  return (
    <Avatar className={cn('h-8 w-8 rounded-lg', className)}>
      <AvatarImage alt={viewer.name} src={viewer.picture ?? undefined} />
      <AvatarFallback className="rounded-lg text-xs">{initials}</AvatarFallback>
    </Avatar>
  )
}

function getExecutionModeLabel(executionMode: ExecutionMode): string {
  if (executionMode === 'direct-execution') {
    return 'Direct execution'
  }

  return 'Approval first'
}

type Theme = 'light' | 'dark' | 'auto'

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored
  } catch {
    // ignore
  }
  return 'auto'
}

function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      window.localStorage.setItem('theme', next)
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const resolved = next === 'auto' ? (prefersDark ? 'dark' : 'light') : next
      const root = document.documentElement
      root.classList.remove('light', 'dark')
      root.classList.add(resolved)
      root.style.colorScheme = resolved
      if (next === 'auto') {
        root.removeAttribute('data-theme')
      } else {
        root.setAttribute('data-theme', next)
      }
    } catch {
      // ignore
    }
  }, [])

  return [theme, setTheme]
}

function SettingsDialog(props: {
  executionMode: ExecutionMode
  onExecutionModeChange: (value: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  viewer: WorkspaceShellProps['viewer']
}): React.JSX.Element {
  const { executionMode, onExecutionModeChange, open, onOpenChange, viewer } = props
  const [theme, setTheme] = useTheme()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your preferences</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-2">
          <div className="space-y-2">
            <Label>Theme</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                className="gap-1.5"
                onClick={() => setTheme('light')}
                size="sm"
                variant={theme === 'light' ? 'default' : 'outline'}
              >
                <Sun className="size-3.5" />
                Light
              </Button>
              <Button
                className="gap-1.5"
                onClick={() => setTheme('dark')}
                size="sm"
                variant={theme === 'dark' ? 'default' : 'outline'}
              >
                <Moon className="size-3.5" />
                Dark
              </Button>
              <Button
                className="gap-1.5"
                onClick={() => setTheme('auto')}
                size="sm"
                variant={theme === 'auto' ? 'default' : 'outline'}
              >
                <Monitor className="size-3.5" />
                Auto
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Execution mode</Label>
            <Select onValueChange={onExecutionModeChange} value={executionMode}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approval-first">Approval first</SelectItem>
                <SelectItem value="direct-execution">Direct execution</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Approval-first pauses before writes. Direct execution runs immediately.
            </p>
          </div>

          {viewer ? (
            <div className="space-y-2">
              <Label>Account</Label>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <ViewerAvatar viewer={viewer} className="size-8 rounded-md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{viewer.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{viewer.email}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TopAuthControl(props: {
  hasContent: boolean
  onClearChat: () => void
  viewer: WorkspaceShellProps['viewer']
}): React.JSX.Element {
  const { hasContent, onClearChat, viewer } = props

  return (
    <div className="ml-auto flex items-center gap-2" data-slot="workspace-top-auth">
      {hasContent ? (
        <Button
          className="size-8 rounded-lg"
          onClick={onClearChat}
          size="icon"
          variant="ghost"
        >
          <SquarePen className="size-4" />
          <span className="sr-only">New chat</span>
        </Button>
      ) : null}
      {!viewer ? (
        <Button asChild className="rounded-full px-4" size="sm" variant="outline">
          <a href="/auth/login?returnTo=/">Log in</a>
        </Button>
      ) : null}
    </div>
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
  onPromptSubmit: (message: PromptInputMessage) => Promise<void>
  onSuggestionClick: (text: string) => void
  status: WorkspaceChatStatus
  stop: () => void
  viewer: WorkspaceShellProps['viewer']
}): React.JSX.Element {
  const { onPromptSubmit, onSuggestionClick, status, stop, viewer } = props

  return (
    <div className="relative flex w-full flex-col items-center gap-6 px-4 text-center">
      <div className="pointer-events-none absolute inset-x-16 top-0 -z-10 h-40 rounded-full bg-[radial-gradient(circle_at_center,rgba(39,110,241,0.14),transparent_70%)] blur-2xl" />

      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        What are you working on?
      </h1>

      <WorkspaceComposer
        onSubmit={onPromptSubmit}
        status={status}
        stop={stop}
        variant="center"
      />

      <Suggestions className="max-w-xl justify-center">
        <Suggestion onClick={onSuggestionClick} suggestion="What's on my calendar today?" />
        <Suggestion onClick={onSuggestionClick} suggestion="Am I free tomorrow afternoon?" />
        <Suggestion onClick={onSuggestionClick} suggestion="Schedule a meeting for\u2026" />
      </Suggestions>

      <div className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 px-4 py-4 text-left backdrop-blur">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {viewer ? `Signed in as ${viewer.email}` : 'Sign in for live calendar access'}
          </p>
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            {viewer
              ? 'Search calendars, inspect events, check availability, and make changes without leaving the chat.'
              : 'Without Google sign-in the assistant can still discuss plans, but calendar reads and writes stay unavailable. Use the left sidebar or the top-right button to connect Google Calendar.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function WorkspaceComposer(props: {
  onSubmit: (message: PromptInputMessage) => Promise<void>
  status: WorkspaceChatStatus
  stop: () => void
  variant: 'center' | 'dock'
}): React.JSX.Element {
  const { onSubmit, status, stop, variant } = props

  return (
    <PromptInput
      canSubmit={status !== 'submitted' && status !== 'streaming'}
      className={
        variant === 'center'
          ? 'mx-auto w-full max-w-xl [&_[data-slot=input-group]]:rounded-[1.75rem] [&_[data-slot=input-group]]:border-[var(--border)] [&_[data-slot=input-group]]:bg-[var(--card)]/92 [&_[data-slot=input-group]]:shadow-sm [&_[data-slot=input-group]]:backdrop-blur'
          : 'mx-auto w-full max-w-2xl [&_[data-slot=input-group]]:rounded-[1.4rem] [&_[data-slot=input-group]]:border-[var(--border)] [&_[data-slot=input-group]]:bg-[var(--card)]/92 [&_[data-slot=input-group]]:shadow-sm [&_[data-slot=input-group]]:backdrop-blur'
      }
      globalDrop
      maxFiles={4}
      onSubmit={onSubmit}
    >
      <PromptInputHeader>
        <ComposerAttachments />
      </PromptInputHeader>
      <PromptInputBody>
        <PromptInputTextarea
          className="min-h-14 max-h-40 text-sm"
          placeholder="Ask about your calendar or describe a change"
        />
      </PromptInputBody>
      <PromptInputFooter className="px-2 pb-2">
        <PromptInputTools>
          <ComposerAttachButton />
        </PromptInputTools>

        <PromptInputSubmit onStop={stop} status={status} />
      </PromptInputFooter>
    </PromptInput>
  )
}
