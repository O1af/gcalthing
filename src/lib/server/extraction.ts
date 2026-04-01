import { generateObject } from 'ai'
import type {
  BuildDraftInput,
  ExtractedEventDraft,
  FactsContext,
  NormalizedInput,
  SourceInput,
} from '@/lib/contracts'
import {
  extractedEventDraftSchema,
  llmExtractedEventDraftSchema,
  normalizedInputSchema,
} from '@/lib/contracts'
import { logDebug, withDebugTiming } from '@/lib/server/debug'
import { getServerEnv } from '@/lib/server/env'
import { getOpenAIModel } from '@/lib/server/ai-model'

export function normalizeSourceInputs(inputs: SourceInput[]): NormalizedInput[] {
  return inputs
    .map((input) => {
      if (input.kind === 'text') {
        return normalizedInputSchema.parse({
          id: input.id,
          kind: 'text',
          label: input.label,
          sourceType: input.sourceType,
          text: input.text.trim(),
          mediaType: null,
          dataUrl: null,
        })
      }

      return normalizedInputSchema.parse({
        id: input.id,
        kind: 'image',
        label: input.label,
        sourceType: 'image',
        text: null,
        mediaType: input.mediaType,
        dataUrl: input.dataUrl,
      })
    })
    .filter((input) => input.kind === 'image' || (input.text?.length ?? 0) > 0)
}

export async function extractStructuredDraft(
  input: BuildDraftInput,
  factsContext: FactsContext,
): Promise<ExtractedEventDraft> {
  const env = getServerEnv()
  const model = getOpenAIModel(env.OPENAI_MODEL)
  const normalizedInputs = normalizeSourceInputs(input.inputs)
  logDebug('ai:extract', 'request', {
    factSummaryCount: factsContext.promptSummary.length,
    inputCount: normalizedInputs.length,
    inputKinds: normalizedInputs.map((source) => source.kind),
    model: env.OPENAI_MODEL,
  })

  const result = await withDebugTiming('ai:extract', 'generateObject', async () => {
    const { object } = await generateObject({
      model,
      schema: llmExtractedEventDraftSchema,
      schemaName: 'calendar_event_draft',
      schemaDescription:
        'A cautious, evidence-backed calendar event draft that separates known facts from assumptions and ambiguity.',
      system: [
        'You extract calendar event drafts from mixed inputs.',
        'Never fabricate details.',
        'If a field is unknown, return null and list it in unknownFields.',
        'If the source is ambiguous, populate ambiguities and add multiple candidates.',
        'Assumptions must only contain assumptions, not facts.',
        'Confidence must reflect extraction certainty, not how easy it would be for a user to edit later.',
        `Current timestamp: ${new Date().toISOString()}.`,
        `Default local timezone to prefer when the source implies local time: ${input.localTimeZone}.`,
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Extract a structured event draft from these sources.',
                'Include evidence snippets for key fields.',
                'Shared facts may help disambiguate calendars, duration, attendees, and location history, but they must never create unsupported facts.',
                `Shared facts summary: ${JSON.stringify(factsContext.promptSummary)}`,
                ...normalizedInputs
                  .filter((source) => source.kind === 'text')
                  .map(
                    (source) =>
                      `Source ${source.label} (${source.sourceType}, id ${source.id}):\n${source.text}`,
                  ),
              ].join('\n\n'),
            },
            ...normalizedInputs
              .filter((source) => source.kind === 'image')
              .flatMap((source) =>
                source.dataUrl
                  ? [
                      {
                        type: 'text' as const,
                        text: `Image source ${source.label} (${source.mediaType ?? 'unknown'}, id ${source.id})`,
                      },
                      {
                        type: 'image' as const,
                        image: source.dataUrl,
                        mediaType: source.mediaType ?? undefined,
                      },
                    ]
                  : [],
              ),
          ],
        },
      ],
    })

    return extractedEventDraftSchema.parse(llmExtractedEventDraftSchema.parse(object))
  }, {
    model: env.OPENAI_MODEL,
  })

  logDebug('ai:extract', 'response', {
    ambiguityCount: result.ambiguities.length,
    confidence: Number(result.confidence.toFixed(2)),
    title: result.title ?? '(unknown)',
    unknownFieldCount: result.unknownFields.length,
  })

  return result
}
