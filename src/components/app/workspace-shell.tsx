"use client";

import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type FileUIPart,
} from "ai";
import { useChat } from "@ai-sdk/react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  ConversationBody,
  ConversationEmptyState,
  ConversationRoot,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
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
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { EventSuccessCard, SignInRequiredCard } from "@/components/app/chat-notice-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/sidebar";
import type { AppChatMessage } from "@/lib/chat-ui";
import { cn } from "@/lib/utils";
import {
  getGoogleCalendarToolLabel,
  getGoogleCalendarSignInDetail,
  getGoogleCalendarToolRichLabel,
  getGoogleCalendarWriteSuccess,
  getMessageFiles,
  getMessageReasoningText,
  getMessageGoogleCalendarToolParts,
  getMessageText,
  isMessageReasoningStreaming,
  parseToolInput,
  type GoogleCalendarToolUIPart,
} from "@/lib/chat-ui";
import { executionModeSchema, type ExecutionMode } from "@/lib/contracts";
import {
  CalendarCog,
  CalendarDays,
  CalendarPlus,
  CalendarX,
  ChevronsUpDown,
  Clock,
  Clock3,
  FileText,
  LogIn,
  LogOut,
  MapPin,
  Monitor,
  Moon,
  PanelLeft,
  Paperclip,
  Search,
  Settings,
  SquarePen,
  Sun,
  Users,
} from "lucide-react";
import { useStickToBottom } from "use-stick-to-bottom";
import { useCallback, useEffect, useRef, useState } from "react";

type WorkspaceChatStatus = ReturnType<typeof useWorkspaceChat>["status"];

const EXECUTION_MODE_KEY = "gcalthing-execution-mode";
interface WorkspaceShellProps {
  viewer: {
    email: string;
    name: string;
    picture: string | null;
    sub: string;
  } | null;
}

export function WorkspaceShell({ viewer }: WorkspaceShellProps) {
  const [executionMode, setExecutionMode] = useExecutionMode();
  const { addToolApprovalResponse, messages, sendMessage, setMessages, status, stop } =
    useWorkspaceChat(executionMode);
  const conversation = useStickToBottom({
    initial: "smooth",
    resize: "smooth",
  });

  const isResponding = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);

  const handleClearChat = useCallback(() => {
    stop();
    setMessages([]);
  }, [stop, setMessages]);

  const handlePromptSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (!message.text.trim() && message.files.length === 0) {
        return;
      }

      void Promise.resolve(conversation.scrollToBottom("smooth"));
      await sendMessage({
        files: message.files,
        text: message.text,
      });
    },
    [conversation, sendMessage],
  );

  const handleSuggestionClick = useCallback(
    (text: string) => {
      void Promise.resolve(conversation.scrollToBottom("smooth"));
      void sendMessage({ files: [], text });
    },
    [conversation, sendMessage],
  );

  const hasContent = messages.length > 0;
  const shouldShowPendingAssistantMessage = isResponding && lastMessage?.role !== "assistant";

  const renderMessageRow = useCallback(
    (message: AppChatMessage, index: number) => (
      <div data-message-id={message.id} data-slot="chat-message-row" key={message.id}>
        <ChatMessageRow
          addToolApprovalResponse={addToolApprovalResponse}
          isResponding={isResponding}
          message={message}
          showStreamingIndicator={index === messages.length - 1}
        />
      </div>
    ),
    [addToolApprovalResponse, isResponding, messages.length],
  );

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "14.5rem",
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
            <TopAuthControl hasContent={hasContent} onClearChat={handleClearChat} viewer={viewer} />
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
                    {shouldShowPendingAssistantMessage ? <PendingAssistantMessage /> : null}
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
  );
}

function readStoredExecutionMode(): ExecutionMode {
  try {
    const stored = window.localStorage.getItem(EXECUTION_MODE_KEY);
    const parsed = executionModeSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
  } catch {
    // Ignore stale local storage.
  }
  return "approval-first";
}

