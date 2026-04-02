import type { FileUIPart, UIMessage } from 'ai'
import type { ChatNotice, SourceInput } from '@/lib/contracts'

export type AppChatMessage = UIMessage<never, { chatNotice: ChatNotice }>

type TextSourceType = Extract<SourceInput, { kind: 'text' }>['sourceType']

export function getMessageText(message: AppChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export function getMessageReasoningText(message: AppChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => part.text)
    .join('')
}

export function isMessageReasoning(message: AppChatMessage): boolean {
  return message.parts.some((part) => part.type === 'reasoning')
}

export function isMessageReasoningStreaming(message: AppChatMessage): boolean {
  return message.parts.some(
    (part) => part.type === 'reasoning' && part.state === 'streaming',
  )
}

export function getMessageFiles(message: AppChatMessage): FileUIPart[] {
  return message.parts.filter((part) => part.type === 'file')
}

export function toSourceInputsFromMessage(message: AppChatMessage): SourceInput[] {
  const text = getMessageText(message).trim()
  const inputs: SourceInput[] = []

  if (text) {
    const sourceType = inferTextSourceType(text)
    inputs.push({
      kind: 'text',
      id: crypto.randomUUID(),
      label: getTextSourceLabel(sourceType),
      sourceType,
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

export function getMessageNotice(message: AppChatMessage): ChatNotice | null {
  const noticePart = message.parts.find((part) => part.type === 'data-chatNotice')
  return noticePart?.data ?? null
}

function inferTextSourceType(text: string): TextSourceType {
  const normalized = text.toLowerCase()
  if (
    normalized.includes('forwarded message') ||
    normalized.includes('begin forwarded message') ||
    /^fwd:/m.test(normalized)
  ) {
    return 'forwarded-email'
  }

  if (
    /^from:/m.test(normalized) ||
    /^subject:/m.test(normalized) ||
    /^sent:/m.test(normalized) ||
    /^to:/m.test(normalized)
  ) {
    return 'email-body'
  }

  return 'pasted-text'
}

function getTextSourceLabel(sourceType: TextSourceType): string {
  if (sourceType === 'email-body') {
    return 'Email body'
  }

  if (sourceType === 'forwarded-email') {
    return 'Forwarded email'
  }

  if (sourceType === 'manual') {
    return 'Manual note'
  }

  return 'Pasted text'
}
