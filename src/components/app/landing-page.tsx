import { ArrowRight, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LandingPageProps {
  viewer: {
    email: string
    name: string
    picture: string | null
    sub: string
  } | null
}

export function LandingPage({ viewer }: LandingPageProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="flex max-w-lg flex-col items-center gap-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]">
          <CalendarDays className="size-7" />
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Turn messy event info into a clean calendar draft
          </h1>
          <p className="text-base leading-relaxed text-[var(--muted-foreground)]">
            Paste text, drop a screenshot, or describe what you need.
            Review before anything is written to Google Calendar.
          </p>
        </div>

        <Button asChild size="lg" className="mt-2 gap-2 rounded-full px-6">
          <a href={viewer ? '/app' : '/auth/login?returnTo=/app'}>
            {viewer ? 'Open workspace' : 'Sign in with Google'}
            <ArrowRight className="size-4" />
          </a>
        </Button>

        {viewer && (
          <p className="text-sm text-[var(--muted-foreground)]">
            Signed in as {viewer.email}
          </p>
        )}

        <div className="mt-4 grid w-full gap-3 text-left sm:grid-cols-3">
          {[
            { title: 'Paste or drop', desc: 'Text, emails, screenshots — any format works.' },
            { title: 'Smart drafting', desc: 'Calendar context helps fill in the details.' },
            { title: 'Review first', desc: 'Nothing is created until you approve the draft.' },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
