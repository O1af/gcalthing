import { isToolUIPart } from 'ai'
import type { AppChatMessage } from '@/lib/chat-ui'

export function sanitizeMessagesForAssistantTurn(
  messages: AppChatMessage[],
): AppChatMessage[] {
  let seenLaterUserMessage = false
  const sanitizedReversed: AppChatMessage[] = []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message.role !== 'assistant' || !seenLaterUserMessage) {
      sanitizedReversed.push(message)
    } else {
      const parts = message.parts.filter(part => !isIncompleteToolPart(part))
      if (parts.some(part => part.type !== 'step-start')) {
        sanitizedReversed.push({ ...message, parts })
      }
    }

    if (message.role === 'user') {
      seenLaterUserMessage = true
    }
  }

  return sanitizedReversed.reverse()
}

function isIncompleteToolPart(
  part: AppChatMessage['parts'][number],
): boolean {
  return (
    isToolUIPart(part) &&
    (part.state === 'input-streaming' ||
      part.state === 'input-available' ||
      part.state === 'approval-requested' ||
      part.state === 'approval-responded')
  )
}
