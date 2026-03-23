import { useId, useState } from 'react';
import type {
  LexAccessPermissions,
  LexDomainProfileDto,
  LexGovernanceRequestDto,
} from '@app/types';

import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { EmptyState } from '../components/patterns/empty-state';
import { TextField } from '../components/ui/text-field';
import type { LexConfirmOptions } from '../hooks/use-lex-confirm-modal';

export type LexProfileCreatePayload = Readonly<{
  domainCode: string;
  nameRo: string;
  nameEn: string | null;
  description: string | null;
  isActive: boolean;
}>;

export type LexProfileUpdatePayload = Readonly<{
  expectedVersion: number;
  nameRo: string;
  nameEn: string | null;
  description: string | null;
  isActive: boolean;
}>;

export type ProfilesTabPanelProps = Readonly<{
  profiles: LexDomainProfileDto[];
  permissions: LexAccessPermissions;
  loadAll: () => Promise<void>;
  refreshProfiles: () => Promise<void>;
  createLexProfile: (payload: LexProfileCreatePayload) => Promise<void>;
  updateLexProfile: (id: string, payload: LexProfileUpdatePayload) => Promise<void>;
  deleteLexProfile: (id: string, expectedVersion: number) => Promise<void>;
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
  domainCode: string;
  nameRo: string;
  nameEn: string;
  description: string;
  isActive: boolean;
}>;

const emptyForm = (): FormState => ({
  domainCode: '',
  nameRo: '',
  nameEn: '',
  description: '',
  isActive: true,
});

function profileToForm(p: LexDomainProfileDto): FormState {
  return {
    domainCode: p.domainCode,
    nameRo: p.nameRo,
    nameEn: p.nameEn ?? '',
    description: p.description ?? '',
    isActive: p.isActive,
  };
}

export function ProfilesTabPanel({
  profiles,
  permissions,
  loadAll,
  refreshProfiles,
  createLexProfile,
  updateLexProfile,
  deleteLexProfile,
  requestLexConfirm,
  handlePromoteToGovernance,
  loadMore,
}: ProfilesTabPanelProps) {
  const canWrite = permissions.canManageSettings;
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<LexDomainProfileDto | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const descId = useId().replace(/:/g, '');

  const openCreate = () => {
    setLocalError(null);
    setEditing(null);
    setForm(emptyForm());
    setFormMode('create');
  };

  const openEdit = (p: LexDomainProfileDto) => {
    setLocalError(null);
    setEditing(p);
    setForm(profileToForm(p));
    setFormMode('edit');
  };

  const closeForm = () => {
    setFormMode(null);
    setEditing(null);
    setLocalError(null);
  };

  const validate = (creating: boolean): string | null => {
    if (creating && !form.domainCode.trim()) return 'Domain code is required.';
    if (!form.nameRo.trim()) return 'Name (RO) is required.';
    return null;
  };

  const handleSubmit = async () => {
    const creating = formMode === 'create';
    const err = validate(creating);
    if (err) {
      setLocalError(err);
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      if (creating) {
        await createLexProfile({
          domainCode: form.domainCode.trim(),
          nameRo: form.nameRo.trim(),
          nameEn: form.nameEn.trim() ? form.nameEn.trim() : null,
          description: form.description.trim() ? form.description.trim() : null,
          isActive: form.isActive,
        });
      } else if (editing) {
        await updateLexProfile(editing.id, {
          expectedVersion: editing.version,
          nameRo: form.nameRo.trim(),
          nameEn: form.nameEn.trim() ? form.nameEn.trim() : null,
          description: form.description.trim() ? form.description.trim() : null,
          isActive: form.isActive,
        });
      }
      await refreshProfiles();
      closeForm();
    } catch {
      /* parent */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: LexDomainProfileDto) => {
    if (!p.shopId) return;
    setSaving(true);
    try {
      const confirmed = await requestLexConfirm(
        {
          title: 'Remove domain profile?',
          description: `“${p.domainCode}” will be soft-deactivated (not permanently erased).`,
          confirmLabel: 'Remove',
          confirmVariant: 'destructive',
        },
        async () => {
          await deleteLexProfile(p.id, p.version);
        }
      );
      if (!confirmed) return;
      await refreshProfiles();
      if (editing?.id === p.id) closeForm();
    } catch {
      /* global */
    } finally {
      setSaving(false);
    }
  };

  const shopProfiles = profiles.filter((p) => p.shopId);
  const globalProfiles = profiles.filter((p) => !p.shopId);

  return (
    <Card padding="md" variant="bordered" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Domain Profiles</h3>
          <p className="text-sm text-muted">
            Profile de domeniu folosite la clustering, protecție de tokeni și stil.
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
            Add profile
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
              {formMode === 'create' ? 'New domain profile (shop)' : 'Edit domain profile'}
            </p>
            <Button size="sm" variant="ghost" type="button" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
          </div>
          {formMode === 'create' ? (
            <TextField
              label="Domain code"
              value={form.domainCode}
              onChange={(e) => setForm((f) => ({ ...f, domainCode: e.target.value }))}
              disabled={saving}
            />
          ) : (
            <div>
              <p className="text-xs font-medium text-muted">Domain code (read-only)</p>
              <p className="mt-1 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground">
                {form.domainCode}
              </p>
            </div>
          )}
          <TextField
            label="Name (RO)"
            value={form.nameRo}
            onChange={(e) => setForm((f) => ({ ...f, nameRo: e.target.value }))}
            disabled={saving}
          />
          <TextField
            label="Name (EN) — optional"
            value={form.nameEn}
            onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
            disabled={saving}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={descId} className="text-sm font-medium text-foreground">
              Description — optional
            </label>
            <textarea
              id={descId}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              disabled={saving}
              rows={4}
              className="focus-ring-standard min-h-[80px] w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] duration-normal hover:border-accent-border disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
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

      {profiles.length === 0 ? (
        <EmptyState
          title="No domain profiles"
          description="Create a shop profile or rely on global canon entries when available."
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              Shop Override
            </p>
            {shopProfiles.length === 0 ? (
              <p className="text-sm text-muted">No shop-specific profiles. Use “Add profile”.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Domain</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Name (RO)</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shopProfiles.map((item) => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-foreground">{item.domainCode}</td>
                        <td className="px-3 py-2 text-muted">{item.nameRo}</td>
                        <td className="px-3 py-2 text-muted">
                          {item.isActive ? 'active' : 'inactive'}
                        </td>
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
                                    description: `Creates a governance request for profile “${item.domainCode}”.`,
                                    confirmLabel: 'Promote',
                                  },
                                  () =>
                                    handlePromoteToGovernance(
                                      'domain_profile',
                                      item.id,
                                      `Promote profile: ${item.domainCode}`,
                                      {
                                        domainCode: item.domainCode,
                                        nameRo: item.nameRo,
                                        nameEn: item.nameEn,
                                        description: item.description,
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
              Global profiles are read-only here; use governance to change them.
            </p>
            {globalProfiles.length === 0 ? (
              <p className="text-sm text-muted">No global profiles.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Domain</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Name (RO)</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalProfiles.map((item) => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-foreground">{item.domainCode}</td>
                        <td className="px-3 py-2 text-muted">{item.nameRo}</td>
                        <td className="px-3 py-2 text-muted">
                          {item.isActive ? 'active' : 'inactive'}
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
