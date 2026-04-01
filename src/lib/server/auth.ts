import {
  deleteCookie,
  getCookie,
  getRequest,
  getRequestProtocol,
  setCookie,
} from '@tanstack/react-start/server'
import { getServerEnv } from '@/lib/server/env'
import { createCodeChallenge, createRandomString, decryptJson, encryptJson } from '@/lib/server/crypto'

const SESSION_COOKIE = 'gcalthing_session'
const OAUTH_STATE_TTL_SECONDS = 60 * 10
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
]

interface StoredOAuthState {
  codeVerifier: string
  returnTo: string
  createdAt: string
}

interface StoredSession {
  sessionId: string
  userSub: string
  createdAt: string
}

interface StoredTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  scope: string
  tokenType: string
}

interface StoredProfile {
  sub: string
  email: string
  name: string
  picture?: string
}

export interface SessionContext {
  sessionId: string
  profile: StoredProfile
  tokens: StoredTokens
}

export async function createGoogleAuthorizationUrl(returnTo = '/app') {
  const env = getServerEnv()
  const state = createRandomString()
  const codeVerifier = createRandomString(48)
  const codeChallenge = await createCodeChallenge(codeVerifier)

  const payload: StoredOAuthState = {
    codeVerifier,
    returnTo,
    createdAt: new Date().toISOString(),
  }

  await env.AUTH_KV.put(
    oauthStateKey(state),
    await encryptJson(env.SESSION_SECRET, payload),
    { expirationTtl: OAUTH_STATE_TTL_SECONDS },
  )

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
  url.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')

  return url.toString()
}

export async function handleGoogleOAuthCallback(code: string, state: string) {
  const env = getServerEnv()
  const sealedState = await env.AUTH_KV.get(oauthStateKey(state))
  if (!sealedState) {
    throw new Error('Missing or expired OAuth state')
  }

  await env.AUTH_KV.delete(oauthStateKey(state))

  const oauthState = await decryptJson<StoredOAuthState>(env.SESSION_SECRET, sealedState)
  const tokens = await exchangeGoogleCode({
    code,
    codeVerifier: oauthState.codeVerifier,
  })

  const previousProfile = await maybeLoadProfileFromToken(tokens.access_token)
  const profile = previousProfile ?? (await fetchGoogleProfile(tokens.access_token))
  const existingTokens = await getStoredTokens(profile.sub)

  const nextTokens: StoredTokens = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? existingTokens?.refreshToken ?? null,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
    tokenType: tokens.token_type,
  }

  await storeProfile(profile)
  await storeTokens(profile.sub, nextTokens)

  const sessionId = createRandomString(32)
  const storedSession: StoredSession = {
    sessionId,
    userSub: profile.sub,
    createdAt: new Date().toISOString(),
  }

  await env.AUTH_KV.put(sessionKey(sessionId), JSON.stringify(storedSession), {
    expirationTtl: SESSION_TTL_SECONDS,
  })

  setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestProtocol({ xForwardedProto: true }) === 'https',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })

  return {
    returnTo: oauthState.returnTo || '/app',
    profile,
  }
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const env = getServerEnv()
  const sessionId = getCookie(SESSION_COOKIE)

  if (!sessionId) {
    return null
  }

  const sessionValue = await env.AUTH_KV.get(sessionKey(sessionId))
  if (!sessionValue) {
    return null
  }

  const session = JSON.parse(sessionValue) as StoredSession
  const profile = await getStoredProfile(session.userSub)
  const tokens = await getStoredTokens(session.userSub)

  if (!profile || !tokens) {
    return null
  }

  const validTokens = await ensureFreshAccessToken(session.userSub, tokens)

  await env.AUTH_KV.put(sessionKey(sessionId), JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  })

  return {
    sessionId,
    profile,
    tokens: validTokens,
  }
}

export async function requireSessionContext() {
  const session = await getSessionContext()
  if (!session) {
    throw new Error('Authentication required')
  }
  return session
}

