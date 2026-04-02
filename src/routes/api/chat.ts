import { createFileRoute } from "@tanstack/react-router";
import type { AppChatMessage } from "@/lib/chat-ui";
import { executionModeSchema } from "@/lib/contracts";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          executionMode?: unknown;
          localTimeZone?: unknown;
          messages?: AppChatMessage[];
        };
        const { streamAssistantTurn } = await import("@/lib/server/chat");

        return streamAssistantTurn({
          abortSignal: request.signal,
          executionMode: executionModeSchema.parse(body.executionMode ?? "approval-first"),
          localTimeZone: typeof body.localTimeZone === "string" ? body.localTimeZone : "UTC",
          messages: Array.isArray(body.messages) ? body.messages : [],
        });
      },
    },
  },
});
