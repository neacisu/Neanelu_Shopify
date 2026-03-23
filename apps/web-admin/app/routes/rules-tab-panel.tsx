import { useMemo, useState } from 'react';
import type {
  LexAccessPermissions,
  LexGovernanceRequestDto,
  LexShopSettingsDto,
  LexTranslationRuleDto,
} from '@app/types';

import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { EmptyState } from '../components/patterns/empty-state';
import { TextField } from '../components/ui/text-field';
import type { LexConfirmOptions } from '../hooks/use-lex-confirm-modal';

export type LexRuleCreatePayload = Readonly<{
  ruleName: string;
  matchTerm: string;
  targetTranslation: string;
  sourceLang: string;
  targetLang: string;
  domainCode?: string | null;
  priority: number;
  isActive: boolean;
}>;

export type LexRuleUpdatePayload = Readonly<{
  expectedVersion: number;
  ruleName: string;
  matchTerm: string;
  targetTranslation: string;
  domainCode?: string | null;
  priority: number;
  isActive: boolean;
}>;

export type RulesTabPanelProps = Readonly<{
  rules: LexTranslationRuleDto[];
  settings: LexShopSettingsDto | null;
  permissions: LexAccessPermissions;
  loadAll: () => Promise<void>;
  refreshRules: () => Promise<void>;
  createLexRule: (payload: LexRuleCreatePayload) => Promise<void>;
  updateLexRule: (id: string, payload: LexRuleUpdatePayload) => Promise<void>;
  deleteLexRule: (id: string, expectedVersion: number) => Promise<void>;
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
  ruleName: string;
  matchTerm: string;
  targetTranslation: string;
  domainCode: string;
  sourceLang: string;
  targetLang: string;
  priority: string;
  isActive: boolean;
}>;

const emptyForm = (defaults: { sourceLang: string; targetLang: string }): FormState => ({
  ruleName: '',
  matchTerm: '',
  targetTranslation: '',
  domainCode: '',
  sourceLang: defaults.sourceLang,
  targetLang: defaults.targetLang,
  priority: '100',
  isActive: true,
});

function ruleToForm(rule: LexTranslationRuleDto): FormState {
  return {
    ruleName: rule.ruleName,
    matchTerm: rule.matchTerm,
    targetTranslation: rule.targetTranslation,
    domainCode: rule.domainCode ?? '',
    sourceLang: rule.sourceLang,
    targetLang: rule.targetLang,
    priority: String(rule.priority),
    isActive: rule.isActive,
  };
}

