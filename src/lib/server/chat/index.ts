import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from "ai";
import type { AppChatMessage } from "@/lib/chat-ui";
import { getMessageText } from "@/lib/chat-ui";
import type { ChatNotice, ExecutionMode, SourceInput } from "@/lib/contracts";
import { buildChatSystemPrompt } from "@/lib/server/chat-system-prompt";
import { getOpenAIModel } from "@/lib/server/ai-model";
import { logDebug } from "@/lib/server/debug";
import { getServerEnv } from "@/lib/server/env";
import { buildTurnTools } from "./tool-definitions";
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
  const model = getOpenAIModel(env.OPENAI_MODEL);
  const { getSessionContext } = await import("@/lib/server/auth");
  const session = await getSessionContext();
  const turnId = crypto.randomUUID().slice(0, 8);
  let latestNotice: ChatNotice | null = null;

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

  const tools = buildTurnTools({
    executionMode: input.executionMode,
    getCalendars,
    input,
    session,
    setNotice: (notice) => {
      latestNotice = notice;
    },
    turnId,
  });

  const modelMessages = await convertToModelMessages(
    params.messages.map(({ id: _id, ...message }) => message),
  );

  const stream = createUIMessageStream<AppChatMessage>({
    originalMessages: params.messages,
    execute: ({ writer }) => {
      const result = streamText({
        abortSignal: params.abortSignal,
        messages: modelMessages,
        model,
        onFinish: () => {
          if (latestNotice) {
            writer.write({
              data: latestNotice,
              type: "data-chatNotice",
            });
          }
        },
        stopWhen: stepCountIs(6),
        system: buildChatSystemPrompt({
          executionMode: input.executionMode,
          signedIn: Boolean(session),
        }),
        tools,
      });

      writer.merge(result.toUIMessageStream<AppChatMessage>({ sendReasoning: true }));
    },
    onFinish: ({ responseMessage }) => {
      logDebug("ai:chat", "turn:done", {
        noticeKind: latestNotice?.kind ?? "none",
        responseTextLength: getMessageText(responseMessage).trim().length,
        turnId,
      });
    },
  });

  return createUIMessageStreamResponse({ stream });
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
