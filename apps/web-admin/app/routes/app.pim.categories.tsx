import { useEffect, useMemo, useState } from 'react';
import type { CategoryNode } from '@app/types';
import { Button } from '../components/ui/button';
import { TreeView, type TreeNode } from '../components/ui/TreeView';
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

export default function PimCategoriesPage() {
  const api = useApiClient();
  const [stats, setStats] = useState<Stats | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [minConfidence, setMinConfidence] = useState<number>(0.5);
  const [loading, setLoading] = useState(false);
  const [taxonomyTree, setTaxonomyTree] = useState<TreeNode[]>([]);
  const [reassignProductId, setReassignProductId] = useState<string | null>(null);
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
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
          <div
            key={card.label}
            className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">{card.label}</div>
            <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="pending">pending</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
          <option value="manual">manual</option>
        </select>
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={minConfidence}
          onChange={(event) => setMinConfidence(Number(event.target.value))}
          className="w-32 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
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
          Aprobă toate {'>'}=0.85
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2 text-left">Produs</th>
              <th className="px-3 py-2 text-left">Categorie</th>
              <th className="px-3 py-2 text-left">Confidence</th>
              <th className="px-3 py-2 text-left">Metodă</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((item) => (
              <tr key={item.product_id} className="border-t border-slate-200 dark:border-slate-700">
                <td className="px-3 py-2">{item.canonical_title}</td>
                <td className="px-3 py-2">{item.taxonomy_name ?? '—'}</td>
                <td className="px-3 py-2">{item.taxonomy_ai_confidence ?? '0'}</td>
                <td className="px-3 py-2">{item.taxonomy_ai_method ?? '—'}</td>
                <td className="px-3 py-2">{item.taxonomy_ai_status ?? '—'}</td>
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

      {loading ? <div className="text-sm text-slate-500">Se încarcă...</div> : null}

      {reassignProductId ? (
        <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
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
        </div>
      ) : null}
    </div>
  );
}
