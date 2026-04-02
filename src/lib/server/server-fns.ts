import { createServerFn } from '@tanstack/react-start'

export const getViewerSnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  const { getViewer } = await import('@/lib/server/auth')
  return getViewer()
})
