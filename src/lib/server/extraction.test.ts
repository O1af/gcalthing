import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  env: {
    APP_URL: 'http://localhost:3000',
    AUTH_KV: {},
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/callback',
    OPENAI_API_KEY: 'test',
    OPENAI_MODEL: 'gpt-5-mini',
    SESSION_SECRET: 'test-session-secret-value',
    TOKEN_ENCRYPTION_SECRET: 'test-token-secret-value',
  },
}))

import { normalizeSourceInputs } from '@/lib/server/extraction'

describe('normalizeSourceInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps non-empty text and image inputs in a unified shape', () => {
    const result = normalizeSourceInputs([
      {
        kind: 'text',
        id: 't1',
        label: 'Pasted text',
        sourceType: 'pasted-text',
        text: '  coffee with Alex tomorrow afternoon  ',
      },
      {
        kind: 'image',
        id: 'i1',
        label: 'Screenshot',
        filename: 'shot.png',
        mediaType: 'image/png',
        dataUrl: 'data:image/png;base64,abc123',
      },
    ])

    expect(result).toEqual([
      {
        id: 't1',
        kind: 'text',
        label: 'Pasted text',
        sourceType: 'pasted-text',
        text: 'coffee with Alex tomorrow afternoon',
        mediaType: null,
        dataUrl: null,
      },
      {
        id: 'i1',
        kind: 'image',
        label: 'Screenshot',
        sourceType: 'image',
        text: null,
        mediaType: 'image/png',
        dataUrl: 'data:image/png;base64,abc123',
      },
    ])
  })

  it('drops empty text inputs', () => {
    const result = normalizeSourceInputs([
      {
        kind: 'text',
        id: 't1',
        label: 'Whitespace',
        sourceType: 'pasted-text',
        text: '   ',
      },
    ])

    expect(result).toEqual([])
  })
})
