import { RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';

import type { ComponentType } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { DashboardClearCacheResponse, DashboardStartSyncResponse } from '@app/types';

import { createApiClient } from '../../../lib/api-client';
import { getSessionAuthHeaders } from '../../../lib/session-auth';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/domain/confirm-dialog';
import { InfoTooltip } from '../../../components/ui/info-tooltip';

const api = createApiClient({ getAuthHeaders: getSessionAuthHeaders });

interface QuickAction {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  variant: 'primary' | 'secondary';
  tooltipTitle: string;
  tooltipBody: string;
  onClick: () => void;
}

export function QuickActionsPanel() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const actions: QuickAction[] = [
    {
      id: 'reconcile',
      label: 'Reconcile Webhooks',
      icon: RefreshCw,
      variant: 'primary',
      tooltipTitle: 'Reconciliere Webhooks',
      tooltipBody:
        'CE ESTE: Verificare și recreare a notificărilor Shopify lipsă. ' +
        'DE CE CONTEAZĂ: Shopify trimite webhooks automat la fiecare modificare, dar uneori se pierd. ' +
        'Acest buton verifică lista completă și recreează cele lipsă. ' +
        'EXEMPLU: Dacă observi că produsele modificate în Shopify nu se actualizează în Neanelu, rulează reconcilierea. ' +
        'SFAT: Poate fi folosit maxim o dată pe oră. Timpul de execuție depinde de numărul de produse.',
      onClick: () => {
        void (async () => {
          setLoadingId('reconcile');
          try {
            const res = await api.postApi<DashboardStartSyncResponse, Record<string, never>>(
              '/dashboard/actions/start-sync',
              {}
            );
            toast.success(`Reconciliere pornită (${res.jobId})`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Reconcilierea a eșuat');
          } finally {
            setLoadingId(null);
          }
        })();
      },
    },
    {
      id: 'clear-cache',
      label: 'Golire Cache',
      icon: Trash2,
      variant: 'secondary',
      tooltipTitle: 'Golire Cache',
      tooltipBody:
        'CE ESTE: Ștergerea copiilor temporare (cache) din memorie. ' +
        'DE CE CONTEAZĂ: Aplicația păstrează statistici și filtre în cache pentru viteză. ' +
        'Golirea forțează reîncărcarea datelor proaspete din baza de date. ' +
        'EXEMPLU: Dacă vezi numere vechi pe dashboard care nu se actualizează, golește cache-ul. ' +
        'SFAT: Nu se șterge niciun produs sau setare — doar cache-ul de performanță. Operația durează sub 2 secunde.',
      onClick: () => setConfirmOpen(true),
    },
    {
      id: 'health',
      label: 'Verificare Sănătate',
      icon: ShieldCheck,
      variant: 'secondary',
      tooltipTitle: 'Verificare Sănătate Sistem',
      tooltipBody:
        'CE ESTE: Control rapid al tuturor componentelor: baza de date, Redis, Shopify, procesatori. ' +
        'DE CE CONTEAZĂ: Identifică rapid ce componentă are probleme fără a verifica manual fiecare. ' +
        'EXEMPLU: „Redis: OK, DB: OK, Shopify: Timeout" = problema e la conexiunea Shopify. ' +
        'SFAT: Rulează-l oricând suspectezi o problemă. Rezultatul apare instant ca notificare.',
      onClick: () => {
        void (async () => {
          setLoadingId('health');
          try {
            await api.getJson('/health/ready');
            toast.success('Verificare sănătate: OK — toate componentele funcționează');
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Verificarea sănătății a eșuat');
          } finally {
            setLoadingId(null);
          }
        })();
      },
    },
  ];

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm transition-[box-shadow,border-color] duration-normal hover:border-primary/30 hover:shadow-[var(--shadow-md)]">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
          Acțiuni rapide
          <InfoTooltip title="Acțiuni rapide" side="bottom">
            CE ESTE: Panoul cu operații frecvente disponibile direct din dashboard. DE CE CONTEAZĂ:
            Permite executarea rapidă a acțiunilor de mentenanță fără navigare în meniuri. EXEMPLU:
            Reconcilierea webhooks, golirea cache-ului sau verificarea sănătății — totul cu un
            singur click. SFAT: Fiecare buton are propriul tooltip cu explicații detaliate.
          </InfoTooltip>
        </h3>
        <p className="mt-0.5 text-xs text-muted">Operații frecvente fără a părăsi dashboard-ul</p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;
          const isLoading = loadingId === action.id;

          return (
            <div
              key={action.id}
              className="group/action flex flex-col gap-2 rounded-lg border border-border bg-subtle/40 p-3 transition-[colors,border-color] duration-normal hover:border-primary/30 hover:bg-subtle/70 hover:shadow-[var(--shadow-sm)]"
            >
              <Button
                variant={action.variant}
                loading={isLoading}
                disabled={isLoading}
                onClick={action.onClick}
                className="w-full transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)] active:translate-y-0"
              >
                <span className="inline-flex items-center gap-2">
                  <Icon
                    className={`size-4 transition-transform duration-300 ${
                      isLoading ? 'animate-spin' : 'group-hover/action:rotate-12'
                    }`}
                  />
                  {action.label}
                </span>
              </Button>

              <div className="flex items-center justify-center">
                <InfoTooltip title={action.tooltipTitle}>{action.tooltipBody}</InfoTooltip>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Golești cache-ul Redis?"
        message="Se vor șterge cheile de cache selectate din Redis. Datele cozilor și cheile de lungă durată nu sunt afectate."
        confirmLabel="Golește"
        cancelLabel="Anulare"
        confirmTone="critical"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          void (async () => {
            setLoadingId('clear-cache');
            try {
              const res = await api.postApi<
                DashboardClearCacheResponse,
                { confirm: true; patterns: string[] }
              >('/dashboard/actions/clear-cache', {
                confirm: true,
                patterns: ['dashboard:*', 'cache:*'],
              });
              toast.success(`Cache golit (${res.deletedKeys} chei șterse)`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Golirea cache-ului a eșuat');
            } finally {
              setLoadingId(null);
            }
          })();
        }}
      />
    </article>
  );
}
