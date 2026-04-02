import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceShell } from '@/components/app/workspace-shell'
import { getViewerSnapshot } from '@/lib/server/server-fns'

export const Route = createFileRoute('/')({
  loader: () => getViewerSnapshot(),
  component: IndexRouteComponent,
})

function IndexRouteComponent() {
  const viewer = Route.useLoaderData()
  return <WorkspaceShell viewer={viewer} />
}
