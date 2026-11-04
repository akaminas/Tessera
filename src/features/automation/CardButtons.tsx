import { useState } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { runButton, useButtons } from '@/data/automation';

/** Task buttons (card_button automations) for the card side panel. */
export function CardButtons({ projectId, boardId, cardId, canEdit }: { projectId: string; boardId: string; cardId: string; canEdit: boolean }) {
  const buttons = useButtons(projectId, boardId, 'card_button');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  if (!canEdit || !buttons.data?.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-bold text-secondary">Buttons</span>
      {buttons.data.map((b) => (
        <Button
          key={b.id}
          size="sm"
          variant="secondary"
          className="justify-start"
          icon={<Zap className="size-3.5" />}
          loading={busy === b.id}
          onClick={async () => {
            setBusy(b.id);
            try {
              const n = await runButton(b, cardId);
              toast.show(`${b.name}: ${n} action${n === 1 ? '' : 's'} applied`);
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(null);
            }
          }}
        >
          {b.name}
        </Button>
      ))}
    </div>
  );
}
