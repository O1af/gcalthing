const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function createRandomString(bytes = 32) {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  return base64UrlEncode(values)
}

export async function createCodeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

export async function encryptJson(
  secret: string,
  value: unknown,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveAesKey(secret)
  const serialized = encoder.encode(JSON.stringify(value))
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    serialized,
  )

  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(cipherBuffer))}`
}

export async function decryptJson<T>(secret: string, payload: string): Promise<T> {
  const [ivPart, cipherPart] = payload.split('.')
  if (!ivPart || !cipherPart) {
    throw new Error('Invalid encrypted payload format')
  }

  const key = await deriveAesKey(secret)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(ivPart) },
    key,
    base64UrlDecode(cipherPart),
  )

  return JSON.parse(decoder.decode(decrypted)) as T
}

async function deriveAesKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))

  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

function base64UrlEncode(value: Uint8Array) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Uint8Array.from(Buffer.from(`${normalized}${padding}`, 'base64'))
}
