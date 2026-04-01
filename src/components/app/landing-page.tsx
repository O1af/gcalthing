import { ArrowRight, CalendarClock, MailOpen, ScanSearch } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface LandingPageProps {
  viewer: {
    email: string
    name: string
    picture: string | null
    sub: string
  } | null
}

const features = [
  {
    title: 'Paste, drop, or screenshot',
    description:
      'Start from messy text, an interview email, or a screenshot from messages and flyers.',
    icon: ScanSearch,
  },
  {
    title: 'Context-aware event drafts',
    description:
      'Recent Google Calendar history helps suggest likely attendees, duration, and calendar placement.',
    icon: CalendarClock,
  },
  {
    title: 'Review before writing',
    description:
      'Ambiguity, conflicts, and likely duplicates stay visible so the app never quietly invents details.',
    icon: MailOpen,
  },
]

export function LandingPage({ viewer }: LandingPageProps) {
  return (
    <main className="page-shell px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
      <section className="glass-panel fade-up overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-12">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div className="space-y-6">
            <Badge variant="outline" className="rounded-full px-4 py-1.5">
              Google Calendar Drafting MVP
            </Badge>
            <div className="space-y-4">
              <h1 className="display-font max-w-3xl text-5xl leading-[0.95] tracking-tight text-balance sm:text-7xl">
                Turn messy event info into a clean calendar draft.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-[var(--muted-foreground)]">
                Paste text, drop a screenshot, or forward email copy. The app extracts
                the event, checks recent calendar context, and lets you review before
                anything is written.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="rounded-full">
                <a href={viewer ? '/app' : '/auth/login?returnTo=/app'}>
                  {viewer ? 'Open Workspace' : 'Sign In With Google'}
                  <ArrowRight className="size-4" />
                </a>
              </Button>
              <Button asChild variant="outline" size="lg" className="rounded-full">
                <a href="#how-it-works">How it works</a>
              </Button>
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              {viewer
                ? `Signed in as ${viewer.email}. Continue to the review workspace.`
                : 'Scopes are kept tight for MVP: Google identity, Calendar read/write, calendar list, and free/busy.'}
            </p>
          </div>

          <div className="soft-grid rounded-[1.75rem] border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-6">
            <div className="glass-panel rounded-[1.5rem] p-5">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--muted-foreground)]">
                    Example review outcome
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">Meet Sarah at Frita Batidos</h2>
                </div>
                <Badge>0.82 confidence</Badge>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-2xl bg-[var(--secondary)] p-4">
                  <dt className="text-[var(--muted-foreground)]">Time</dt>
                  <dd className="mt-1 font-medium">Tuesday, 5:00 PM to 6:00 PM</dd>
                </div>
                <div className="rounded-2xl bg-[var(--secondary)] p-4">
                  <dt className="text-[var(--muted-foreground)]">Calendar</dt>
                  <dd className="mt-1 font-medium">Primary, based on recent history</dd>
                </div>
                <div className="rounded-2xl bg-[var(--secondary)] p-4">
                  <dt className="text-[var(--muted-foreground)]">Attendee suggestion</dt>
                  <dd className="mt-1 font-medium">Sarah Kim · high confidence</dd>
                </div>
                <div className="rounded-2xl bg-[var(--secondary)] p-4">
                  <dt className="text-[var(--muted-foreground)]">Warnings</dt>
                  <dd className="mt-1 font-medium">No conflicts, no duplicate found</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {features.map(({ description, icon: Icon, title }) => (
          <Card key={title} className="fade-up border-[var(--border)] bg-[var(--panel)]">
            <CardHeader>
              <div className="flex size-11 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]">
                <Icon className="size-5" />
              </div>
              <CardTitle className="text-xl font-semibold">{title}</CardTitle>
              <CardDescription className="text-sm leading-7">
                {description}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-[var(--muted-foreground)]">
              Built for a low-friction review flow on top of TanStack Start, Cloudflare
              Workers, Google Calendar, and the OpenAI provider.
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  )
}
