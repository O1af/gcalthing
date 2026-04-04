// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'

describe('PromptInput', () => {
  it('clears the textarea immediately after submit', async () => {
    const user = userEvent.setup()
    let resolveSubmit: (() => void) | undefined

    render(
      <PromptInput
        onSubmit={() =>
          new Promise<void>((resolve) => {
            resolveSubmit = resolve
          })}
      >
        <PromptInputBody>
          <PromptInputTextarea placeholder="Ask something" />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputSubmit />
        </PromptInputFooter>
      </PromptInput>,
    )

    const textarea = screen.getByRole('textbox', { name: 'Ask something' })
    await user.type(textarea, 'Check my calendar tomorrow')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(textarea).toHaveProperty('value', '')

    resolveSubmit?.()
  })
})
