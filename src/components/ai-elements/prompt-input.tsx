'use client'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { cn, createSafeContext } from '@/lib/utils'
import type { ChatStatus, FileUIPart } from 'ai'
import { nanoid } from 'nanoid'
import { CornerDownLeftIcon, SquareIcon, XIcon } from 'lucide-react'
import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  ComponentProps,
  FormEvent,
  HTMLAttributes,
  KeyboardEventHandler,
  MouseEvent,
} from 'react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

type AttachmentFile = FileUIPart & { id: string }

interface AttachmentsContextValue {
  add: (files: File[] | FileList) => void
  clear: () => void
  fileInputId: string
  files: AttachmentFile[]
  openFileDialog: () => void
  remove: (id: string) => void
}

interface PromptInputContextValue {
  attachments: AttachmentsContextValue
  canSubmit: boolean
  setText: (value: string) => void
  text: string
}

const [PromptInputProvider, usePromptInputContext] = createSafeContext<PromptInputContextValue>('PromptInput')

function revokeFiles(files: AttachmentFile[]) {
  for (const file of files) {
    if (file.url) {
      URL.revokeObjectURL(file.url)
    }
  }
}

async function convertBlobUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function matchesAcceptPattern(file: File, accept?: string) {
  if (!accept?.trim()) {
    return true
  }

  return accept
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .some((pattern) => {
      if (pattern.endsWith('/*')) {
        return file.type.startsWith(pattern.slice(0, -1))
      }

      return file.type === pattern
    })
}

function toAttachmentFile(file: File): AttachmentFile {
  return {
    filename: file.name,
    id: nanoid(),
    mediaType: file.type,
    type: 'file',
    url: URL.createObjectURL(file),
  }
}

export function usePromptInputAttachments() {
  return usePromptInputContext().attachments
}

export interface PromptInputMessage {
  files: FileUIPart[]
  text: string
}

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  'onError' | 'onSubmit'
> & {
  accept?: string
  canSubmit?: boolean
  globalDrop?: boolean
  maxFiles?: number
  maxFileSize?: number
  multiple?: boolean
  onError?: (error: {
    code: 'accept' | 'max_file_size' | 'max_files'
    message: string
  }) => void
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>
}

export function PromptInput({
  accept,
  canSubmit = true,
  children,
  className,
  globalDrop,
  maxFiles,
  maxFileSize,
  multiple,
  onError,
  onSubmit,
  ...props
}: PromptInputProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<AttachmentFile[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const fileInputId = useId()

  useEffect(
    () => () => {
      setFiles((current) => {
        revokeFiles(current)
        return []
      })
    },
    [],
  )

  const clear = useCallback(() => {
    setFiles((previousFiles) => {
      revokeFiles(previousFiles)
      return []
    })
  }, [])

  const remove = useCallback((id: string) => {
    setFiles((previousFiles) => {
      const nextFiles = previousFiles.filter((file) => file.id !== id)
      const removedFile = previousFiles.find((file) => file.id === id)

      if (removedFile?.url) {
        URL.revokeObjectURL(removedFile.url)
      }

      return nextFiles
    })
  }, [])

  const add = useCallback(
    (incomingFiles: File[] | FileList) => {
      const filesToAdd = [...incomingFiles]
      const acceptedFiles = filesToAdd.filter((file) =>
        matchesAcceptPattern(file, accept),
      )

      if (filesToAdd.length > 0 && acceptedFiles.length === 0) {
        onError?.({
          code: 'accept',
          message: 'No files match the accepted types.',
        })
        return
      }

      const sizedFiles = acceptedFiles.filter((file) =>
        maxFileSize ? file.size <= maxFileSize : true,
      )

      if (acceptedFiles.length > 0 && sizedFiles.length === 0) {
        onError?.({
          code: 'max_file_size',
          message: 'All files exceed the maximum size.',
        })
        return
      }

      setFiles((previousFiles) => {
        const capacity =
          typeof maxFiles === 'number'
            ? Math.max(0, maxFiles - previousFiles.length)
            : undefined
        const nextFiles =
          typeof capacity === 'number'
            ? sizedFiles.slice(0, capacity)
            : sizedFiles

        if (typeof capacity === 'number' && sizedFiles.length > capacity) {
          onError?.({
            code: 'max_files',
            message: 'Too many files. Some were not added.',
          })
        }

        return [...previousFiles, ...nextFiles.map(toAttachmentFile)]
      })
    },
    [accept, maxFileSize, maxFiles, onError],
  )

  const openFileDialog = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files)
      }

      event.currentTarget.value = ''
    },
    [add],
  )

  useEffect(() => {
    const target = globalDrop ? document : formRef.current
    if (!target) return

    const handleDragOver = (event: Event) => {
      if ((event as DragEvent).dataTransfer?.types?.includes('Files')) {
        event.preventDefault()
      }
    }

    const handleDrop = (event: Event) => {
      const dragEvent = event as DragEvent
      if (dragEvent.dataTransfer?.types?.includes('Files')) {
        event.preventDefault()
      }
      if (dragEvent.dataTransfer?.files?.length) {
        add(dragEvent.dataTransfer.files)
      }
    }

    target.addEventListener('dragover', handleDragOver)
    target.addEventListener('drop', handleDrop)

    return () => {
      target.removeEventListener('dragover', handleDragOver)
      target.removeEventListener('drop', handleDrop)
    }
  }, [add, globalDrop])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      const submittedText = text
      const submittedFiles = files

      setFiles([])
      setText('')
      event.currentTarget.reset()

      try {
        const convertedFiles = await Promise.all(
          submittedFiles.map(async ({ id: _id, ...file }) => {
            if (!file.url.startsWith('blob:')) {
              return file
            }

            const dataUrl = await convertBlobUrlToDataUrl(file.url)

            return {
              ...file,
              url: dataUrl ?? file.url,
            }
          }),
        )

        await Promise.resolve(onSubmit({ files: convertedFiles, text: submittedText }, event))
        revokeFiles(submittedFiles)
      } catch {
        setText(submittedText)
        setFiles(submittedFiles)
      }
    },
    [files, onSubmit, text],
  )

  const contextValue = useMemo<PromptInputContextValue>(
    () => ({
      attachments: {
        add,
        clear,
        fileInputId,
        files,
        openFileDialog,
        remove,
      },
      canSubmit,
      setText,
      text,
    }),
    [add, canSubmit, clear, fileInputId, files, openFileDialog, remove, text],
  )

  return (
    <PromptInputProvider value={contextValue}>
      <input
        accept={accept}
        aria-label="Upload files"
        className="sr-only"
        id={fileInputId}
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title="Upload files"
        type="file"
      />
      <form
        className={cn('w-full', className)}
        onSubmit={handleSubmit}
        ref={formRef}
        {...props}
      >
        <InputGroup className="overflow-hidden">{children}</InputGroup>
      </form>
    </PromptInputProvider>
  )
}

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>

