// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LandingPage } from '@/components/app/landing-page'

describe('LandingPage', () => {
  it('shows the Google sign-in CTA when signed out', () => {
    render(<LandingPage viewer={null} />)

    expect(
      screen.getByRole('link', { name: /sign in with google/i }).getAttribute('href'),
    ).toBe('/auth/login?returnTo=/app')
  })

  it('shows the workspace CTA when already signed in', () => {
    render(
      <LandingPage
        viewer={{
          email: 'olaf@example.com',
          name: 'Olaf',
          picture: null,
          sub: 'user-1',
        }}
      />,
    )

    expect(
      screen.getByRole('link', { name: /open workspace/i }).getAttribute('href'),
    ).toBe('/app')
  })
})
