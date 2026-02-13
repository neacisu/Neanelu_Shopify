import { useEffect, useRef, useState } from 'react';

import { Button } from '../ui/button';

export type BudgetEditValues = Readonly<{
  serperDailyBudget?: number;
  serperBudgetAlertThreshold?: number;
  xaiDailyBudget?: number;
  xaiBudgetAlertThreshold?: number;
  openaiDailyBudget?: number;
  openaiBudgetAlertThreshold?: number;
  openaiItemsDailyBudget?: number;
}>;

type BudgetEditFormState = Partial<Record<keyof BudgetEditValues, string>>;

export type BudgetEditModalProps = Readonly<{
  open: boolean;
  initialValues?: BudgetEditValues;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (values: BudgetEditValues) => void;
}>;

const FIELD_CONFIG: readonly {
  key: keyof BudgetEditValues;
  label: string;
  placeholder?: string;
}[] = [
  { key: 'serperDailyBudget', label: 'Buget zilnic Serper (requests)', placeholder: '1000' },
  {
    key: 'serperBudgetAlertThreshold',
    label: 'Prag alerta Serper (0-1)',
    placeholder: '0.8',
  },
  { key: 'xaiDailyBudget', label: 'Buget zilnic xAI (USD)', placeholder: '1000' },
  { key: 'xaiBudgetAlertThreshold', label: 'Prag alerta xAI (0-1)', placeholder: '0.8' },
  { key: 'openaiDailyBudget', label: 'Buget zilnic OpenAI (USD)', placeholder: '10' },
  { key: 'openaiItemsDailyBudget', label: 'Buget zilnic OpenAI (items)', placeholder: '100000' },
  {
    key: 'openaiBudgetAlertThreshold',
    label: 'Prag alerta OpenAI (0-1)',
    placeholder: '0.8',
  },
];

function toFormState(values?: BudgetEditValues): BudgetEditFormState {
  if (!values) return {};
  const next: BudgetEditFormState = {};
  for (const [key, value] of Object.entries(values) as [
    keyof BudgetEditValues,
    number | undefined,
  ][]) {
    if (typeof value === 'number' && Number.isFinite(value)) next[key] = String(value);
  }
  return next;
}

function validate(values: BudgetEditFormState): Partial<Record<keyof BudgetEditValues, string>> {
  const errors: Partial<Record<keyof BudgetEditValues, string>> = {};
  for (const [key, raw] of Object.entries(values) as [
    keyof BudgetEditValues,
    string | undefined,
  ][]) {
    if (!raw?.trim()) continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      errors[key] = 'Valoare numerica invalida.';
      continue;
    }
    if (key.endsWith('Threshold')) {
      if (parsed < 0 || parsed > 1) errors[key] = 'Threshold-ul trebuie sa fie intre 0 si 1.';
      continue;
    }
    if (!Number.isInteger(parsed) && key.endsWith('ItemsDailyBudget')) {
      errors[key] = 'Valoarea trebuie sa fie numar intreg.';
      continue;
    }
    if (parsed <= 0) errors[key] = 'Valoarea trebuie sa fie mai mare decat 0.';
  }
  return errors;
}

export function BudgetEditModal({
  open,
  initialValues,
  isSubmitting = false,
  onClose,
  onSubmit,
}: BudgetEditModalProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = 'budget-edit-modal-title';
  const descriptionId = 'budget-edit-modal-description';
  const [form, setForm] = useState<BudgetEditFormState>({});
  const [errors, setErrors] = useState<Partial<Record<keyof BudgetEditValues, string>>>({});

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setForm(toFormState(initialValues));
      setErrors({});
      dialog.showModal();
      queueMicrotask(() => {
        const firstInput = dialog.querySelector<HTMLInputElement>('input');
        firstInput?.focus();
      });
      return;
    }
    if (!open && dialog.open) {
      dialog.close();
      triggerRef.current?.focus();
    }
  }, [open, initialValues]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog.open) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, []);

  const validationErrors = validate(form);
  const hasErrors = Object.keys(validationErrors).length > 0;

  const submit = () => {
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    const parsed: Partial<Record<keyof BudgetEditValues, number>> = {};
    for (const [key, value] of Object.entries(form) as [
      keyof BudgetEditValues,
      string | undefined,
    ][]) {
      if (!value?.trim()) continue;
      const n = Number(value);
      if (Number.isFinite(n)) parsed[key] = n;
    }
    onSubmit(parsed);
  };

  return (
    <dialog
      ref={ref}
      className="w-full max-w-xl rounded-lg border border-muted/20 bg-background p-0 shadow-lg backdrop:bg-black/40"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="border-b border-muted/20 p-4">
        <div id={titleId} className="text-h3">
          Editare bugete API
        </div>
        <div id={descriptionId} className="mt-1 text-xs text-muted">
          Configureaza limitele zilnice si pragurile de alerta pentru fiecare provider.
        </div>
      </div>
      <div className="grid gap-3 p-4">
        {Object.keys(errors).length > 0 ? (
          <div className="rounded-md border border-red-400/50 bg-red-50 p-2 text-xs text-red-700">
            Corecteaza campurile marcate inainte de salvare.
          </div>
        ) : null}
        {FIELD_CONFIG.map((field) => {
          const fieldId = `budget-edit-${field.key}`;
          const error = errors[field.key];
          return (
            <label key={field.key} className="grid gap-1 text-xs" htmlFor={fieldId}>
              {field.label}
              <input
                id={fieldId}
                inputMode="decimal"
                className={`rounded border bg-background px-2 py-1 ${
                  error ? 'border-red-500' : 'border-muted/30'
                }`}
                value={form[field.key] ?? ''}
                placeholder={field.placeholder}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${fieldId}-error` : undefined}
                onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
              {error ? (
                <span id={`${fieldId}-error`} className="text-[11px] text-red-600">
                  {error}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-muted/20 p-3">
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Anuleaza
        </Button>
        <Button onClick={submit} loading={isSubmitting} disabled={isSubmitting || hasErrors}>
          Salveaza
        </Button>
      </div>
    </dialog>
  );
}
