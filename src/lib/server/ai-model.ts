import { createAiGateway } from 'ai-gateway-provider'
import { createOpenAI } from 'ai-gateway-provider/providers/openai'
import type { LanguageModel } from 'ai'
import { getServerEnv } from '@/lib/server/env'

const modelCache = new Map<string, LanguageModel>()

export function getOpenAIModel(modelId: string): LanguageModel {
  const env = getServerEnv()
  const cacheKey = `${env.CF_AIG_ACCOUNT_ID}:${env.CF_AIG_GATEWAY}:${modelId}`
  const cached = modelCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const aigateway = createAiGateway({
    accountId: env.CF_AIG_ACCOUNT_ID,
    apiKey: env.CF_AIG_TOKEN,
    gateway: env.CF_AIG_GATEWAY,
  })
  const provider = createOpenAI({
    apiKey: env.OPENAI_API_KEY,
  })
  const model = aigateway(provider.chat(modelId))
  modelCache.set(cacheKey, model)
  return model
}