function useExecutionMode(): [ExecutionMode, (nextMode: string) => void] {
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(readStoredExecutionMode);

  useEffect(() => {
    try {
      window.localStorage.setItem(EXECUTION_MODE_KEY, executionMode);
    } catch {
      // Ignore local storage write failures.
    }
  }, [executionMode]);

  const handleExecutionModeChange = useCallback((nextMode: string) => {
    const parsed = executionModeSchema.safeParse(nextMode);
    if (parsed.success) {
      setExecutionMode(parsed.data);
    }
  }, []);

  return [executionMode, handleExecutionModeChange];
}

function useWorkspaceChat(executionMode: ExecutionMode) {
  const executionModeRef = useRef(executionMode);
  const localTimeZoneRef = useRef(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const transportRef = useRef<DefaultChatTransport<AppChatMessage> | null>(null);

  useEffect(() => {
    executionModeRef.current = executionMode;
  }, [executionMode]);

  if (!transportRef.current) {
    transportRef.current = new DefaultChatTransport<AppChatMessage>({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          executionMode: executionModeRef.current,
          localTimeZone: localTimeZoneRef.current,
          messages,
        },
      }),
    });
  }

  return useChat<AppChatMessage>({
    id: "workspace-chat",
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    transport: transportRef.current,
  });
}

function ChatMessageRow(props: {
  addToolApprovalResponse: (response: {
    approved: boolean;
    id: string;
  }) => void | PromiseLike<void>;
  isResponding: boolean;
  message: AppChatMessage;
  showStreamingIndicator: boolean;
}): React.JSX.Element {
  const {
    addToolApprovalResponse,
    isResponding,
    message,
    showStreamingIndicator,
  } = props;
  const messageFiles = getMessageFiles(message);
  const messageReasoning = getMessageReasoningText(message);
  const messageText = getMessageText(message);
  const toolParts = getMessageGoogleCalendarToolParts(message);
  let signInDetail: string | null = null;
  let successResult: ReturnType<typeof getGoogleCalendarWriteSuccess> = null;
  const approvalRequestedParts: Extract<
    GoogleCalendarToolUIPart,
    { state: "approval-requested" }
  >[] = [];
  for (const part of toolParts) {
    signInDetail ??= getGoogleCalendarSignInDetail(part);
    successResult ??= getGoogleCalendarWriteSuccess(part);
    if (part.state === "approval-requested") approvalRequestedParts.push(part);
  }

  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>
          {messageText ? (
            <p className="whitespace-pre-wrap leading-relaxed">{messageText}</p>
          ) : null}
          {messageFiles.length > 0 ? <ChatAttachments files={messageFiles} /> : null}
        </MessageContent>
      </Message>
    );
  }

  const showReasoning =
    messageReasoning.length > 0 ||
    (showStreamingIndicator && isResponding && toolParts.length === 0);

  return (
    <div className="flex w-full flex-col gap-3">
      {toolParts.length > 0 ? <CalendarToolChain toolParts={toolParts} /> : null}
      {showReasoning ? (
        <Reasoning
          isStreaming={
            showStreamingIndicator && (isResponding || isMessageReasoningStreaming(message))
          }
        >
          <ReasoningTrigger />
          {messageReasoning ? <ReasoningContent>{messageReasoning}</ReasoningContent> : null}
        </Reasoning>
      ) : null}
      {messageText ? <MessageResponse>{messageText}</MessageResponse> : null}
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
  );
}

function PendingAssistantMessage(): React.JSX.Element {
  return (
    <div className="flex w-full flex-col gap-3">
      <Reasoning isStreaming>
        <ReasoningTrigger />
      </Reasoning>
    </div>
  );
}

const TOOL_ICON = {
  check_availability: Clock3,
  create_event: CalendarPlus,
  delete_event: CalendarX,
  search_events: Search,
  update_event: CalendarCog,
} as const;

function getToolIcon(toolPart: GoogleCalendarToolUIPart) {
  const name = toolPart.type.replace("tool-", "") as keyof typeof TOOL_ICON;
  return TOOL_ICON[name] ?? Search;
}

