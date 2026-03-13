import { useEffect, useMemo, useState } from 'react';
import type { CategoryNode } from '@app/types';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { TreeView, type TreeNode } from '../components/ui/TreeView';
import { Select, type SelectOption } from '../components/ui/select';
import { TextField } from '../components/ui/text-field';
import { LoadingState } from '../components/patterns/loading-state';
import { ErrorState } from '../components/patterns/error-state';
import { EmptyState } from '../components/patterns/empty-state';
import { useApiClient } from '../hooks/use-api';

type Assignment = Readonly<{
  product_id: string;
  canonical_title: string;
  taxonomy_id: string | null;
  taxonomy_name: string | null;
  taxonomy_ai_confidence: string | null;
  taxonomy_ai_status: string | null;
  taxonomy_ai_method: string | null;
}>;

type Stats = Readonly<{
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  manual: number;
  highConfidence: number;
}>;

function toTreeNodes(nodes: readonly CategoryNode[]): TreeNode[] {
  return nodes.map((node) => ({
    id: node.id,
    label: node.name,
    ...(node.children?.length ? { children: toTreeNodes(node.children) } : {}),
  }));
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Aprobate' },
  { value: 'rejected', label: 'Respinse' },
  { value: 'manual', label: 'Manual' },
];

export default function PimCategoriesPage() {
  const api = useApiClient();
  const [stats, setStats] = useState<Stats | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [minConfidence, setMinConfidence] = useState<number>(0.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taxonomyTree, setTaxonomyTree] = useState<TreeNode[]>([]);
  const [reassignProductId, setReassignProductId] = useState<string | null>(null);
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, assignmentsData, filters] = await Promise.all([
        api.getApi<Stats>('/pim/categories/stats'),
        api.getApi<{ assignments: Assignment[] }>(
          `/pim/categories/assignments?status=${encodeURIComponent(statusFilter)}&minConfidence=${minConfidence}&limit=100`
        ),
        api.getApi<{ categories: CategoryNode[] }>('/products/filters'),
      ]);
      setStats(statsData);
      setAssignments(assignmentsData.assignments);
      setTaxonomyTree(toTreeNodes(filters.categories));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eroare la încărcarea categoriilor');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [statusFilter, minConfidence]);

  const summaryCards = useMemo(
    () => [
      { label: 'Total', value: stats?.total ?? 0 },
      { label: 'Pending', value: stats?.pending ?? 0 },
      { label: 'Aprobate', value: stats?.approved ?? 0 },
      { label: 'Respinse', value: stats?.rejected ?? 0 },
      { label: 'High confidence', value: stats?.highConfidence ?? 0 },
    ],
    [stats]
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        {summaryCards.map((card) => (
          <Card
            key={card.label}
            padding="sm"
            className="transition-shadow duration-200 hover:shadow-[var(--shadow-md)]"
          >
            <div className="text-xs text-muted">{card.label}</div>
            <div className="text-xl font-semibold text-foreground">{card.value}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
        <TextField
          label="Confidence min."
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={String(minConfidence)}
          onChange={(e) => setMinConfidence(Number(e.target.value))}
          className="w-36"
        />
        <Button
          variant="secondary"
          onClick={() =>
            void api
              .postApi<
                { updated: number },
                { threshold: number }
              >('/pim/categories/assignments/bulk-approve-high-confidence', { threshold: 0.85 })
              .then(() => load())
          }
        >
          Aprobă toate &ge;0.85
        </Button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : loading && assignments.length === 0 ? (
        <LoadingState label="Se încarcă categoriile..." />
      ) : !loading && assignments.length === 0 ? (
        <EmptyState
          title="Nu există atribuiri"
          description={`Nu există atribuiri cu statusul „${statusFilter}". Ajustează filtrele.`}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-subtle">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted">Produs</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Categorie</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Confidence</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Metodă</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Status</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((item) => (
                <tr key={item.product_id} className="table-row-interactive border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{item.canonical_title}</td>
                  <td className="px-3 py-2 text-muted">{item.taxonomy_name ?? '—'}</td>
                  <td className="px-3 py-2 text-muted">{item.taxonomy_ai_confidence ?? '0'}</td>
                  <td className="px-3 py-2 text-muted">{item.taxonomy_ai_method ?? '—'}</td>
                  <td className="px-3 py-2 text-muted">{item.taxonomy_ai_status ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void api
                            .postApi(`/pim/categories/assignments/${item.product_id}/approve`, {})
                            .then(load)
                        }
                      >
                        Aprobă
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void api
                            .postApi(`/pim/categories/assignments/${item.product_id}/reject`, {})
                            .then(load)
                        }
                      >
                        Respinge
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReassignProductId(item.product_id)}
                      >
                        Reatribuie
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading && assignments.length > 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <span
            className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
            aria-hidden
          />
          Se actualizează...
        </div>
      ) : null}

      {reassignProductId ? (
        <Card padding="sm">
          <div className="mb-2 text-sm font-medium">Selectează taxonomia nouă</div>
          <TreeView
            data={taxonomyTree}
            selected={selectedTaxonomyId}
            onSelect={(id) => setSelectedTaxonomyId(id)}
            className="max-h-64 overflow-auto"
          />
          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => {
                if (!selectedTaxonomyId) return;
                void api
                  .postApi(`/pim/categories/assignments/${reassignProductId}/reassign`, {
                    taxonomyId: selectedTaxonomyId,
                  })
                  .then(() => {
                    setReassignProductId(null);
                    setSelectedTaxonomyId(null);
                    return load();
                  });
              }}
            >
              Confirmă reatribuirea
            </Button>
            <Button variant="secondary" onClick={() => setReassignProductId(null)}>
              Anulează
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
