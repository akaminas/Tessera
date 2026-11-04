import * as DM from '@radix-ui/react-dropdown-menu';
import * as PO from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const MenuRoot = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={4}
        className={cn('z-50 min-w-[200px] rounded-[4px] border border-rule bg-surface p-1 text-sm', className)}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
  shortcut,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-pointer items-center gap-2 rounded-[3px] px-2 outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-50',
        danger && 'text-critical',
      )}
    >
      <span className="flex w-4 justify-center text-secondary">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <span className="font-mono text-[11px] text-muted">{shortcut}</span>}
    </DM.Item>
  );
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-grid" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2 py-1 text-xs text-secondary">{children}</DM.Label>;
}

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: 'start' | 'end' | 'center';
  className?: string;
}) {
  return (
    <PO.Root open={open} onOpenChange={onOpenChange}>
      <PO.Trigger asChild>{trigger}</PO.Trigger>
      <PO.Portal>
        <PO.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          className={cn('z-50 w-72 rounded-[4px] border border-rule bg-surface p-3 text-sm', className)}
        >
          {children}
        </PO.Content>
      </PO.Portal>
    </PO.Root>
  );
}
