import { useEffect, useMemo, useState } from 'react';
import { Tabs } from '../components/ui/tabs';
import { TreeView, type TreeNode } from '../components/ui/TreeView';
import { Button } from '../components/ui/button';
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

  const loadCommon = async () => {
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

      {activeTab === 'metafields' ? (
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
          <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-left">Cod</th>
                  <th className="px-3 py-2 text-left">Namespace</th>
                  <th className="px-3 py-2 text-left">Key</th>
                  <th className="px-3 py-2 text-left">Tip</th>
                  <th className="px-3 py-2 text-left">Scope</th>
                  <th className="px-3 py-2 text-left">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((item) => (
                  <tr key={item.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-3 py-2">{item.attr_code}</td>
                    <td className="px-3 py-2">{item.shopify_namespace}</td>
                    <td className="px-3 py-2">{item.shopify_key}</td>
                    <td className="px-3 py-2">{item.shopify_type}</td>
                    <td className="px-3 py-2">{item.shop_id ? 'Shop' : 'Global'}</td>
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
        </div>
      ) : null}

      {activeTab === 'templates' ? (
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
          <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-left">Nume</th>
                  <th className="px-3 py-2 text-left">Locale</th>
                  <th className="px-3 py-2 text-left">Min/Max</th>
                  <th className="px-3 py-2 text-left">Ton</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((item) => (
                  <tr key={item.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2">{item.locale}</td>
                    <td className="px-3 py-2">
                      {item.min_chars} / {item.max_chars}
                    </td>
                    <td className="px-3 py-2">{item.tone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'taxonomy' ? (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
            <TreeView
              data={taxonomyTree}
              selected={selectedTaxonomyId}
              onSelect={(id) => setSelectedTaxonomyId(id)}
              className="max-h-[520px] overflow-auto"
            />
          </div>
          <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
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
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-left">Attr code</th>
                  <th className="px-3 py-2 text-left">Namespace</th>
                  <th className="px-3 py-2 text-left">Key</th>
                  <th className="px-3 py-2 text-left">Required</th>
                </tr>
              </thead>
              <tbody>
                {taxonomySchema.map((item) => (
                  <tr key={item.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-3 py-2">{item.attr_code}</td>
                    <td className="px-3 py-2">{item.shopify_namespace}</td>
                    <td className="px-3 py-2">{item.shopify_key}</td>
                    <td className="px-3 py-2">{item.is_required ? 'Da' : 'Nu'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