export async function clearAuthSession() {
  const env = getServerEnv()
  const sessionId = getCookie(SESSION_COOKIE)
  if (!sessionId) {
    return
  }

  const sessionValue = await env.AUTH_KV.get(sessionKey(sessionId))
  if (sessionValue) {
    const session = JSON.parse(sessionValue) as StoredSession
    await Promise.all([
      env.AUTH_KV.delete(sessionKey(sessionId)),
      env.AUTH_KV.delete(profileKey(session.userSub)),
      env.AUTH_KV.delete(tokenKey(session.userSub)),
    ])
  }

  deleteCookie(SESSION_COOKIE, {
    path: '/',
  })
}

export async function getViewer() {
  const session = await getSessionContext()
  if (!session) {
    return null
  }

  return {
    email: session.profile.email,
    name: session.profile.name,
    picture: session.profile.picture ?? null,
    sub: session.profile.sub,
  }
}

async function exchangeGoogleCode({
  code,
  codeVerifier,
}: {
  code: string
  codeVerifier: string
}) {
  const env = getServerEnv()
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: env.GOOGLE_REDIRECT_URI,
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`Failed to exchange Google OAuth code: ${response.status}`)
  }

  return (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
    token_type: string
    id_token?: string
  }
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const env = getServerEnv()
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`Failed to refresh Google access token: ${response.status}`)
  }

  return (await response.json()) as {
    access_token: string
    expires_in: number
    scope: string
    token_type: string
  }
}

async function fetchGoogleProfile(accessToken: string): Promise<StoredProfile> {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Google profile: ${response.status}`)
  }

  const data = (await response.json()) as {
    sub: string
    email: string
    name: string
    picture?: string
  }

  return {
    sub: data.sub,
    email: data.email,
    name: data.name,
    picture: data.picture,
  }
}

async function maybeLoadProfileFromToken(accessToken: string) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as {
    sub: string
    email: string
    name: string
    picture?: string
  }

  return {
    sub: data.sub,
    email: data.email,
    name: data.name,
    picture: data.picture,
  } satisfies StoredProfile
}

async function ensureFreshAccessToken(userSub: string, tokens: StoredTokens) {
  const safetyWindow = Date.now() + 60 * 1000
  if (tokens.expiresAt > safetyWindow) {
    return tokens
  }

  if (!tokens.refreshToken) {
    throw new Error('Missing refresh token')
  }

  const refreshed = await refreshGoogleAccessToken(tokens.refreshToken)
  const nextTokens: StoredTokens = {
    accessToken: refreshed.access_token,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    scope: refreshed.scope,
    tokenType: refreshed.token_type,
  }

  await storeTokens(userSub, nextTokens)
  return nextTokens
}

async function storeProfile(profile: StoredProfile) {
  const env = getServerEnv()
  await env.AUTH_KV.put(profileKey(profile.sub), JSON.stringify(profile), {
    expirationTtl: SESSION_TTL_SECONDS,
  })
}

async function storeTokens(userSub: string, tokens: StoredTokens) {
  const env = getServerEnv()
  await env.AUTH_KV.put(
    tokenKey(userSub),
    await encryptJson(env.TOKEN_ENCRYPTION_SECRET, tokens),
    {
      expirationTtl: SESSION_TTL_SECONDS,
    },
  )
}

async function getStoredProfile(userSub: string) {
  const env = getServerEnv()
  const value = await env.AUTH_KV.get(profileKey(userSub))
  return value ? (JSON.parse(value) as StoredProfile) : null
}

async function getStoredTokens(userSub: string) {
  const env = getServerEnv()
  const value = await env.AUTH_KV.get(tokenKey(userSub))
  if (!value) {
    return null
  }

  return decryptJson<StoredTokens>(env.TOKEN_ENCRYPTION_SECRET, value)
}

function oauthStateKey(state: string) {
  return `oauth-state:${state}`
}

function sessionKey(sessionId: string) {
  return `session:${sessionId}`
}

function profileKey(userSub: string) {
  return `user:${userSub}:profile`
}

function tokenKey(userSub: string) {
  return `user:${userSub}:tokens`
}

export function getCurrentRequestPath() {
  const request = getRequest()
  return new URL(request.url).pathname
}
