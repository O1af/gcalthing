import {
  consumeStream,
  createAgentUIStreamResponse,
} from "ai";
import type { AppChatMessage } from "@/lib/chat-ui";
import { getMessageText } from "@/lib/chat-ui";
import type { ExecutionMode, SourceInput } from "@/lib/contracts";
import { logDebug } from "@/lib/server/debug";
import { getServerEnv } from "@/lib/server/env";
import { buildCalendarAgentOptions, getCalendarAgents } from "./agent";
import { collectConversationSourceInputs } from "./chat-helpers";

export interface AssistantTurnInput {
  executionMode: ExecutionMode;
  latestUserText: string;
  localTimeZone: string;
  messages: AppChatMessage[];
  sourceInputs: SourceInput[];
}

export type { SessionContext } from "@/lib/server/auth";

export async function streamAssistantTurn(params: {
  messages: AppChatMessage[];
  executionMode: ExecutionMode;
  localTimeZone: string;
  abortSignal?: AbortSignal;
}): Promise<Response> {
  const input = buildAssistantTurnInput(params);
  const env = getServerEnv();
  const { getSessionContext } = await import("@/lib/server/auth");
  const session = await getSessionContext();
  const turnId = crypto.randomUUID().slice(0, 8);
  const { approval, direct } = getCalendarAgents();

  logDebug("ai:chat", "turn:start", {
    executionMode: input.executionMode,
    messageCount: input.messages.length,
    model: env.OPENAI_MODEL,
    signedIn: Boolean(session),
    sourceInputCount: input.sourceInputs.length,
    turnId,
  });

  const getCalendars = session
    ? onceLazy(() =>
        import("@/lib/server/google-calendar").then((m) =>
          m.listWritableCalendars(session.tokens.accessToken),
        ),
      )
    : null;

  return createAgentUIStreamResponse({
    abortSignal: params.abortSignal,
    agent: input.executionMode === "approval-first" ? approval : direct,
    consumeSseStream: consumeStream,
    options: buildCalendarAgentOptions({
      executionMode: input.executionMode,
      getCalendars,
      latestUserText: input.latestUserText,
      localTimeZone: input.localTimeZone,
      session,
      sourceInputs: input.sourceInputs,
      turnId,
    }),
    uiMessages: params.messages as unknown[],
  });
}

function onceLazy<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => (cached ??= fn());
}

function buildAssistantTurnInput(params: {
  executionMode: ExecutionMode;
  localTimeZone: string;
  messages: AppChatMessage[];
}): AssistantTurnInput {
  const latestUserMessage = [...params.messages]
    .reverse()
    .find((message) => message.role === "user");

  return {
    executionMode: params.executionMode,
    latestUserText: latestUserMessage ? getMessageText(latestUserMessage) : "",
    localTimeZone: params.localTimeZone,
    messages: params.messages,
    sourceInputs: collectConversationSourceInputs(params.messages),
  };
}
