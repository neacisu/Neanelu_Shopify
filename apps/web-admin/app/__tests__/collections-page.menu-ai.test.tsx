import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CollectionsPage from '../routes/app.collections';

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast,
}));

const apiState = vi.hoisted(() => ({
  getApi: vi.fn(),
  postApi: vi.fn(),
  patchApi: vi.fn(),
  deleteApi: vi.fn(),
  streamPost: vi.fn(),
}));

vi.mock('../hooks/use-api', () => ({
  useApiClient: () => apiState,
}));

vi.mock('../hooks/useScrollReveal', () => ({
  useScrollReveal: () => [vi.fn(), true],
}));

const collectionRow = {
  id: 'col-1',
  shopify_gid: 'gid://shopify/Collection/1',
  legacy_resource_id: 1,
  title: 'Robineti irigatii',
  title_en: 'Irrigation Valves',
  handle: 'robineti-irigatii',
  collection_type: 'SMART',
  products_count: 12,
  taxonomy_count: 1,
  taxonomy_name: 'Valves',
  synced_at: new Date().toISOString(),
  description: null,
  description_html: null,
  image_url: null,
  parent_collection_id: null,
  parent_title: null,
  menu_level: 2,
  menu_path: 'Sisteme de Irigatii > Fitinguri > Robineti irigatii',
  menu_assignment_count: 2,
  menu_review_count: 1,
};

const assignmentStatus = {
  activeAssignments: [
    {
      id: 'active-1',
      menuItemId: 'menu-1',
      menuItemTitle: 'Robineti',
      menuItemPath: 'Sisteme de Irigatii > Fitinguri > Robineti',
      menuItemLevel: 3,
      assignmentSource: 'ai',
      isPrimary: false,
      confidence: 0.91,
      reasoning: 'Potrivire foarte bună.',
      translatedQuery: 'Irrigation valves',
      proposedPath: null,
      status: 'active',
      createdAt: new Date().toISOString(),
      approvedAt: null,
    },
  ],
  proposedAssignments: [
    {
      id: 'prop-1',
      menuItemId: 'menu-2',
      menuItemTitle: 'Fitinguri speciale',
      menuItemPath: 'Sisteme de Irigatii > Fitinguri speciale',
      menuItemLevel: 2,
      assignmentSource: 'ai',
      isPrimary: false,
      confidence: 0.72,
      reasoning: 'Necesită review uman.',
      translatedQuery: 'Special irrigation fittings',
      proposedPath: null,
      status: 'proposed',
      createdAt: new Date().toISOString(),
      approvedAt: null,
    },
    {
      id: 'prop-path-1',
      menuItemId: null,
      menuItemTitle: 'Path nou',
      menuItemPath: 'Sisteme de Irigatii > Propuneri',
      menuItemLevel: null,
      assignmentSource: 'ai',
      isPrimary: false,
      confidence: 0.41,
      reasoning: 'Lipsește o categorie dedicată.',
      translatedQuery: 'Irrigation proposal',
      proposedPath: 'Sisteme de Irigatii > Fitinguri > Robineti premium',
      status: 'proposed',
      createdAt: new Date().toISOString(),
      approvedAt: null,
    },
  ],
  rejectedAssignments: [],
  primaryAssignment: null,
  collectionMenuPath: collectionRow.menu_path,
  canRunAi: true,
};

