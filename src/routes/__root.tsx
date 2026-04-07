import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'

import appCss from '../styles.css?url'

const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;700&display=swap'

const TanStackDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-devtools').then((m) => ({ default: m.TanStackDevtools })),
    )
  : null
const TanStackRouterDevtoolsPanel = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-router-devtools').then((m) => ({ default: m.TanStackRouterDevtoolsPanel })),
    )
  : null

const TOAST_OPTIONS = {
  className:
    'border border-[var(--border)] bg-[var(--panel-strong)] text-[var(--foreground)] shadow-[var(--shadow-panel)]',
} as const

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'GCalthing',
      },
    ],
    links: [
      {
        rel: 'icon',
        type: 'image/png',
        href: '/logo.png',
      },
      {
        rel: 'apple-touch-icon',
        href: '/logo.png',
      },
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: GOOGLE_FONTS_URL,
      },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  notFoundComponent: RootNotFound,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body
        className="font-sans antialiased [overflow-wrap:anywhere]"
        suppressHydrationWarning
      >
        <TooltipProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={TOAST_OPTIONS}
          />
          {TanStackDevtools && TanStackRouterDevtoolsPanel ? (
            <Suspense>
              <TanStackDevtools
                config={{
                  position: 'bottom-right',
                }}
                plugins={[
                  {
                    name: 'Tanstack Router',
                    render: <TanStackRouterDevtoolsPanel />,
                  },
                ]}
              />
            </Suspense>
          ) : null}
          <Scripts />
        </TooltipProvider>
      </body>
    </html>
  )
}

function RootNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 py-16 text-[var(--foreground)]">
      <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--panel-strong)] p-8 shadow-[var(--shadow-panel)]">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
          404
        </p>
        <h1 className="mt-4 font-display text-4xl leading-none">
          Page not found
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
          The route you requested does not exist in this workspace.
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link to="/">Return home</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
