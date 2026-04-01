import { createFileRoute } from '@tanstack/react-router'
import { LandingPage } from '@/components/app/landing-page'
import { getViewerSnapshot } from '@/lib/server/server-fns'

export const Route = createFileRoute('/')({
  loader: () => getViewerSnapshot(),
  component: IndexRouteComponent,
})

function IndexRouteComponent() {
  const viewer = Route.useLoaderData()
  return <LandingPage viewer={viewer} />
}