function setupApiMocks() {
  apiState.getApi.mockImplementation((path: string) => {
    if (path.startsWith('/collections?')) {
      return Promise.resolve({
        collections: [collectionRow],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });
    }

    if (path === '/collections/stats') {
      return Promise.resolve({
        total: 1,
        manual: 0,
        smart: 1,
        withTaxonomy: 1,
        translated: 1,
        inMenu: 1,
        roots: 0,
        notInMenu: 0,
        totalProducts: 12,
        lastSyncedAt: new Date().toISOString(),
      });
    }

    if (path === '/collections/sync/status') {
      return Promise.resolve({
        status: 'completed',
        progress: {
          percent: 100,
          phase: 'done',
          fetched: 1,
          total: 1,
          menuItems: 2,
          correlated: 1,
          menuItemsEmbedded: 2,
          menuItemsTotal: 2,
          embeddingErrors: 0,
        },
        createdAt: new Date().toISOString(),
        processedOn: new Date().toISOString(),
        finishedOn: new Date().toISOString(),
      });
    }

    if (path === `/collections/${collectionRow.id}/products`) {
      return Promise.resolve({ products: [] });
    }

    if (path === `/collections/${collectionRow.id}/metafields`) {
      return Promise.resolve({ metafields: {} });
    }

    if (path === `/collections/${collectionRow.id}/menu-assignment-status`) {
      return Promise.resolve(assignmentStatus);
    }

    if (path === `/collections/${collectionRow.id}`) {
      return Promise.resolve({ collection: collectionRow });
    }

    if (path.startsWith('/collections/all-ids')) {
      return Promise.resolve({ ids: [collectionRow.id], total: 1 });
    }

    return Promise.reject(new Error(`Unhandled GET ${path}`));
  });

  apiState.postApi.mockResolvedValue({ success: true });
  apiState.patchApi.mockResolvedValue({ success: true });
  apiState.deleteApi.mockResolvedValue({ success: true });
  apiState.streamPost.mockImplementation(
    (path: string, _body: unknown, onEvent: (event: Record<string, unknown>) => void) => {
      if (path === '/collections/bulk/assign-menu-ai') {
        onEvent({
          type: 'menu_assign_collection_start',
          collectionId: collectionRow.id,
          collectionTitle: collectionRow.title,
        });
        onEvent({
          type: 'menu_assign_progress',
          collectionId: collectionRow.id,
          step: 'consensus_start',
          message: '4 agenti evalueaza selecția...',
          status: 'done',
        });
        onEvent({
          type: 'menu_assign_progress',
          collectionId: collectionRow.id,
          step: 'reasoning',
          message: 'Analizez candidații',
          status: 'done',
        });
        onEvent({
          type: 'menu_assign_collection_result',
          collectionId: collectionRow.id,
          collectionTitle: collectionRow.title,
          status: 'assigned',
          primaryCount: 1,
          secondaryCount: 1,
          message: '1 primară, 1 secundară',
          consensusMethod: 'majority',
          consensusScore: 0.75,
        });
        onEvent({ type: 'menu_assign_done' });
        return;
      }

      if (path === `/collections/${collectionRow.id}/assign-menu-ai`) {
        onEvent({
          type: 'menu_assign_progress',
          step: 'consensus_start',
          message: '4 agenti evalueaza selecția...',
          status: 'done',
        });
        onEvent({
          type: 'menu_assign_progress',
          step: 'translating',
          message: 'Traduc colecția',
          status: 'done',
        });
        onEvent({
          type: 'menu_assign_collection_result',
          status: 'proposed',
          message: '1 primară, 1 secundară',
          consensusMethod: 'majority',
          consensusScore: 0.75,
        });
        return;
      }

      throw new Error(`Unhandled stream ${path}`);
    }
  );
}

describe('Collections page menu AI UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the new menu AI tab with active and proposed assignments', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Robineti irigatii')).toBeInTheDocument();
    await user.click(screen.getByText('Robineti irigatii'));
    await user.click(await screen.findByRole('button', { name: 'Categorii AI' }));

    expect(await screen.findByText('Asocieri active')).toBeInTheDocument();
    expect(screen.getByText('Propuneri AI')).toBeInTheDocument();
    expect(screen.getByText('Propuneri path nou')).toBeInTheDocument();
    expect(screen.getByText('Setează ca primară')).toBeInTheDocument();
    expect(screen.getAllByText('Aprobă').length).toBeGreaterThan(0);

    await user.click(
      screen.getByRole('button', { name: /Reasignează cu AI|Asignează cu AI pe categorii/i })
    );
    expect(await screen.findByText('Traduc colecția')).toBeInTheDocument();
    expect(await screen.findByText('1 primară, 1 secundară')).toBeInTheDocument();
    expect(await screen.findByText('4 agenti evalueaza selecția...')).toBeInTheDocument();
    expect(await screen.findByText('Consens: majority 3/4 · scor 0.75')).toBeInTheDocument();
  });

  it('shows bulk menu AI button and progress panel', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Robineti irigatii')).toBeInTheDocument();
    const checkbox = screen.getAllByRole('checkbox')[1]!;
    await user.click(checkbox);

    const bulkButton = await screen.findByRole('button', { name: 'Categorii/meniu AI' });
    await user.click(bulkButton);

    expect(await screen.findByText(/Asignare completă/i)).toBeInTheDocument();
    expect(screen.getAllByText(collectionRow.title).length).toBeGreaterThan(0);
    expect(screen.getByText('1 primară, 1 secundară')).toBeInTheDocument();
    await user.click(screen.getAllByText(collectionRow.title)[0]!);
    expect(await screen.findByText('Consens: majority 3/4 · scor 0.75')).toBeInTheDocument();
  });
});
