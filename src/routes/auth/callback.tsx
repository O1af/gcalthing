import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/auth/callback')({
  server: {
    handlers: {
      GET: async () => {
        const { getRequest } = await import('@tanstack/react-start/server')
        const { getServerEnv } = await import('@/lib/server/env')
        const { handleGoogleOAuthCallback, redirect } = await import('@/lib/server/auth')
        const request = getRequest()
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const appUrl = new URL(getServerEnv().APP_URL)

        if (!code || !state) {
          appUrl.pathname = '/'
          appUrl.searchParams.set('authError', 'missing_code')
          return redirect(appUrl)
        }

        try {
          const { returnTo } = await handleGoogleOAuthCallback(code, state)
          appUrl.pathname = returnTo
          appUrl.search = ''
          return redirect(appUrl)
        } catch (error) {
          appUrl.pathname = '/'
          appUrl.searchParams.set(
            'authError',
            error instanceof Error ? error.message : 'oauth_failed',
          )
          return redirect(appUrl)
        }
      },
    },
  },
  component: () => null,
})
