import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { IconButton } from './index';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 520,
  className,
  hideTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
  hideTitle?: boolean;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-[rgba(42,40,37,0.35)]" />
        <RD.Content
          className={cn(
            'fixed left-1/2 top-[6vh] z-50 flex max-h-[88vh] w-[calc(100vw-24px)] -translate-x-1/2 flex-col rounded-[6px] border border-rule bg-surface',
            className,
          )}
          style={{ maxWidth: width }}
          aria-describedby={description ? undefined : undefined}
        >
          <div className={cn('flex items-start gap-3 border-b border-grid px-5 py-3', hideTitle && 'sr-only')}>
            <div className="min-w-0 flex-1">
              <RD.Title className="font-title text-xl leading-snug">{title}</RD.Title>
              {description && <RD.Description className="text-sm text-secondary">{description}</RD.Description>}
            </div>
            <RD.Close asChild>
              <IconButton label="Close">
                <X className="size-4" />
              </IconButton>
            </RD.Close>
          </div>
          {!description && <RD.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RD.Description>}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-grid px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width={440}
      footer={
        <>
          <button className="h-9 rounded-[4px] border border-rule px-3 hover:bg-hover" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            disabled={busy}
            className={cn(
              'h-9 rounded-[4px] border px-3',
              danger ? 'border-critical bg-critical text-white hover:opacity-90' : 'border-accent bg-accent text-accent-ink hover:opacity-90',
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm">{body}</div>
    </Dialog>
  );
}
