import { useState } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { runButton, useButtons, type RuleRow } from '@/data/automation';

/** Board buttons (board_button automations) for the board header. */
export function BoardButtons({ projectId, boardId, canEdit }: { projectId: string; boardId: string; canEdit: boolean }) {
  const buttons = useButtons(projectId, boardId, 'board_button');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  if (!canEdit || !buttons.data?.length) return null;

  const press = async (b: RuleRow) => {
    setBusy(b.id);
    try {
      const n = await runButton(b, null);
      toast.show(`${b.name}: ${n} action${n === 1 ? '' : 's'} applied`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  if (buttons.data.length === 1) {
    const b = buttons.data[0];
    return (
      <Button size="sm" variant="ghost" icon={<Zap className="size-3.5" />} loading={busy === b.id} onClick={() => press(b)}>
        {b.name}
      </Button>
    );
  }
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button size="sm" variant="ghost" icon={<Zap className="size-3.5" />} loading={Boolean(busy)}>
          Buttons
        </Button>
      </MenuTrigger>
      <MenuContent>
        {buttons.data.map((b) => (
          <MenuItem key={b.id} icon={<Zap className="size-4" />} onSelect={() => press(b)}>
            {b.name}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
