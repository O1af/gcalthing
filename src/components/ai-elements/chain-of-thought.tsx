"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn, createSafeContext } from "@/lib/utils";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ImgHTMLAttributes } from "react";
import { memo } from "react";

interface ChainOfThoughtContextValue {
  isOpen: boolean;
}

const [ChainOfThoughtProvider, useChainOfThought] =
  createSafeContext<ChainOfThoughtContextValue>("ChainOfThought");

export type ChainOfThoughtProps = ComponentProps<typeof Collapsible>;

export const ChainOfThought = memo(
  ({
    className,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      defaultProp: defaultOpen,
      onChange: onOpenChange,
      prop: open,
    });

    return (
      <ChainOfThoughtProvider value={{ isOpen }}>
        <Collapsible
          className={cn(
            "overflow-hidden rounded-xl border border-[var(--border)]/70 bg-[var(--card)]/50",
            className,
          )}
          onOpenChange={setIsOpen}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ChainOfThoughtProvider>
    );
  },
);

export type ChainOfThoughtHeaderProps = ComponentProps<typeof CollapsibleTrigger>;

export const ChainOfThoughtHeader = memo(
  ({ children, className, ...props }: ChainOfThoughtHeaderProps) => {
    const { isOpen } = useChainOfThought();

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <SparklesIcon className="size-4" />
            <span className="font-medium">Chain of thought</span>
          </>
        )}
        <ChevronDownIcon
          className={cn(
            "ml-auto size-4 transition-transform",
            isOpen ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
    );
  },
);

export type ChainOfThoughtContentProps = ComponentProps<typeof CollapsibleContent>;

export const ChainOfThoughtContent = memo(
  ({ className, ...props }: ChainOfThoughtContentProps) => (
    <CollapsibleContent
      className={cn(
        "border-t border-[var(--border)]/60 px-3 py-3",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className,
      )}
      {...props}
    />
  ),
);

type ChainOfThoughtStepStatus = "complete" | "active" | "pending";

export type ChainOfThoughtStepProps = HTMLAttributes<HTMLDivElement> & {
  icon?: LucideIcon;
  label?: string;
  description?: string;
  status?: ChainOfThoughtStepStatus;
};

export const ChainOfThoughtStep = memo(
  ({
    children,
    className,
    description,
    icon: Icon,
    label,
    status = "pending",
    ...props
  }: ChainOfThoughtStepProps) => (
    <div
      className={cn("grid grid-cols-[auto_1fr] gap-3 rounded-lg px-1 py-2", className)}
      {...props}
    >
      <div className="pt-0.5">{Icon ? <Icon className="size-4 text-muted-foreground" /> : <StepStatusIcon status={status} />}</div>
      <div className="min-w-0 space-y-2">
        {label ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{label}</span>
              <StepStatusBadge status={status} />
            </div>
            {description ? (
              <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  ),
);

export type ChainOfThoughtSearchResultsProps = HTMLAttributes<HTMLDivElement>;

export function ChainOfThoughtSearchResults({
  className,
  ...props
}: ChainOfThoughtSearchResultsProps) {
  return <div className={cn("flex flex-wrap gap-2", className)} {...props} />;
}

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>;

export function ChainOfThoughtSearchResult({
  className,
  variant = "outline",
  ...props
}: ChainOfThoughtSearchResultProps) {
  return <Badge className={cn("max-w-full", className)} variant={variant} {...props} />;
}

export type ChainOfThoughtImageProps = HTMLAttributes<HTMLDivElement> & {
  caption?: string;
  imageProps?: ImgHTMLAttributes<HTMLImageElement>;
};

export function ChainOfThoughtImage({
  caption,
  children,
  className,
  imageProps,
  ...props
}: ChainOfThoughtImageProps) {
  const alt = imageProps?.alt ?? caption ?? "";

  return (
    <div className={cn("space-y-2", className)} {...props}>
      {imageProps ? (
        <img
          className="max-h-64 w-full rounded-lg border border-[var(--border)] object-cover"
          alt={alt}
          {...imageProps}
        />
      ) : null}
      {children}
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}

function StepStatusIcon({ status }: { status: ChainOfThoughtStepStatus }) {
  if (status === "complete") {
    return <CheckCircle2Icon className="size-4 text-emerald-600" />;
  }

  if (status === "active") {
    return <CircleDashedIcon className="size-4 animate-spin text-[var(--primary)]" />;
  }

  return <CircleDashedIcon className="size-4 text-muted-foreground" />;
}

function StepStatusBadge({ status }: { status: ChainOfThoughtStepStatus }) {
  if (status === "complete") {
    return <Badge variant="outline">Complete</Badge>;
  }

  if (status === "active") {
    return <Badge variant="secondary">Active</Badge>;
  }

  return <Badge variant="outline">Pending</Badge>;
}

ChainOfThought.displayName = "ChainOfThought";
ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader";
ChainOfThoughtContent.displayName = "ChainOfThoughtContent";
ChainOfThoughtStep.displayName = "ChainOfThoughtStep";
