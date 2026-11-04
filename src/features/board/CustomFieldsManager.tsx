import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Checkbox, Field, IconButton, Input, Select } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { deleteCustomField, saveCustomField, useCustomFields, type CustomField } from '@/data/cardExtras';
import { keyAfterLast } from '@/domain/ordering';
import type { Board } from '@/data/types';

const TYPES: { id: CustomField['type']; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'select', label: 'Dropdown' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'url', label: 'Web link' },
];

export function CustomFieldsManager({ board }: { board: Board }) {
  const fields = useCustomFields(board.project_id, board.id);
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomField['type']>('text');
  const [options, setOptions] = useState('');
  const toast = useToast();
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-grid">
        {(fields.data ?? []).map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 font-bold">{f.name}</span>
            <span className="text-secondary">{TYPES.find((t) => t.id === f.type)?.label}</span>
            {f.type === 'select' && <span className="text-xs text-secondary">{f.options.join(', ')}</span>}
            <Checkbox
              checked={f.show_on_card}
              onChange={(v) => saveCustomField({ id: f.id, board_id: f.board_id, project_id: f.project_id, show_on_card: v }).catch(toast.error)}
              label="Show on card"
            />
            <IconButton label={`Delete field ${f.name}`} onClick={() => deleteCustomField(f).catch(toast.error)}>
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
        {fields.data?.length === 0 && <li className="py-2 text-sm text-secondary">No custom fields on this board.</li>}
      </ul>
      <form
        className="flex flex-col gap-2 border-t border-grid pt-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const opts = options
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean);
          if (type === 'select' && opts.length === 0) {
            toast.error(new Error('Add at least one option for a dropdown.'));
            return;
          }
          try {
            await saveCustomField({
              board_id: board.id,
              project_id: board.project_id,
              name: name.trim(),
              type,
              options: type === 'select' ? opts : [],
              position: keyAfterLast(fields.data ?? []),
            });
            setName('');
            setOptions('');
          } catch (err) {
            toast.error(err);
          }
        }}
      >
        <div className="grid grid-cols-[1fr_140px] gap-2">
          <Field label="Field name" htmlFor="cf-name">
            <Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <Field label="Type" htmlFor="cf-type">
            <Select id="cf-type" value={type} onChange={(e) => setType(e.target.value as CustomField['type'])}>
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {type === 'select' && (
          <Field label="Options" htmlFor="cf-opts" hint="Separate options with commas.">
            <Input id="cf-opts" value={options} onChange={(e) => setOptions(e.target.value)} />
          </Field>
        )}
        <div>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Add field
          </Button>
        </div>
      </form>
    </div>
  );
}
