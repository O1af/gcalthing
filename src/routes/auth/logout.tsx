import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/auth/logout')({
  server: {
    handlers: {
      GET: async () => {
        const { clearAuthSession, redirect } = await import('@/lib/server/auth')
        const { getServerEnv } = await import('@/lib/server/env')
        await clearAuthSession()
        return redirect(new URL('/', getServerEnv().APP_URL))
      },
    },
  },
  component: () => null,
})
