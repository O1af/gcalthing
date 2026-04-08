import {
  consumeStream,
  createAgentUIStreamResponse,
} from "ai";
import type { AppChatMessage } from "@/lib/chat-ui";
import { sanitizeMessagesForAssistantTurn } from "@/lib/chat-request-sanitizer";
import type { ExecutionMode } from "@/lib/contracts";
import { emptyFactsContext } from "@/lib/contracts";
import { buildCalendarAgentOptions, getCalendarAgents } from "./agent";

export type { SessionContext } from "@/lib/server/auth";

export async function streamAssistantTurn(params: {
  messages: AppChatMessage[];
  executionMode: ExecutionMode;
  localTimeZone: string;
  abortSignal?: AbortSignal;
}): Promise<Response> {
  const sanitizedMessages = sanitizeMessagesForAssistantTurn(params.messages);
  const { getSessionContext } = await import("@/lib/server/auth");
  const session = await getSessionContext();
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

  return createAgentUIStreamResponse({
    abortSignal: params.abortSignal,
    agent: params.executionMode === "approval-first" ? approval : direct,
    consumeSseStream: consumeStream,
    options: buildCalendarAgentOptions({
      calendars,
      executionMode: params.executionMode,
      facts,
      localTimeZone: params.localTimeZone,
      nearTermEvents,
      session,
    }),
    originalMessages: params.messages as never,
    uiMessages: sanitizedMessages as never,
  });
}
