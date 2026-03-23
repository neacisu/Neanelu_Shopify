import { useMemo, useState } from 'react';
import type {
  LexAccessPermissions,
  LexGovernanceRequestDto,
  LexGlossaryEntryDto,
  LexShopSettingsDto,
} from '@app/types';

import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { EmptyState } from '../components/patterns/empty-state';
import { TextField } from '../components/ui/text-field';
import type { LexConfirmOptions } from '../hooks/use-lex-confirm-modal';

export type LexGlossaryCreatePayload = Readonly<{
  sourceText: string;
  targetText: string;
  domainCode?: string | null;
  sourceLang: string;
  targetLang: string;
  translationKind: string;
  priority: number;
  isLocked: boolean;
  isActive: boolean;
}>;

export type LexGlossaryUpdatePayload = Readonly<{
  expectedVersion: number;
  targetText: string;
  translationKind: string;
  priority: number;
  isLocked: boolean;
  isActive: boolean;
}>;

export type GlossaryTabPanelProps = Readonly<{
  glossary: LexGlossaryEntryDto[];
  /** When true and list is empty, show “no search results” instead of “empty glossary”. */
  emptySearchActive?: boolean;
  settings: LexShopSettingsDto | null;
  permissions: LexAccessPermissions;
  loadAll: () => Promise<void>;
  refreshGlossary: () => Promise<void>;
  createGlossaryEntry: (payload: LexGlossaryCreatePayload) => Promise<void>;
  updateGlossaryEntry: (id: string, payload: LexGlossaryUpdatePayload) => Promise<void>;
  deleteGlossaryEntry: (id: string, expectedVersion: number) => Promise<void>;
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
  sourceText: string;
  targetText: string;
  domainCode: string;
  sourceLang: string;
  targetLang: string;
  translationKind: string;
  priority: string;
  isLocked: boolean;
  isActive: boolean;
}>;

const emptyForm = (defaults: { sourceLang: string; targetLang: string }): FormState => ({
  sourceText: '',
  targetText: '',
  domainCode: '',
  sourceLang: defaults.sourceLang,
  targetLang: defaults.targetLang,
  translationKind: 'canonical',
  priority: '100',
  isLocked: false,
  isActive: true,
});

function entryToForm(entry: LexGlossaryEntryDto): FormState {
  return {
    sourceText: entry.sourceText,
    targetText: entry.targetText,
    domainCode: entry.domainCode ?? '',
    sourceLang: entry.sourceLang,
    targetLang: entry.targetLang,
    translationKind: entry.translationKind,
    priority: String(entry.priority),
    isLocked: entry.isLocked,
    isActive: entry.isActive,
  };
}

