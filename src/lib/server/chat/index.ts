import {
  consumeStream,
  createAgentUIStreamResponse,
} from "ai";
import type { AppChatMessage } from "@/lib/chat-ui";
import { getMessageText } from "@/lib/chat-ui";
import type { ExecutionMode, SourceInput } from "@/lib/contracts";
import { emptyFactsContext } from "@/lib/contracts";
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

  const { listWritableCalendars, loadNearTermEvents } = await import(
    "@/lib/server/google-calendar"
  );
  const { loadFacts } = await import("@/lib/server/facts");

  const calendars = session
    ? await listWritableCalendars(session.tokens.accessToken)
    : [];

  const [facts, nearTermEvents] = session
    ? await Promise.all([
        loadFacts(session.profile.sub),
        loadNearTermEvents(session.tokens.accessToken, calendars),
      ])
    : [emptyFactsContext, []];

  logDebug("ai:chat", "turn:start", {
    calendarCount: calendars.length,
    executionMode: input.executionMode,
    factCount: facts.length,
    messageCount: input.messages.length,
    model: env.OPENAI_MODEL,
    nearTermEventCount: nearTermEvents.length,
    signedIn: Boolean(session),
    sourceInputCount: input.sourceInputs.length,
    turnId,
  });

  return createAgentUIStreamResponse({
    abortSignal: params.abortSignal,
    agent: input.executionMode === "approval-first" ? approval : direct,
    consumeSseStream: consumeStream,
    options: buildCalendarAgentOptions({
      calendars,
      executionMode: input.executionMode,
      facts,
      latestUserText: input.latestUserText,
      localTimeZone: input.localTimeZone,
      nearTermEvents,
      session,
      sourceInputs: input.sourceInputs,
      turnId,
    }),
    uiMessages: params.messages as unknown[],
  });
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
