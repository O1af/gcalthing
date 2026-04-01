import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { getServerEnv } from '@/lib/server/env'

const modelCache = new Map<string, LanguageModel>()

export function getOpenAIModel(modelId: string): LanguageModel {
  const cached = modelCache.get(modelId)
  if (cached) {
    return cached
  }

  const env = getServerEnv()
  const provider = createOpenAI({
    apiKey: env.OPENAI_API_KEY,
  })
  const model = provider(modelId)
  modelCache.set(modelId, model)
  return model
}
