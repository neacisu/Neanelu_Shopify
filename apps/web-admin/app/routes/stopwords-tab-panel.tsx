import { useMemo, useState } from 'react';
import type {
  LexAccessPermissions,
  LexGovernanceRequestDto,
  LexShopSettingsDto,
  LexStopwordDto,
} from '@app/types';

import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { EmptyState } from '../components/patterns/empty-state';
import { TextField } from '../components/ui/text-field';
import type { LexConfirmOptions } from '../hooks/use-lex-confirm-modal';

export type LexStopwordCreatePayload = Readonly<{
  locale: string;
  word: string;
  wordType: string;
  priority: number;
  isActive: boolean;
}>;

export type LexStopwordUpdatePayload = Readonly<{
  expectedVersion: number;
  word: string;
  wordType: string;
  priority: number;
  isActive: boolean;
}>;

export type StopwordsTabPanelProps = Readonly<{
  stopwords: LexStopwordDto[];
  settings: LexShopSettingsDto | null;
  permissions: LexAccessPermissions;
  loadAll: () => Promise<void>;
  refreshStopwords: () => Promise<void>;
  createLexStopword: (payload: LexStopwordCreatePayload) => Promise<void>;
  updateLexStopword: (id: string, payload: LexStopwordUpdatePayload) => Promise<void>;
  deleteLexStopword: (id: string, expectedVersion: number) => Promise<void>;
  requestLexConfirm: (options: LexConfirmOptions, action: () => Promise<void>) => Promise<boolean>;
  handlePromoteToGovernance: (
    entityType: LexGovernanceRequestDto['entityType'],
    targetId: string,
    title: string,
    payload: Record<string, unknown>
  ) => Promise<void>;
  loadMore?: Readonly<{ hasMore: boolean; loading: boolean; onLoadMore: () => void }>;
}>;

type FormState = Readonly<{
  locale: string;
  word: string;
  wordType: string;
  priority: string;
  isActive: boolean;
}>;

const emptyForm = (defaultLocale: string): FormState => ({
  locale: defaultLocale,
  word: '',
  wordType: 'noise',
  priority: '100',
  isActive: true,
});

function stopwordToForm(s: LexStopwordDto): FormState {
  return {
    locale: s.locale,
    word: s.word,
    wordType: s.wordType,
    priority: String(s.priority),
    isActive: s.isActive,
  };
}

