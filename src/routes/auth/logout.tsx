import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/auth/logout')({
  server: {
    handlers: {
      GET: async () => {
        const { clearAuthSession } = await import('@/lib/server/auth')
        const { getServerEnv } = await import('@/lib/server/env')
        await clearAuthSession()
        return new Response(null, {
          status: 302,
          headers: {
            location: new URL('/', getServerEnv().APP_URL).toString(),
          },
        })
      },
    },
  },
  component: () => null,
})