export function GlossaryTabPanel({
  glossary,
  emptySearchActive = false,
  settings,
  permissions,
  loadAll,
  refreshGlossary,
  createGlossaryEntry,
  updateGlossaryEntry,
  deleteGlossaryEntry,
  requestLexConfirm,
  handlePromoteToGovernance,
  loadMore,
}: GlossaryTabPanelProps) {
  const langDefaults = useMemo(() => {
    const source = settings?.sourceLang?.trim();
    const target = settings?.targetLangs?.[0]?.trim();
    return {
      sourceLang: source && source.length > 0 ? source : 'ro',
      targetLang: target && target.length > 0 ? target : 'en',
    };
  }, [settings?.sourceLang, settings?.targetLangs]);

  const canWrite = permissions.canManageSettings;
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingEntry, setEditingEntry] = useState<LexGlossaryEntryDto | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(langDefaults));
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setLocalError(null);
    setEditingEntry(null);
    setForm(emptyForm(langDefaults));
    setFormMode('create');
  };

  const openEdit = (entry: LexGlossaryEntryDto) => {
    setLocalError(null);
    setEditingEntry(entry);
    setForm(entryToForm(entry));
    setFormMode('edit');
  };

  const closeForm = () => {
    setFormMode(null);
    setEditingEntry(null);
    setLocalError(null);
  };

  const parsePriority = (): number | null => {
    const n = Number(form.priority);
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.min(1000, Math.round(n)));
  };

  const validateForm = (forCreate: boolean): string | null => {
    if (forCreate && !form.sourceText.trim()) return 'Source text is required.';
    if (!form.targetText.trim()) return 'Target text is required.';
    if (parsePriority() == null) return 'Priority must be a number between 1 and 1000.';
    if (!form.translationKind.trim()) return 'Translation kind is required.';
    if (!form.sourceLang.trim() || !form.targetLang.trim())
      return 'Source and target language are required.';
    return null;
  };

  const handleSubmit = async () => {
    const forCreate = formMode === 'create';
    const err = validateForm(forCreate);
    if (err) {
      setLocalError(err);
      return;
    }
    const priority = parsePriority()!;
    setSaving(true);
    setLocalError(null);
    try {
      if (forCreate) {
        await createGlossaryEntry({
          sourceText: form.sourceText.trim(),
          targetText: form.targetText.trim(),
          domainCode: form.domainCode.trim() ? form.domainCode.trim() : null,
          sourceLang: form.sourceLang.trim(),
          targetLang: form.targetLang.trim(),
          translationKind: form.translationKind.trim(),
          priority,
          isLocked: form.isLocked,
          isActive: form.isActive,
        });
      } else if (editingEntry) {
        await updateGlossaryEntry(editingEntry.id, {
          expectedVersion: editingEntry.version,
          targetText: form.targetText.trim(),
          translationKind: form.translationKind.trim(),
          priority,
          isLocked: form.isLocked,
          isActive: form.isActive,
        });
      }
      await refreshGlossary();
      closeForm();
    } catch {
      /* parent setError + ApiError */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: LexGlossaryEntryDto) => {
    if (!entry.shopId) return;
    setSaving(true);
    setLocalError(null);
    try {
      const confirmed = await requestLexConfirm(
        {
          title: 'Remove glossary entry?',
          description: `“${entry.sourceText}” will be soft-deactivated (not permanently erased).`,
          confirmLabel: 'Remove',
          confirmVariant: 'destructive',
        },
        async () => {
          await deleteGlossaryEntry(entry.id, entry.version);
        }
      );
      if (!confirmed) return;
      await refreshGlossary();
      if (editingEntry?.id === entry.id) closeForm();
    } catch {
      /* erorile sunt afișate la nivel de aplicație */
    } finally {
      setSaving(false);
    }
  };

  const shopEntries = glossary.filter((e) => e.shopId);
  const globalEntries = glossary.filter((e) => !e.shopId);

  return (
    <Card padding="md" variant="bordered" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Approved Glossary</h3>
          <p className="text-sm text-muted">
            Reguli deterministe care bat întotdeauna modelul atunci când există claritate.
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
            Add entry
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
              {formMode === 'create' ? 'New glossary entry (shop)' : 'Edit glossary entry'}
            </p>
            <Button size="sm" variant="ghost" type="button" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
          </div>
          {formMode === 'create' ? (
            <TextField
              label="Source text"
              value={form.sourceText}
              onChange={(e) => setForm((f) => ({ ...f, sourceText: e.target.value }))}
              disabled={saving}
            />
          ) : (
            <div>
              <p className="text-xs font-medium text-muted">Source text (read-only)</p>
              <p className="mt-1 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground">
                {form.sourceText}
              </p>
            </div>
          )}
          <TextField
            label="Target text"
            value={form.targetText}
            onChange={(e) => setForm((f) => ({ ...f, targetText: e.target.value }))}
            disabled={saving}
          />
          {formMode === 'create' ? (
            <TextField
              label="Domain code (optional)"
              value={form.domainCode}
              placeholder="e.g. plumbing"
              onChange={(e) => setForm((f) => ({ ...f, domainCode: e.target.value }))}
              disabled={saving}
            />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Source language"
              value={form.sourceLang}
              onChange={(e) => setForm((f) => ({ ...f, sourceLang: e.target.value }))}
              disabled={saving || formMode === 'edit'}
            />
            <TextField
              label="Target language"
              value={form.targetLang}
              onChange={(e) => setForm((f) => ({ ...f, targetLang: e.target.value }))}
              disabled={saving || formMode === 'edit'}
            />
          </div>
          <TextField
            label="Translation kind"
            value={form.translationKind}
            onChange={(e) => setForm((f) => ({ ...f, translationKind: e.target.value }))}
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
            checked={form.isLocked}
            label="Locked"
            description="When locked, this entry overrides with highest confidence in the pipeline."
            onChange={(e) => setForm((f) => ({ ...f, isLocked: e.target.checked }))}
            disabled={saving}
          />
          <Checkbox
            checked={form.isActive}
            label="Active"
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            disabled={saving}
          />
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              disabled={!canWrite || saving}
              onClick={() => void handleSubmit()}
            >
              {saving ? 'Saving…' : formMode === 'create' ? 'Create' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : null}

      {glossary.length === 0 ? (
        <EmptyState
          title={emptySearchActive ? 'Nicio intrare găsită' : 'Glosar gol'}
          description={
            emptySearchActive
              ? 'Încearcă alt termen de căutare sau șterge filtrul.'
              : 'Intrările aprobate manual sau promovate din review vor apărea aici.'
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              Shop Override
            </p>
            {shopEntries.length === 0 ? (
              <p className="text-sm text-muted">No shop-specific entries yet. Use “Add entry”.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Source</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Target</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Kind</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Priority</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Lock</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shopEntries.map((entry) => (
                      <tr key={entry.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-foreground">
                          {entry.sourceText}
                        </td>
                        <td className="px-3 py-2 text-muted">{entry.targetText}</td>
                        <td className="px-3 py-2 text-muted">{entry.translationKind}</td>
                        <td className="px-3 py-2 text-muted">{entry.priority}</td>
                        <td className="px-3 py-2 text-muted">
                          {entry.isLocked ? 'locked' : 'open'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canWrite || saving}
                              onClick={() => openEdit(entry)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canWrite || saving}
                              onClick={() => void handleDelete(entry)}
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
                                    description: `Creates a governance request for “${entry.sourceText}”.`,
                                    confirmLabel: 'Promote',
                                  },
                                  () =>
                                    handlePromoteToGovernance(
                                      'glossary_entry',
                                      entry.id,
                                      `Promote glossary: ${entry.sourceText}`,
                                      {
                                        domainCode: entry.domainCode,
                                        sourceLang: entry.sourceLang,
                                        targetLang: entry.targetLang,
                                        sourceText: entry.sourceText,
                                        targetText: entry.targetText,
                                        translationKind: entry.translationKind,
                                        priority: entry.priority,
                                        isLocked: entry.isLocked,
                                        isActive: entry.isActive,
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
              Global entries are read-only here; change them via governance workflow.
            </p>
            {globalEntries.length === 0 ? (
              <p className="text-sm text-muted">No global entries.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Source</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Target</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Kind</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Priority</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Lock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalEntries.map((entry) => (
                      <tr key={entry.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-foreground">
                          {entry.sourceText}
                        </td>
                        <td className="px-3 py-2 text-muted">{entry.targetText}</td>
                        <td className="px-3 py-2 text-muted">{entry.translationKind}</td>
                        <td className="px-3 py-2 text-muted">{entry.priority}</td>
                        <td className="px-3 py-2 text-muted">
                          {entry.isLocked ? 'locked' : 'open'}
                        </td>
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