export function RulesTabPanel({
  rules,
  settings,
  permissions,
  loadAll,
  refreshRules,
  createLexRule,
  updateLexRule,
  deleteLexRule,
  requestLexConfirm,
  handlePromoteToGovernance,
  loadMore,
}: RulesTabPanelProps) {
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
  const [editingRule, setEditingRule] = useState<LexTranslationRuleDto | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(langDefaults));
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setLocalError(null);
    setEditingRule(null);
    setForm(emptyForm(langDefaults));
    setFormMode('create');
  };

  const openEdit = (rule: LexTranslationRuleDto) => {
    setLocalError(null);
    setEditingRule(rule);
    setForm(ruleToForm(rule));
    setFormMode('edit');
  };

  const closeForm = () => {
    setFormMode(null);
    setEditingRule(null);
    setLocalError(null);
  };

  const parsePriority = (): number | null => {
    const n = Number(form.priority);
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.min(1000, Math.round(n)));
  };

  const validateForm = (): string | null => {
    if (!form.ruleName.trim()) return 'Rule name is required.';
    if (!form.matchTerm.trim()) return 'Match term is required.';
    if (!form.targetTranslation.trim()) return 'Target translation is required.';
    if (parsePriority() == null) return 'Priority must be a number between 1 and 1000.';
    if (!form.sourceLang.trim() || !form.targetLang.trim())
      return 'Source and target language are required.';
    return null;
  };

  const handleSubmit = async () => {
    const err = validateForm();
    if (err) {
      setLocalError(err);
      return;
    }
    const priority = parsePriority()!;
    setSaving(true);
    setLocalError(null);
    try {
      if (formMode === 'create') {
        await createLexRule({
          ruleName: form.ruleName.trim(),
          matchTerm: form.matchTerm.trim(),
          targetTranslation: form.targetTranslation.trim(),
          sourceLang: form.sourceLang.trim(),
          targetLang: form.targetLang.trim(),
          domainCode: form.domainCode.trim() ? form.domainCode.trim() : null,
          priority,
          isActive: form.isActive,
        });
      } else if (formMode === 'edit' && editingRule) {
        await updateLexRule(editingRule.id, {
          expectedVersion: editingRule.version,
          ruleName: form.ruleName.trim(),
          matchTerm: form.matchTerm.trim(),
          targetTranslation: form.targetTranslation.trim(),
          domainCode: form.domainCode.trim() ? form.domainCode.trim() : null,
          priority,
          isActive: form.isActive,
        });
      }
      await refreshRules();
      closeForm();
    } catch {
      /* parent setError */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule: LexTranslationRuleDto) => {
    if (!rule.shopId) return;
    setSaving(true);
    setLocalError(null);
    try {
      const confirmed = await requestLexConfirm(
        {
          title: 'Remove translation rule?',
          description: `“${rule.ruleName}” will be soft-deactivated (not permanently erased).`,
          confirmLabel: 'Remove',
          confirmVariant: 'destructive',
        },
        async () => {
          await deleteLexRule(rule.id, rule.version);
        }
      );
      if (!confirmed) return;
      await refreshRules();
      if (editingRule?.id === rule.id) closeForm();
    } catch {
      /* global */
    } finally {
      setSaving(false);
    }
  };

  const shopRules = rules.filter((r) => r.shopId);
  const globalRules = rules.filter((r) => !r.shopId);

  return (
    <Card padding="md" variant="bordered" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Translation Rules</h3>
          <p className="text-sm text-muted">
            Reguli explicite cu precedence peste AI acolo unde terminologia este fixă.
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
            Add rule
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
              {formMode === 'create' ? 'New translation rule (shop)' : 'Edit translation rule'}
            </p>
            <Button size="sm" variant="ghost" type="button" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
          </div>
          <TextField
            label="Rule name"
            value={form.ruleName}
            onChange={(e) => setForm((f) => ({ ...f, ruleName: e.target.value }))}
            disabled={saving}
          />
          <TextField
            label="Match term"
            value={form.matchTerm}
            onChange={(e) => setForm((f) => ({ ...f, matchTerm: e.target.value }))}
            disabled={saving}
          />
          <TextField
            label="Target translation"
            value={form.targetTranslation}
            onChange={(e) => setForm((f) => ({ ...f, targetTranslation: e.target.value }))}
            disabled={saving}
          />
          <TextField
            label="Domain code (optional)"
            value={form.domainCode}
            onChange={(e) => setForm((f) => ({ ...f, domainCode: e.target.value }))}
            disabled={saving}
          />
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

      {rules.length === 0 ? (
        <EmptyState
          title="No rules yet"
          description="Create shop rules for deterministic translations or wait for global canon entries."
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              Shop Override
            </p>
            {shopRules.length === 0 ? (
              <p className="text-sm text-muted">No shop-specific rules. Use “Add rule”.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Rule</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Match</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Target</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Priority</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shopRules.map((item) => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-foreground">{item.ruleName}</td>
                        <td className="px-3 py-2 text-muted">{item.matchTerm}</td>
                        <td className="px-3 py-2 text-muted">{item.targetTranslation}</td>
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
                                    description: `Creates a governance request for rule “${item.ruleName}”.`,
                                    confirmLabel: 'Promote',
                                  },
                                  () =>
                                    handlePromoteToGovernance(
                                      'translation_rule',
                                      item.id,
                                      `Promote rule: ${item.ruleName}`,
                                      {
                                        ruleName: item.ruleName,
                                        sourceLang: item.sourceLang,
                                        targetLang: item.targetLang,
                                        matchTerm: item.matchTerm,
                                        domainCode: item.domainCode,
                                        targetTranslation: item.targetTranslation,
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
              Global rules are read-only here; use governance to change them.
            </p>
            {globalRules.length === 0 ? (
              <p className="text-sm text-muted">No global rules.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Rule</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Match</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Target</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalRules.map((item) => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-foreground">{item.ruleName}</td>
                        <td className="px-3 py-2 text-muted">{item.matchTerm}</td>
                        <td className="px-3 py-2 text-muted">{item.targetTranslation}</td>
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