function CalendarToolChain(props: {
  toolParts: GoogleCalendarToolUIPart[];
}): React.JSX.Element {
  const { toolParts } = props;

  return (
    <ChainOfThought defaultOpen className="rounded-none border-none bg-transparent">
      <ChainOfThoughtHeader />
      <ChainOfThoughtContent className="border-t-0 px-0">
        {toolParts.map((toolPart) => (
          <ChainOfThoughtStep
            icon={getToolIcon(toolPart)}
            key={toolPart.toolCallId}
            label={getGoogleCalendarToolRichLabel(toolPart)}
            status={getToolStepStatus(toolPart)}
          >
            <ToolStepSubDetails toolPart={toolPart} />
          </ChainOfThoughtStep>
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

function isToolPartActive(toolPart: GoogleCalendarToolUIPart): boolean {
  return (
    toolPart.state === "input-available" ||
    toolPart.state === "approval-requested" ||
    toolPart.state === "approval-responded"
  );
}

function getToolStepStatus(toolPart: GoogleCalendarToolUIPart): "complete" | "active" | "pending" {
  if (toolPart.state === "input-streaming") {
    return "pending";
  }

  if (isToolPartActive(toolPart)) {
    return "active";
  }

  return "complete";
}

function formatTimeRange(startTime?: string | null, endTime?: string | null, durationMinutes?: number | null): string | null {
  if (!startTime) return null;
  if (endTime) return `${startTime} – ${endTime}`;
  if (durationMinutes) {
    const [h, m] = startTime.split(":").map(Number);
    const totalMins = h * 60 + m + durationMinutes;
    const endH = Math.floor(totalMins / 60) % 24;
    const endM = totalMins % 60;
    return `${startTime} – ${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  }
  return startTime;
}

function EventApprovalDetails(props: {
  toolPart: Pick<GoogleCalendarToolUIPart, "type" | "input">;
}): React.JSX.Element | null {
  const parsed = parseToolInput(props.toolPart);
  if (!parsed) return null;

  if (parsed.tool === "delete_event") {
    if (!parsed.data.title && !parsed.data.when) return null;
    return (
      <div className="mt-2 rounded-lg bg-muted/50 p-3 space-y-1.5">
        {parsed.data.title ? (
          <p className="text-sm font-medium text-foreground">{parsed.data.title}</p>
        ) : null}
        {parsed.data.when ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="size-3.5 shrink-0" />
            <span>{parsed.data.when}</span>
          </div>
        ) : null}
      </div>
    );
  }

  if (parsed.tool === "create_event" || parsed.tool === "update_event") {
    const d = parsed.data;
    const timeRange = formatTimeRange(d.startTime, d.endTime, d.durationMinutes);
    const attendeeList = d.attendees?.map((a) => a.name || a.email).join(", ");
    const hasAny = d.title || d.date || timeRange || d.location || attendeeList || d.description;
    if (!hasAny) return null;

    return (
      <div className="mt-2 rounded-lg bg-muted/50 p-3 space-y-1.5">
        {d.title ? (
          <p className="text-sm font-medium text-foreground">{d.title}</p>
        ) : null}
        {d.date ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="size-3.5 shrink-0" />
            <span>{d.allDay ? `All day · ${d.date}` : d.date}</span>
          </div>
        ) : null}
        {timeRange ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-3.5 shrink-0" />
            <span>{timeRange}</span>
          </div>
        ) : null}
        {d.location ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span>{d.location}</span>
          </div>
        ) : null}
        {attendeeList ? (
          <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Users className="size-3.5 shrink-0 mt-0.5" />
            <span>{attendeeList}</span>
          </div>
        ) : null}
        {d.description ? (
          <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <FileText className="size-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{d.description}</span>
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}

function ToolStepSubDetails(props: {
  toolPart: GoogleCalendarToolUIPart;
}): React.JSX.Element | null {
  const parsed = parseToolInput(props.toolPart);
  if (!parsed) return null;

  if (parsed.tool === "create_event" || parsed.tool === "update_event") {
    const d = parsed.data;
    const timeRange = formatTimeRange(d.startTime, d.endTime, d.durationMinutes);
    const attendees = d.attendees ?? [];
    if (!timeRange && attendees.length === 0 && !d.location) return null;

    return (
      <div className="space-y-1.5">
        {timeRange || d.location ? (
          <p className="text-xs text-muted-foreground">
            {[timeRange, d.location].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {attendees.length > 0 ? (
          <ChainOfThoughtSearchResults>
            {attendees.map((a) => (
              <ChainOfThoughtSearchResult key={a.email}>{a.name || a.email}</ChainOfThoughtSearchResult>
            ))}
          </ChainOfThoughtSearchResults>
        ) : null}
      </div>
    );
  }

  if (parsed.tool === "search_events") {
    const q = parsed.data.query;
    if (!q) return null;
    return (
      <ChainOfThoughtSearchResults>
        <ChainOfThoughtSearchResult>{q}</ChainOfThoughtSearchResult>
      </ChainOfThoughtSearchResults>
    );
  }

  if (parsed.tool === "check_availability") {
    const d = parsed.data;
    const timeRange = formatTimeRange(d.startTime, d.endTime, d.durationMinutes);
    return (
      <p className="text-xs text-muted-foreground">
        {[d.date, timeRange].filter(Boolean).join(" · ")}
      </p>
    );
  }

  return null;
}

function ToolApprovalCard(props: {
  onRespond: (approved: boolean) => void | PromiseLike<void>;
  toolPart: Extract<GoogleCalendarToolUIPart, { state: "approval-requested" }>;
}): React.JSX.Element {
  const { onRespond, toolPart } = props;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleResponse = useCallback(
    async (approved: boolean) => {
      setIsSubmitting(true);
      try {
        await onRespond(approved);
      } finally {
        setIsSubmitting(false);
      }
    },
    [onRespond],
  );

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <p className="text-sm font-medium">Approval required</p>
      <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
        {getGoogleCalendarToolLabel(toolPart)}
      </p>
      <EventApprovalDetails toolPart={toolPart} />
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
  );
}

function ComposerAttachments(): React.JSX.Element | null {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) {
    return null;
  }

  return <ChatAttachments files={files} onRemove={remove} />;
}

function ComposerAttachButton(): React.JSX.Element {
  const { fileInputId } = usePromptInputAttachments();

  return (
    <label
      htmlFor={fileInputId}
      className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-within:ring-2 focus-within:ring-ring"
    >
      <Paperclip className="size-4" />
      <span className="sr-only">Attach file</span>
    </label>
  );
}

function WorkspaceSidebar(props: {
  executionMode: ExecutionMode;
  onClearChat: () => void;
  onExecutionModeChange: (value: string) => void;
  viewer: WorkspaceShellProps["viewer"];
}): React.JSX.Element {
  const { executionMode, onClearChat, onExecutionModeChange, viewer } = props;
  const { toggleSidebar } = useSidebar();
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  );
}

function NavUser(props: {
  executionMode: ExecutionMode;
  onExecutionModeChange: (value: string) => void;
  onOpenSettings: () => void;
  viewer: NonNullable<WorkspaceShellProps["viewer"]>;
}): React.JSX.Element {
  const { onOpenSettings, viewer } = props;
  const { isMobile } = useSidebar();

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
            side={isMobile ? "bottom" : "right"}
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
  );
}

function ViewerAvatar({
  viewer,
  className,
}: {
  viewer: { name: string; picture: string | null };
  className?: string;
}) {
  const initials = viewer.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);

  return (
    <Avatar className={cn("h-8 w-8 rounded-lg", className)}>
      <AvatarImage alt={viewer.name} src={viewer.picture ?? undefined} />
      <AvatarFallback className="rounded-lg text-xs">{initials}</AvatarFallback>
    </Avatar>
  );
}

function getExecutionModeLabel(executionMode: ExecutionMode): string {
  if (executionMode === "direct-execution") {
    return "Direct execution";
  }

  return "Approval first";
}

type Theme = "light" | "dark" | "auto";

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  } catch {
    // ignore
  }
  return "auto";
}

function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem("theme", next);
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const resolved = next === "auto" ? (prefersDark ? "dark" : "light") : next;
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
      root.style.colorScheme = resolved;
      if (next === "auto") {
        root.removeAttribute("data-theme");
      } else {
        root.setAttribute("data-theme", next);
      }
    } catch {
      // ignore
    }
  }, []);

  return [theme, setTheme];
}

function SettingsDialog(props: {
  executionMode: ExecutionMode;
  onExecutionModeChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: WorkspaceShellProps["viewer"];
}): React.JSX.Element {
  const { executionMode, onExecutionModeChange, open, onOpenChange, viewer } = props;
  const [theme, setTheme] = useTheme();

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
                onClick={() => setTheme("light")}
                size="sm"
                variant={theme === "light" ? "default" : "outline"}
              >
                <Sun className="size-3.5" />
                Light
              </Button>
              <Button
                className="gap-1.5"
                onClick={() => setTheme("dark")}
                size="sm"
                variant={theme === "dark" ? "default" : "outline"}
              >
                <Moon className="size-3.5" />
                Dark
              </Button>
              <Button
                className="gap-1.5"
                onClick={() => setTheme("auto")}
                size="sm"
                variant={theme === "auto" ? "default" : "outline"}
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
  );
}

function TopAuthControl(props: {
  hasContent: boolean;
  onClearChat: () => void;
  viewer: WorkspaceShellProps["viewer"];
}): React.JSX.Element {
  const { hasContent, onClearChat, viewer } = props;

  return (
    <div className="ml-auto flex items-center gap-2" data-slot="workspace-top-auth">
      {hasContent ? (
        <Button className="size-8 rounded-lg" onClick={onClearChat} size="icon" variant="ghost">
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
  );
}

function ChatAttachments(props: {
  files: Array<FileUIPart | (FileUIPart & { id: string })>;
  onRemove?: (id: string) => void;
}): React.JSX.Element {
  const { files, onRemove } = props;
  const variant = onRemove ? "grid" : "list";
  const attachments = files.map((file, index) => ({
    ...file,
    id: "id" in file ? file.id : `${file.url}:${index}`,
  }));

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
  );
}

function EmptyWorkspaceState(props: {
  onPromptSubmit: (message: PromptInputMessage) => Promise<void>;
  onSuggestionClick: (text: string) => void;
  status: WorkspaceChatStatus;
  stop: () => void;
  viewer: WorkspaceShellProps["viewer"];
}): React.JSX.Element {
  const { onPromptSubmit, onSuggestionClick, status, stop, viewer } = props;

  return (
    <div className="relative flex w-full flex-col items-center gap-6 px-4 text-center">
      <div className="pointer-events-none absolute inset-x-16 top-0 -z-10 h-40 rounded-full bg-[radial-gradient(circle_at_center,rgba(39,110,241,0.14),transparent_70%)] blur-2xl" />

      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        What are you working on?
      </h1>

      <WorkspaceComposer onSubmit={onPromptSubmit} status={status} stop={stop} variant="center" />

      <Suggestions className="max-w-xl justify-center">
        <Suggestion onClick={onSuggestionClick} suggestion="What's on my calendar today?" />
        <Suggestion onClick={onSuggestionClick} suggestion="Am I free tomorrow afternoon?" />
        <Suggestion onClick={onSuggestionClick} suggestion="Schedule a meeting for me" />
      </Suggestions>

      <div className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 px-4 py-4 text-left backdrop-blur">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {viewer ? `Signed in as ${viewer.email}` : "Sign in for live calendar access"}
          </p>
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            {viewer
              ? "Search calendars, inspect events, check availability, and make changes without leaving the chat."
              : "Without Google sign-in the assistant can still discuss plans, but calendar reads and writes stay unavailable. Use the left sidebar or the top-right button to connect Google Calendar."}
          </p>
        </div>
      </div>
    </div>
  );
}

function WorkspaceComposer(props: {
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  status: WorkspaceChatStatus;
  stop: () => void;
  variant: "center" | "dock";
}): React.JSX.Element {
  const { onSubmit, status, stop, variant } = props;

  return (
    <PromptInput
      canSubmit={status !== "submitted" && status !== "streaming"}
      className={
        variant === "center"
          ? "mx-auto w-full max-w-xl [&_[data-slot=input-group]]:rounded-[1.75rem] [&_[data-slot=input-group]]:border-[var(--border)] [&_[data-slot=input-group]]:bg-[var(--card)]/92 [&_[data-slot=input-group]]:shadow-sm [&_[data-slot=input-group]]:backdrop-blur"
          : "mx-auto w-full max-w-2xl [&_[data-slot=input-group]]:rounded-[1.4rem] [&_[data-slot=input-group]]:border-[var(--border)] [&_[data-slot=input-group]]:bg-[var(--card)]/92 [&_[data-slot=input-group]]:shadow-sm [&_[data-slot=input-group]]:backdrop-blur"
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
  );
}