export function StopwordsTabPanel({
  stopwords,
  settings,
  permissions,
  loadAll,
  refreshStopwords,
  createLexStopword,
  updateLexStopword,
  deleteLexStopword,
  requestLexConfirm,
  handlePromoteToGovernance,
  loadMore,
}: StopwordsTabPanelProps) {
  const defaultLocale = useMemo(() => {
    const source = settings?.sourceLang?.trim();
    return source && source.length > 0 ? source : 'ro';
  }, [settings?.sourceLang]);

  const canWrite = permissions.canManageSettings;
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<LexStopwordDto | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultLocale));
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setLocalError(null);
    setEditing(null);
    setForm(emptyForm(defaultLocale));
    setFormMode('create');
  };

  const openEdit = (s: LexStopwordDto) => {
    setLocalError(null);
    setEditing(s);
    setForm(stopwordToForm(s));
    setFormMode('edit');
  };

  const closeForm = () => {
    setFormMode(null);
    setEditing(null);
    setLocalError(null);
  };

  const parsePriority = (): number | null => {
    const n = Number(form.priority);
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.min(1000, Math.round(n)));
  };

  const validate = (): string | null => {
    if (!form.word.trim()) return 'Word is required.';
    if (!form.locale.trim()) return 'Locale is required.';
    if (!form.wordType.trim()) return 'Word type is required.';
    if (parsePriority() == null) return 'Priority must be a number between 1 and 1000.';
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setLocalError(err);
      return;
    }
    const priority = parsePriority()!;
    setSaving(true);
    setLocalError(null);
    try {
      if (formMode === 'create') {
        await createLexStopword({
          locale: form.locale.trim(),
          word: form.word.trim(),
          wordType: form.wordType.trim(),
          priority,
          isActive: form.isActive,
        });
      } else if (editing) {
        await updateLexStopword(editing.id, {
          expectedVersion: editing.version,
          word: form.word.trim(),
          wordType: form.wordType.trim(),
          priority,
          isActive: form.isActive,
        });
      }
      await refreshStopwords();
      closeForm();
    } catch {
      /* parent */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: LexStopwordDto) => {
    if (!s.shopId) return;
    setSaving(true);
    try {
      const confirmed = await requestLexConfirm(
        {
          title: 'Remove stopword?',
          description: `“${s.word}” will be soft-deactivated. Related cleanup jobs may run on the server.`,
          confirmLabel: 'Remove',
          confirmVariant: 'destructive',
        },
        async () => {
          await deleteLexStopword(s.id, s.version);
        }
      );
      if (!confirmed) return;
      await refreshStopwords();
      if (editing?.id === s.id) closeForm();
    } catch {
      /* global */
    } finally {
      setSaving(false);
    }
  };

  const shopStopwords = stopwords.filter((s) => s.shopId);
  const globalStopwords = stopwords.filter((s) => !s.shopId);

  return (
    <Card padding="md" variant="bordered" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Stopwords</h3>
          <p className="text-sm text-muted">
            Zgomot lexical și termeni ignorați în mining/context building.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => void loadAll()}>
            Refresh
          </Button>
          <Button
            size="sm"
            disabled={!canWrite || saving}
            onClick={openCreate}
            title={!canWrite ? 'Requires lex_settings_write_enabled.' : undefined}
          >
            Add stopword
          </Button>
        </div>
      </div>

      {localError ? (
        <p
          className="text-sm text-error motion-safe:animate-[fadeSlideUp_0.15s_ease-out]"
          role="alert"
        >
          {localError}
        </p>
      ) : null}

      {formMode ? (
        <div className="rounded-lg border border-border bg-subtle/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              {formMode === 'create' ? 'New stopword (shop)' : 'Edit stopword'}
            </p>
            <Button size="sm" variant="ghost" type="button" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
          </div>
          <TextField
            label="Locale"
            value={form.locale}
            onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))}
            disabled={saving || formMode === 'edit'}
          />
          <TextField
            label="Word"
            value={form.word}
            onChange={(e) => setForm((f) => ({ ...f, word: e.target.value }))}
            disabled={saving}
          />
          <TextField
            label="Word type"
            value={form.wordType}
            onChange={(e) => setForm((f) => ({ ...f, wordType: e.target.value }))}
            disabled={saving}
          />
          <TextField
            label="Priority (1–1000)"
            type="number"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            disabled={saving}
          />
          <Checkbox
            checked={form.isActive}
            label="Active"
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            disabled={saving}
          />
          <Button type="button" disabled={!canWrite || saving} onClick={() => void handleSubmit()}>
            {saving ? 'Saving…' : formMode === 'create' ? 'Create' : 'Save changes'}
          </Button>
        </div>
      ) : null}

      {stopwords.length === 0 ? (
        <EmptyState
          title="No stopwords"
          description="Add shop stopwords to ignore noise tokens, or use global canon when present."
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              Shop Override
            </p>
            {shopStopwords.length === 0 ? (
              <p className="text-sm text-muted">No shop-specific stopwords. Use “Add stopword”.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Locale</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Word</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Type</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Priority</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shopStopwords.map((item) => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-3 py-2 text-muted">{item.locale}</td>
                        <td className="px-3 py-2 font-medium text-foreground">{item.word}</td>
                        <td className="px-3 py-2 text-muted">{item.wordType}</td>
                        <td className="px-3 py-2 text-muted">{item.priority}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canWrite || saving}
                              onClick={() => openEdit(item)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canWrite || saving}
                              onClick={() => void handleDelete(item)}
                            >
                              Delete
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!permissions.canGovernance || saving}
                              title={
                                !permissions.canGovernance
                                  ? 'Fluxul de governance este dezactivat (lex_governance_enabled).'
                                  : undefined
                              }
                              onClick={() =>
                                void requestLexConfirm(
                                  {
                                    title: 'Promote to global canon?',
                                    description: `Creates a governance request for stopword “${item.word}”.`,
                                    confirmLabel: 'Promote',
                                  },
                                  () =>
                                    handlePromoteToGovernance(
                                      'stopword',
                                      item.id,
                                      `Promote stopword: ${item.word}`,
                                      {
                                        locale: item.locale,
                                        word: item.word,
                                        wordType: item.wordType,
                                        priority: item.priority,
                                        isActive: item.isActive,
                                      }
                                    )
                                )
                              }
                            >
                              Promote Global
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              Global Canon
            </p>
            <p className="text-xs text-muted">
              Global stopwords are read-only here; use governance to change them.
            </p>
            {globalStopwords.length === 0 ? (
              <p className="text-sm text-muted">No global stopwords.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Locale</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Word</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Type</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalStopwords.map((item) => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-3 py-2 text-muted">{item.locale}</td>
                        <td className="px-3 py-2 font-medium text-foreground">{item.word}</td>
                        <td className="px-3 py-2 text-muted">{item.wordType}</td>
                        <td className="px-3 py-2 text-muted">{item.priority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {loadMore?.hasMore ? (
        <div className="flex justify-center pt-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={loadMore.loading}
            onClick={() => loadMore.onLoadMore()}
          >
            {loadMore.loading ? 'Se încarcă…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
