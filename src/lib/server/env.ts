import { env as workerEnv } from 'cloudflare:workers'
import { z } from 'zod'

const serverEnvSchema = z.object({
  AUTH_KV: z.custom<KVNamespace>(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  TOKEN_ENCRYPTION_SECRET: z.string().min(16),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default('gpt-5-mini'),
  APP_URL: z.string().url(),
  AI_DEBUG: z
    .union([z.literal('0'), z.literal('1')])
    .optional()
    .default('0'),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

export function getServerEnv(): ServerEnv {
  return serverEnvSchema.parse(workerEnv)
}
