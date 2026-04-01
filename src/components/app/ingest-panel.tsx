'use client'

import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TextSourceType } from '@/components/app/use-draft-workflow'
import { WandSparkles } from 'lucide-react'

interface IngestPanelProps {
  isBuilding: boolean
  onManualDraft: () => void
  onPromptSubmit: (message: PromptInputMessage) => Promise<void>
  setTextSourceType: (value: TextSourceType) => void
  textSourceType: TextSourceType
}

export function IngestPanel({
  isBuilding,
  onManualDraft,
  onPromptSubmit,
  setTextSourceType,
  textSourceType,
}: IngestPanelProps) {
  return (
    <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <Card className="rounded-4xl">
        <CardHeader>
          <Badge className="w-fit">Full flow</Badge>
          <CardTitle className="display-font text-5xl leading-none">
            One clean flow from messy input to reviewed event.
          </CardTitle>
          <CardDescription className="max-w-xl text-base leading-7">
            Paste text, paste email copy, upload a screenshot, or capture one directly.
            The app extracts a draft, enriches it with recent calendar context and shared
            facts, then stops for review before writing anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            'Recent attendee history helps rank likely email matches.',
            'Shared facts persist confirmed patterns across sessions and devices.',
            'Similar events trigger an explicit create-vs-update choice instead of a silent guess.',
          ].map((item) => (
            <div
              key={item}
              className="flex items-start gap-3 rounded-2xl bg-secondary p-4 text-sm"
            >
              <WandSparkles className="mt-0.5 size-4 text-[var(--primary)]" />
              <p className="leading-6">{item}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-[2rem]">
        <CardHeader>
          <CardTitle>Start a draft</CardTitle>
          <CardDescription>
            Choose the text source type, then add text plus images or screenshots as needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Text source type</p>
              <Select value={textSourceType} onValueChange={(value) => setTextSourceType(value as TextSourceType)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select text source type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pasted-text">Pasted text</SelectItem>
                  <SelectItem value="email-body">Email body</SelectItem>
                  <SelectItem value="forwarded-email">Forwarded email</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <PromptInput
              accept="image/*"
              className="space-y-4"
              maxFileSize={8_000_000}
              maxFiles={4}
              multiple
              onSubmit={onPromptSubmit}
            >
              <div className="rounded-[1.7rem] border border-[var(--input-border)] bg-[var(--input)] p-3 shadow-xs">
                <PromptInputTextarea
                  className="min-h-[220px] rounded-[1.4rem] border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
                  name="message"
                  placeholder="Paste a message, email copy, or event text. Then add a screenshot or image if you have one."
                />
                <PromptInputFooter className="mt-3 flex items-center justify-between gap-3">
                  <PromptInputTools>
                    <PromptInputActionMenu>
                      <PromptInputActionMenuTrigger />
                      <PromptInputActionMenuContent>
                        <PromptInputActionAddAttachments label="Add image or screenshot" />
                        <PromptInputActionAddScreenshot label="Capture screenshot" />
                      </PromptInputActionMenuContent>
                    </PromptInputActionMenu>
                  </PromptInputTools>
                  <PromptInputSubmit
                    disabled={isBuilding}
                    status={isBuilding ? 'submitted' : 'ready'}
                  />
                </PromptInputFooter>
              </div>
            </PromptInput>

            <div className="rounded-[1.6rem] border border-dashed border-[var(--border)] bg-[var(--secondary)] p-6">
              <h3 className="text-lg font-semibold">Skip extraction</h3>
              <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
                Open the review form directly and let enrichment populate context as you
                fill the event details.
              </p>
              <Button className="mt-4" onClick={onManualDraft}>
                Open Manual Draft
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
