'use client'

import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import {
  createEmptyReviewDraft,
  type BuildDraftInput,
  type ReviewDraft,
  type SourceInput,
  type SubmitEventRequest,
  type SubmitEventResponse,
} from '@/lib/contracts'
import { buildDraft, refreshReviewDraftFn, submitEventFn } from '@/lib/server/server-fns'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

export type Stage = 'ingest' | 'review' | 'success'
export type TextSourceType = BuildDraftInput['inputs'][number] extends infer T
  ? T extends { kind: 'text'; sourceType: infer S }
    ? S
    : never
  : never

export function useDraftWorkflow() {
  const [stage, setStage] = useState<Stage>('ingest')
  const [textSourceType, setTextSourceType] = useState<TextSourceType>('pasted-text')
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null)
  const [sourceInputs, setSourceInputs] = useState<SourceInput[]>([])
  const [success, setSuccess] = useState<SubmitEventResponse | null>(null)
  const [isBuilding, setIsBuilding] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  const localTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  )
  const latestDraftRef = useRef<ReviewDraft | null>(null)

  useEffect(() => {
    latestDraftRef.current = reviewDraft
  }, [reviewDraft])

  const runRefresh = useCallback((draft: ReviewDraft) => {
    setIsRefreshing(true)
    startTransition(() => {
      void refreshReviewDraftFn({
        data: {
          draft,
          localTimeZone,
        },
      })
        .then((nextDraft) => setReviewDraft(nextDraft))
        .catch((error) => {
          toast.error(getErrorMessage(error, 'Failed to refresh the review draft.'))
        })
        .finally(() => setIsRefreshing(false))
    })
  }, [localTimeZone])

  useEffect(() => {
    if (stage !== 'review' || refreshTick === 0 || !latestDraftRef.current) {
      return
    }

    const timer = window.setTimeout(() => {
      const current = latestDraftRef.current
      if (current) {
        runRefresh(current)
      }
    }, 350)

    return () => window.clearTimeout(timer)
  }, [refreshTick, runRefresh, stage])

  const handlePromptSubmit = useCallback(async (message: PromptInputMessage) => {
    const inputs = await toSourceInputs(message, textSourceType)
    if (inputs.length === 0) {
      toast.error('Add some text or an image before extracting a draft.')
      return
    }

    setIsBuilding(true)
    setSourceInputs(inputs)

    startTransition(() => {
      void buildDraft({
        data: {
          inputs,
          localTimeZone,
        },
      })
        .then((draft) => {
          setReviewDraft(draft)
          setSuccess(null)
          setStage('review')
        })
        .catch((error) => {
          toast.error(getErrorMessage(error, 'Failed to build the event draft.'))
        })
        .finally(() => setIsBuilding(false))
    })
  }, [localTimeZone, textSourceType])

  const handleManualDraft = useCallback(() => {
    const inputs: SourceInput[] = [
      {
        kind: 'text',
        id: crypto.randomUUID(),
        label: 'Manual entry',
        sourceType: 'manual',
        text: 'Manual draft',
      },
    ]
    const draft = createEmptyReviewDraft(localTimeZone)
    setSourceInputs(inputs)
    setReviewDraft(draft)
    setSuccess(null)
    setStage('review')
    runRefresh(draft)
  }, [localTimeZone, runRefresh])

  const updateDraft = useCallback(
    (mutate: (draft: ReviewDraft) => void, options?: { refresh?: boolean }) => {
      setReviewDraft((current) => {
        if (!current) {
          return current
        }

        const next = structuredClone(current)
        mutate(next)
        latestDraftRef.current = next
        return next
      })

      if (options?.refresh !== false) {
        setRefreshTick((value) => value + 1)
      }
    },
    [],
  )

  const handleSubmit = useCallback(() => {
    if (!reviewDraft) {
      return
    }

    const request: SubmitEventRequest = {
      action: reviewDraft.proposedAction,
      appendSourceDetails: true,
      attendeeGroups: reviewDraft.attendeeGroups,
      event: reviewDraft.event,
      extracted: reviewDraft.extracted,
      sourceInputs,
    }

    setIsSaving(true)
    startTransition(() => {
      void submitEventFn({ data: request })
        .then((response) => {
          setSuccess(response)
          setStage('success')
        })
        .catch((error) => {
          toast.error(getErrorMessage(error, 'Failed to write the event to Google Calendar.'))
        })
        .finally(() => setIsSaving(false))
    })
  }, [reviewDraft, sourceInputs])

  const resetToIngest = useCallback(() => {
    setStage('ingest')
    setReviewDraft(null)
    setSuccess(null)
    setSourceInputs([])
    setRefreshTick(0)
  }, [])

  return {
    handleManualDraft,
    handlePromptSubmit,
    handleSubmit,
    isBuilding,
    isRefreshing,
    isSaving,
    localTimeZone,
    resetToIngest,
    reviewDraft,
    setTextSourceType,
    sourceInputs,
    stage,
    success,
    textSourceType,
    updateDraft,
  }
}

async function toSourceInputs(
  message: PromptInputMessage,
  textSourceType: TextSourceType,
): Promise<SourceInput[]> {
  const text = message.text.trim()
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
            : 'Pasted text',
      sourceType: textSourceType,
      text,
    })
  }

  for (const file of message.files) {
    if (!file.url || !file.mediaType?.startsWith('image/')) {
      continue
    }

    inputs.push({
      kind: 'image',
      id: crypto.randomUUID(),
      label: file.filename ?? 'Image upload',
      filename: file.filename,
      mediaType: file.mediaType,
      dataUrl: file.url,
    })
  }

  return inputs
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}
