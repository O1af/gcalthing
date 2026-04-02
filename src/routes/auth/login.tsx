import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/auth/login')({
  server: {
    handlers: {
      GET: async () => {
        const { getRequest } = await import('@tanstack/react-start/server')
        const { createGoogleAuthorizationUrl } = await import('@/lib/server/auth')
        const request = getRequest()
        const url = new URL(request.url)
        const returnTo = url.searchParams.get('returnTo') ?? '/'
        return new Response(null, {
          status: 302,
          headers: {
            location: await createGoogleAuthorizationUrl(returnTo),
          },
        })
      },
    },
  },
  component: () => null,
})
