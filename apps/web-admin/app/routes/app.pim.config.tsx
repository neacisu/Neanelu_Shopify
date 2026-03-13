import { useEffect, useMemo, useState } from 'react';
import { Tabs } from '../components/ui/tabs';
import { TreeView, type TreeNode } from '../components/ui/TreeView';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { LoadingState } from '../components/patterns/loading-state';
import { ErrorState } from '../components/patterns/error-state';
import { EmptyState } from '../components/patterns/empty-state';
import { useApiClient } from '../hooks/use-api';

type MetafieldMapping = Readonly<{
  id: string;
  attr_code: string;
  shopify_namespace: string;
  shopify_key: string;
  shopify_type: string;
  is_active: boolean;
  shop_id: string | null;
}>;

type DescriptionTemplate = Readonly<{
  id: string;
  name: string;
  locale: string;
  min_chars: number;
  max_chars: number;
  tone: string | null;
  is_active: boolean;
  prompt_template: string;
}>;

type TaxonomySchemaRow = Readonly<{
  id: string;
  taxonomy_id: string;
  attr_code: string;
  shopify_namespace: string;
  shopify_key: string;
  shopify_type: string;
  is_required: boolean;
  display_name: string | null;
}>;

export default function PimConfigPage() {
  const api = useApiClient();
  const [activeTab, setActiveTab] = useState('metafields');
  const [mappings, setMappings] = useState<MetafieldMapping[]>([]);
  const [templates, setTemplates] = useState<DescriptionTemplate[]>([]);
  const [taxonomyTree, setTaxonomyTree] = useState<TreeNode[]>([]);
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string | null>(null);
  const [taxonomySchema, setTaxonomySchema] = useState<TaxonomySchemaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCommon = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mappingResp, templateResp, filters] = await Promise.all([
        api.getApi<{ mappings: MetafieldMapping[] }>('/pim/metafield-mappings'),
        api.getApi<{ templates: DescriptionTemplate[] }>('/pim/description-templates'),
        api.getApi<{ categories: { id: string; name: string; children?: unknown[] }[] }>(
          '/products/filters'
        ),
      ]);
      setMappings(mappingResp.mappings);
      setTemplates(templateResp.templates);
      const mapTree = (nodes: { id: string; name: string; children?: unknown[] }[]): TreeNode[] =>
        nodes.map((node) => ({
          id: node.id,
          label: node.name,
          ...(Array.isArray(node.children) && node.children.length > 0
            ? {
                children: mapTree(
                  node.children as { id: string; name: string; children?: unknown[] }[]
                ),
              }
            : {}),
        }));
      setTaxonomyTree(mapTree(filters.categories));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eroare la încărcarea configurației');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCommon();
  }, []);

  useEffect(() => {
    if (!selectedTaxonomyId) return;
    void api
      .getApi<{
        schema: TaxonomySchemaRow[];
      }>(`/pim/taxonomy-metafield-schema?taxonomyId=${encodeURIComponent(selectedTaxonomyId)}`)
      .then((data) => setTaxonomySchema(data.schema));
  }, [selectedTaxonomyId]);

  const tabs = useMemo(
    () => [
      { label: 'Metafields Produs', value: 'metafields' },
      { label: 'Template Descrieri', value: 'templates' },
      { label: 'Schema Atribute Taxonomie', value: 'taxonomy' },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <Tabs
        items={tabs}
        value={activeTab}
        onValueChange={setActiveTab}
        ariaLabel="PIM config tabs"
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void loadCommon()} />
      ) : loading ? (
        <LoadingState label="Se încarcă configurația..." />
      ) : null}

      {!error && !loading && activeTab === 'metafields' ? (
        <div className="space-y-3">
          <Button
            onClick={() =>
              void api
                .postApi('/pim/metafield-mappings', {
                  attrCode: 'warranty',
                  shopifyNamespace: 'custom',
                  shopifyKey: 'warranty',
                  shopifyType: 'single_line_text_field',
                  isActive: true,
                })
                .then(loadCommon)
            }
          >
            Adaugă mapare exemplu
          </Button>
          {mappings.length === 0 ? (
            <EmptyState
              title="Fără mapări metafield"
              description="Nu există mapări configurate. Adaugă prima mapare."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted">Cod</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Namespace</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Key</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Tip</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Scope</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((item) => (
                    <tr key={item.id} className="table-row-interactive border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs text-foreground">
                        {item.attr_code}
                      </td>
                      <td className="px-3 py-2 text-muted">{item.shopify_namespace}</td>
                      <td className="px-3 py-2 text-muted">{item.shopify_key}</td>
                      <td className="px-3 py-2 text-muted">{item.shopify_type}</td>
                      <td className="px-3 py-2 text-muted">{item.shop_id ? 'Shop' : 'Global'}</td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void api
                              .getApi(`/pim/metafield-mappings/${item.id}`, { method: 'DELETE' })
                              .then(loadCommon)
                              .catch(() => undefined)
                          }
                        >
                          Șterge
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {!error && !loading && activeTab === 'templates' ? (
        <div className="space-y-3">
          <Button
            onClick={() =>
              void api
                .postApi('/pim/description-templates', {
                  name: 'Template RO',
                  locale: 'ro',
                  minChars: 200,
                  maxChars: 2000,
                  tone: 'professional',
                  promptTemplate:
                    'Genereaza descriere profesionista in romana pentru {{title}} pe baza {{specs}}',
                  isActive: true,
                })
                .then(loadCommon)
            }
          >
            Adaugă template
          </Button>
          {templates.length === 0 ? (
            <EmptyState
              title="Fără template-uri"
              description="Nu există template-uri de descriere configurate."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted">Nume</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Locale</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Min/Max</th>
                    <th className="px-3 py-2 text-left font-medium text-muted">Ton</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((item) => (
                    <tr key={item.id} className="table-row-interactive border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">{item.name}</td>
                      <td className="px-3 py-2 text-muted">{item.locale}</td>
                      <td className="px-3 py-2 text-muted">
                        {item.min_chars} / {item.max_chars}
                      </td>
                      <td className="px-3 py-2 text-muted">{item.tone ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {!error && !loading && activeTab === 'taxonomy' ? (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card padding="sm" variant="bordered">
            <TreeView
              data={taxonomyTree}
              selected={selectedTaxonomyId}
              onSelect={(id) => setSelectedTaxonomyId(id)}
              className="max-h-[520px] overflow-auto"
            />
          </Card>
          <Card padding="sm" variant="bordered" className="space-y-3">
            <Button
              onClick={() => {
                if (!selectedTaxonomyId) return;
                void api
                  .postApi('/pim/taxonomy-metafield-schema', {
                    taxonomyId: selectedTaxonomyId,
                    attrCode: 'material',
                    shopifyNamespace: 'custom',
                    shopifyKey: 'material',
                    shopifyType: 'single_line_text_field',
                    isRequired: false,
                  })
                  .then(() =>
                    api.getApi<{ schema: TaxonomySchemaRow[] }>(
                      `/pim/taxonomy-metafield-schema?taxonomyId=${encodeURIComponent(selectedTaxonomyId)}`
                    )
                  )
                  .then((data) => setTaxonomySchema(data.schema));
              }}
            >
              Adaugă atribut
            </Button>
            {!selectedTaxonomyId ? (
              <p className="text-sm text-muted">Selectează o taxonomie din arborele din stânga.</p>
            ) : taxonomySchema.length === 0 ? (
              <EmptyState
                title="Fără schema atribute"
                description="Nu există atribute configurate pentru această taxonomie."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[400px]">
                  <thead className="bg-subtle">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">Attr code</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Namespace</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Key</th>
                      <th className="px-3 py-2 text-left font-medium text-muted">Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxonomySchema.map((item) => (
                      <tr key={item.id} className="table-row-interactive border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs text-foreground">
                          {item.attr_code}
                        </td>
                        <td className="px-3 py-2 text-muted">{item.shopify_namespace}</td>
                        <td className="px-3 py-2 text-muted">{item.shopify_key}</td>
                        <td className="px-3 py-2 text-muted">{item.is_required ? 'Da' : 'Nu'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