export function PromptInputBody({ className, ...props }: PromptInputBodyProps) {
  return <div className={cn('contents', className)} {...props} />
}

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>

export function PromptInputTextarea({
  className,
  onChange,
  onKeyDown,
  onPaste,
  placeholder = 'What would you like to know?',
  ...props
}: PromptInputTextareaProps) {
  const { attachments, canSubmit, setText, text } = usePromptInputContext()
  const [isComposing, setIsComposing] = useState(false)

  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLTextAreaElement>>(
    (event) => {
      onKeyDown?.(event)
      if (event.defaultPrevented) {
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        if (isComposing || event.nativeEvent.isComposing || !canSubmit) {
          return
        }

        event.preventDefault()
        event.currentTarget.form?.requestSubmit()
        return
      }

      if (
        event.key === 'Backspace' &&
        event.currentTarget.value === '' &&
        attachments.files.length > 0
      ) {
        event.preventDefault()
        const lastAttachment = attachments.files.at(-1)
        if (lastAttachment) {
          attachments.remove(lastAttachment.id)
        }
      }
    },
    [attachments, canSubmit, isComposing, onKeyDown],
  )

  const handlePaste = useCallback<ClipboardEventHandler<HTMLTextAreaElement>>(
    (event) => {
      onPaste?.(event)
      if (event.defaultPrevented) {
        return
      }

      const pastedFiles = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null)

      if (pastedFiles.length === 0) {
        return
      }

      event.preventDefault()
      attachments.add(pastedFiles)
    },
    [attachments, onPaste],
  )

  return (
    <InputGroupTextarea
      aria-label={placeholder}
      className={cn('field-sizing-content max-h-48 min-h-16', className)}
      name="message"
      onChange={(event) => {
        setText(event.currentTarget.value)
        onChange?.(event)
      }}
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      value={text}
      {...props}
    />
  )
}

export type PromptInputHeaderProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  'align'
>

export function PromptInputHeader({
  className,
  ...props
}: PromptInputHeaderProps) {
  return (
    <InputGroupAddon
      align="block-end"
      className={cn('order-first flex-wrap gap-1', className)}
      {...props}
    />
  )
}

export type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  'align'
>

export function PromptInputFooter({
  className,
  ...props
}: PromptInputFooterProps) {
  return (
    <InputGroupAddon
      align="block-end"
      className={cn('justify-between gap-1', className)}
      {...props}
    />
  )
}

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>

export function PromptInputTools({
  className,
  ...props
}: PromptInputToolsProps) {
  return <div className={cn('flex min-w-0 items-center gap-1', className)} {...props} />
}

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  onStop?: () => void
  status?: ChatStatus
}

export function PromptInputSubmit({
  children,
  className,
  onClick,
  onStop,
  size = 'icon-sm',
  status,
  variant = 'default',
  ...props
}: PromptInputSubmitProps) {
  const isGenerating = status === 'submitted' || status === 'streaming'

  let icon = <CornerDownLeftIcon className="size-4" />
  if (status === 'submitted') {
    icon = <Spinner />
  } else if (status === 'streaming') {
    icon = <SquareIcon className="size-4" />
  } else if (status === 'error') {
    icon = <XIcon className="size-4" />
  }

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (isGenerating && onStop) {
        event.preventDefault()
        onStop()
        return
      }

      onClick?.(event)
    },
    [isGenerating, onClick, onStop],
  )

  return (
    <InputGroupButton
      aria-label={isGenerating ? 'Stop' : 'Submit'}
      className={cn(className)}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? 'button' : 'submit'}
      variant={variant}
      {...props}
    >
      {children ?? icon}
    </InputGroupButton>
  )
}
