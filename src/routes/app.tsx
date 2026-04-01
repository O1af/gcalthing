import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceShell } from '@/components/app/workspace-shell'
import { getViewerSnapshot } from '@/lib/server/server-fns'

export const Route = createFileRoute('/app')({
  loader: () => getViewerSnapshot(),
  component: AppRouteComponent,
})

function AppRouteComponent() {
  const viewer = Route.useLoaderData()
  return <WorkspaceShell viewer={viewer} />
}
