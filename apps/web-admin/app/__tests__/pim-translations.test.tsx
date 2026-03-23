import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LexDomainProfileDto, LexTermDetail } from '@app/types';

import {
  TabContent,
  collectLexShopSettingsFieldErrors,
  collectUniqueDomainCodesFromProfiles,
  lexPublicationActionsDisabledTitle,
  parseExtractScopeTextError,
  type TabContentProps,
  type LexListLoadMore,
} from '../routes/pim-translations-tabs';

function makeTermDetail(overrides?: Partial<LexTermDetail>): LexTermDetail {
  return {
    id: 'term-1',
    shopId: 'shop-1',
    canonicalText: 'Vitamina C',
    normalizedKey: 'vitamina c',
    displayTextRo: null,
    ngramSize: 2,
    termType: 'phrase',
    domainCode: null,
    isTechnical: false,
    isProtected: false,
    status: 'active',
    occurrencesTotal: 3,
    scoreGlobal: 0.9,
    variants: [],
    clusters: [],
    ...overrides,
  };
}

function makeLm(overrides?: Partial<LexListLoadMore>): LexListLoadMore {
  return { hasMore: false, loading: false, onLoadMore: vi.fn(), ...overrides };
}

function makeLexDomainProfileDto(domainCode: string): LexDomainProfileDto {
  return {
    id: `id-${domainCode}`,
    shopId: 's1',
    domainCode,
    nameRo: 'n',
    nameEn: null,
    description: null,
    version: 1,
    isActive: true,
  };
}

function makeProps(overrides?: Partial<TabContentProps>): TabContentProps {
  const noop = vi.fn().mockResolvedValue(undefined);
  return {
    activeTab: 'overview',
    tabLoading: false,
    permissions: {
      canView: true,
      canReview: true,
      canPublish: true,
      canManageSettings: true,
      canGovernance: true,
    },
    metrics: null,
    runs: [],
    terms: [],
    localizations: [],
    reviewItems: [],
    glossary: [],
    rules: [],
    profiles: [],
    stopwords: [],
    governance: [],
    publications: [],
    selectedTerm: null,
    termAffectedProducts: [],
    selectedReview: null,
    selectedPublication: null,
    settings: {
      shopId: 'test-shop',
      version: 1,
      enabled: true,
      sourceLang: 'ro',
      targetLangs: ['en'],
      extractScope: {},
      shardSize: 10_000,
      thresholds: {},
      retentionDaysFragments: 90,
      retentionDaysOccurrences: 90,
      retentionDaysContexts: 180,
      autoPublishProducts: false,
      autoPublishAttributes: false,
      autoPublishCollections: false,
      translationMode: 'auto',
      consensusEscalationThreshold: 0.8,
      translationAutoApproveThreshold: 0.93,
      localizationAutoApproveThreshold: 0.85,
      tmEnabled: true,
      tmSimilarityThreshold: 0.92,
      qualityAuditEnabled: true,
      qualityAuditMinBatchSize: 50,
      maxTermsPerLlmBatch: 10,
      guardrailsLexMode: 'warn',
      guardrailsWarnThreshold: 1000,
      guardrailsWarnCount: 0,
      guardrailsBlockCount: 0,
      guardrailsFalsePositiveCount: 0,
      guardrailsLastEvaluatedAt: null,
    },
    settingsDirty: false,
    savingSettings: false,
    startingRun: false,
    resumingRunId: null,
    termFlagsSaving: false,
    manualTranslationSaving: false,
    editTranslationSaving: false,
    createManualLexTranslation: noop,
    editManualLexTranslation: noop,
    isRunStale: () => false,
    loadAll: noop,
    loadCurrentView: noop,
    handleStartRun: noop,
    handleResumeRun: noop,
    handleSaveSettings: noop,
    selectTerm: noop,
    updateTermFlags: noop,
    selectReview: noop,
    selectPublication: noop,
    handleReviewDecision: noop,
    selectedReviewIdsForBulk: new Set(),
    toggleBulkReviewSelection: vi.fn(),
    selectAllActionableReviewsVisible: vi.fn(),
    clearBulkReviewSelection: vi.fn(),
    bulkReviewBusy: false,
    handleBulkReviewDecision: noop,
    handleAdvancedReviewDecision: noop,
    handlePromoteToGovernance: noop,
    handleGovernanceTransition: noop,
    handleRetryPublication: noop,
    handleRollbackPublication: noop,
    handleResolvePublicationConflict: noop,
    reviewDecisionNotes: '',
    setReviewDecisionNotes: vi.fn(),
    governanceActionNotes: '',
    setGovernanceActionNotes: vi.fn(),
    setTab: vi.fn(),
    setSettings: vi.fn(),
    extractScopeText: '{}',
    setExtractScopeText: vi.fn(),
    refreshGlossary: noop,
    createGlossaryEntry: noop,
    updateGlossaryEntry: noop,
    deleteGlossaryEntry: noop,
    refreshRules: noop,
    createLexRule: noop,
    updateLexRule: noop,
    deleteLexRule: noop,
    refreshProfiles: noop,
    createLexProfile: noop,
    updateLexProfile: noop,
    deleteLexProfile: noop,
    refreshStopwords: noop,
    createLexStopword: noop,
    updateLexStopword: noop,
    deleteLexStopword: noop,
    requestLexConfirm: vi.fn().mockResolvedValue(true),
    handleDownloadLexCsvExport: noop,
    handleDownloadLexXliffExport: noop,
    handleImportXliff: noop,
    termsListFilters: { q: '', status: '', domainCode: '', minScore: '', maxScore: '' },
    onTermsFiltersInputChange: vi.fn(),
    onTermsFiltersSearch: vi.fn(),
    onTermsFilterImmediate: vi.fn(),
    onTermsFilterDraft: vi.fn(),
    onTermsFiltersReload: vi.fn(),
    onClearTermsListFilters: vi.fn(),
    reviewListFilters: { q: '', status: '', severity: '', entityType: '' },
    onReviewFiltersInputChange: vi.fn(),
    onReviewFiltersSearch: vi.fn(),
    onReviewFilterImmediate: vi.fn(),
    onClearReviewListFilters: vi.fn(),
    publicationsListFilters: { q: '', status: '', targetType: '' },
    onPublicationsFiltersInputChange: vi.fn(),
    onPublicationsFiltersSearch: vi.fn(),
    onPublicationsFilterImmediate: vi.fn(),
    onClearPublicationsListFilters: vi.fn(),
    glossaryListFilters: { q: '' },
    onGlossaryFiltersInputChange: vi.fn(),
    onGlossaryFiltersSearch: vi.fn(),
    onClearGlossaryListFilters: vi.fn(),
    lexLoadMore: {
      overviewRuns: makeLm(),
      overviewLocalizations: makeLm(),
      runs: makeLm(),
      terms: makeLm(),
      review: makeLm(),
      publications: makeLm(),
      glossary: makeLm(),
      rules: makeLm(),
      profiles: makeLm(),
      stopwords: makeLm(),
      governance: makeLm(),
      termProducts: makeLm(),
    },
    guardrailsStats: null,
    guardrailsEvents: [],
    handleGuardrailsModeChange: noop,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  1. Tab rendering / tab switching                                   */
/* ------------------------------------------------------------------ */

describe('TabContent – tab rendering', () => {
  it('renders overview tab by default', () => {
    render(<TabContent {...makeProps()} />);
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });

  it('renders settings tab', () => {
    render(<TabContent {...makeProps({ activeTab: 'settings' })} />);
    expect(screen.getByText('Save Settings')).toBeInTheDocument();
  });

  it('renders terms tab with empty inventory', () => {
    render(<TabContent {...makeProps({ activeTab: 'terms' })} />);
    expect(screen.getByText('Term Inventory')).toBeInTheDocument();
    expect(screen.getByText('Empty inventory')).toBeInTheDocument();
  });

  it('renders review tab', () => {
    render(<TabContent {...makeProps({ activeTab: 'review' })} />);
    expect(screen.getByText('Review Queue')).toBeInTheDocument();
  });

  it('renders governance tab', () => {
    render(<TabContent {...makeProps({ activeTab: 'governance' })} />);
    expect(screen.getByText('Global Canon Governance')).toBeInTheDocument();
  });

  it('renders glossary tab', () => {
    render(<TabContent {...makeProps({ activeTab: 'glossary' })} />);
    expect(screen.getByText('Search glossary')).toBeInTheDocument();
  });

  it('renders null for unknown tab', () => {
    const { container } = render(<TabContent {...makeProps({ activeTab: '__unknown__' })} />);
    expect(container.innerHTML).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/*  2. Loading skeleton                                                */
/* ------------------------------------------------------------------ */

describe('TabContent – loading state', () => {
  it('shows skeleton when tabLoading is true', () => {
    const { container } = render(<TabContent {...makeProps({ tabLoading: true })} />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('does NOT show skeleton when tabLoading is false', () => {
    const { container } = render(<TabContent {...makeProps({ tabLoading: false })} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  3. Search input filtering (terms)                                  */
/* ------------------------------------------------------------------ */

describe('TabContent – search input filtering', () => {
  it('renders search input on terms tab', () => {
    render(<TabContent {...makeProps({ activeTab: 'terms' })} />);
    expect(screen.getByText('Search terms')).toBeInTheDocument();
  });

  it('renders search input on review tab', () => {
    render(<TabContent {...makeProps({ activeTab: 'review' })} />);
    expect(screen.getByText('Search review')).toBeInTheDocument();
  });

  it('renders search input on publications tab', () => {
    render(<TabContent {...makeProps({ activeTab: 'publications' })} />);
    expect(screen.getByText('Search publications')).toBeInTheDocument();
  });

  it('renders search input on glossary tab', () => {
    render(<TabContent {...makeProps({ activeTab: 'glossary' })} />);
    expect(screen.getByText('Search glossary')).toBeInTheDocument();
  });

  it('clear filters button is disabled when no active filters', () => {
    render(<TabContent {...makeProps({ activeTab: 'terms' })} />);
    const clearBtn = screen.getByText('Clear filters');
    expect(clearBtn).toBeDisabled();
  });

  it('clear filters button is enabled when filters are active', () => {
    render(
      <TabContent
        {...makeProps({
          activeTab: 'terms',
          termsListFilters: { q: 'test', status: '', domainCode: '', minScore: '', maxScore: '' },
        })}
      />
    );
    const clearBtn = screen.getByText('Clear filters');
    expect(clearBtn).not.toBeDisabled();
  });
});

/* ------------------------------------------------------------------ */
/*  4. Pagination – cursor-based load more                             */
/* ------------------------------------------------------------------ */

describe('TabContent – pagination load more', () => {
  it('shows Load more button when hasMore is true', () => {
    const onLoadMore = vi.fn();
    const props = makeProps({
      activeTab: 'terms',
      lexLoadMore: {
        ...makeProps().lexLoadMore,
        terms: makeLm({ hasMore: true, onLoadMore }),
      },
    });
    render(<TabContent {...props} />);
    const btn = screen.getByText('Load more');
    expect(btn).toBeInTheDocument();
  });

  it('hides Load more when hasMore is false', () => {
    render(<TabContent {...makeProps({ activeTab: 'terms' })} />);
    expect(screen.queryByText('Load more')).not.toBeInTheDocument();
  });

  it('fires onLoadMore when button is clicked', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const props = makeProps({
      activeTab: 'terms',
      lexLoadMore: {
        ...makeProps().lexLoadMore,
        terms: makeLm({ hasMore: true, onLoadMore }),
      },
    });
    render(<TabContent {...props} />);
    await user.click(screen.getByText('Load more'));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('shows Loading… text when lm.loading is true', () => {
    const props = makeProps({
      activeTab: 'terms',
      lexLoadMore: {
        ...makeProps().lexLoadMore,
        terms: makeLm({ hasMore: true, loading: true }),
      },
    });
    render(<TabContent {...props} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  5. Settings dirty state tracking                                   */
/* ------------------------------------------------------------------ */

describe('TabContent – settings dirty state', () => {
  it('disables Save button when not dirty', () => {
    render(<TabContent {...makeProps({ activeTab: 'settings', settingsDirty: false })} />);
    const btn = screen.getByText('Save Settings');
    expect(btn).toBeDisabled();
  });

  it('enables Save button when dirty', () => {
    render(<TabContent {...makeProps({ activeTab: 'settings', settingsDirty: true })} />);
    const btn = screen.getByText('Save Settings');
    expect(btn).not.toBeDisabled();
  });

  it('shows Saving... label when savingSettings is true', () => {
    render(
      <TabContent
        {...makeProps({
          activeTab: 'settings',
          settingsDirty: true,
          savingSettings: true,
        })}
      />
    );
    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });

  it('calls handleSaveSettings on save click', async () => {
    const user = userEvent.setup();
    const handleSaveSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <TabContent
        {...makeProps({
          activeTab: 'settings',
          settingsDirty: true,
          handleSaveSettings,
        })}
      />
    );
    await user.click(screen.getByText('Save Settings'));
    expect(handleSaveSettings).toHaveBeenCalledOnce();
  });
});

/* ------------------------------------------------------------------ */
/*  6. Confirmation dialog display (review decisions)                  */
/* ------------------------------------------------------------------ */

describe('TabContent – confirmation dialog', () => {
  it('calls requestLexConfirm when approve is clicked', async () => {
    const user = userEvent.setup();
    const requestLexConfirm = vi.fn().mockResolvedValue(true);
    const props = makeProps({
      activeTab: 'review',
      requestLexConfirm,
      reviewItems: [
        {
          id: 'rev-1',
          entityType: 'translation',
          entityId: 'ent-1',
          reviewReason: 'low_confidence',
          severity: 'medium',
          priority: 100,
          status: 'pending',
          version: 1,
          evidence: {},
          notes: null,
        },
      ],
    });
    render(<TabContent {...props} />);
    const approveBtn = screen.getByLabelText('Approve review ent-1');
    await user.click(approveBtn);
    expect(requestLexConfirm).toHaveBeenCalledOnce();
  });

  it('calls requestLexConfirm when reject is clicked', async () => {
    const user = userEvent.setup();
    const requestLexConfirm = vi.fn().mockResolvedValue(true);
    const props = makeProps({
      activeTab: 'review',
      requestLexConfirm,
      reviewItems: [
        {
          id: 'rev-1',
          entityType: 'translation',
          entityId: 'ent-1',
          reviewReason: 'low_confidence',
          severity: 'medium',
          priority: 100,
          status: 'pending',
          version: 1,
          evidence: {},
          notes: null,
        },
      ],
    });
    render(<TabContent {...props} />);
    const rejectBtn = screen.getByLabelText('Reject review ent-1');
    await user.click(rejectBtn);
    expect(requestLexConfirm).toHaveBeenCalledOnce();
  });
});

/* ------------------------------------------------------------------ */
/*  7. Terms list display and selection                                */
/* ------------------------------------------------------------------ */

describe('TabContent – terms list', () => {
  it('renders term rows in the inventory', () => {
    const props = makeProps({
      activeTab: 'terms',
      terms: [
        {
          id: 't1',
          canonicalText: 'alphaterm',
          normalizedKey: 'alphaterm',
          displayTextRo: null,
          ngramSize: 1,
          termType: 'noun',
          domainCode: null,
          isTechnical: false,
          isProtected: false,
          status: 'active',
          occurrencesTotal: 42,
          scoreGlobal: 0.88,
        },
      ],
    });
    render(<TabContent {...props} />);
    expect(screen.getByText('alphaterm')).toBeInTheDocument();
    expect(screen.getByText('noun')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('calls selectTerm on row click', async () => {
    const user = userEvent.setup();
    const selectTerm = vi.fn().mockResolvedValue(undefined);
    const props = makeProps({
      activeTab: 'terms',
      selectTerm,
      terms: [
        {
          id: 't1',
          canonicalText: 'betaword',
          normalizedKey: 'betaword',
          displayTextRo: null,
          ngramSize: 1,
          termType: 'noun',
          domainCode: null,
          isTechnical: false,
          isProtected: false,
          status: 'active',
          occurrencesTotal: 10,
          scoreGlobal: null,
        },
      ],
    });
    render(<TabContent {...props} />);
    await user.click(screen.getByText('betaword'));
    expect(selectTerm).toHaveBeenCalledWith('t1');
  });
});

/* ------------------------------------------------------------------ */
/*  8. Runs display                                                    */
/* ------------------------------------------------------------------ */

describe('TabContent – runs tab', () => {
  it('renders run table rows', () => {
    const props = makeProps({
      activeTab: 'runs',
      runs: [
        {
          id: 'run-1',
          shopId: 'shop-1',
          runType: 'delta_rebuild',
          status: 'completed',
          pauseReason: null,
          currentPhase: null,
          startedAt: '2025-01-01T00:00:00Z',
          completedAt: '2025-01-01T01:00:00Z',
          fragmentsCount: 500,
          occurrencesCount: 1200,
          termsCount: 100,
          contextsCount: 80,
          senseClustersCount: 50,
          translationsCount: 300,
          aiBatchesCount: 5,
          errorMessage: null,
          metadata: {},
        },
      ],
    });
    render(<TabContent {...props} />);
    expect(screen.getByText('delta_rebuild')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('shows resume button for paused runs', () => {
    const props = makeProps({
      activeTab: 'runs',
      runs: [
        {
          id: 'run-2',
          shopId: 'shop-1',
          runType: 'delta_rebuild',
          status: 'paused',
          pauseReason: 'budget_blocked',
          currentPhase: 'translate.candidates',
          startedAt: '2025-01-01T00:00:00Z',
          completedAt: null,
          fragmentsCount: 200,
          occurrencesCount: 800,
          termsCount: 50,
          contextsCount: 30,
          senseClustersCount: 10,
          translationsCount: 100,
          aiBatchesCount: 2,
          errorMessage: null,
          metadata: {},
        },
      ],
    });
    render(<TabContent {...props} />);
    const resumeButtons = screen.getAllByText('Resume');
    expect(resumeButtons.length).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/*  9. Glossary tab – delegate rendering                               */
/* ------------------------------------------------------------------ */

describe('TabContent – glossary tab', () => {
  it('renders glossary search and delegates to GlossaryTabPanel', () => {
    render(<TabContent {...makeProps({ activeTab: 'glossary' })} />);
    expect(screen.getByText('Search glossary')).toBeInTheDocument();
  });

  it('shows clear search when glossary filter is active', () => {
    render(
      <TabContent
        {...makeProps({
          activeTab: 'glossary',
          glossaryListFilters: { q: 'test' },
        })}
      />
    );
    expect(screen.getByText('Clear search')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  10. Publications tab                                               */
/* ------------------------------------------------------------------ */

describe('TabContent – publications tab', () => {
  it('renders publication targets section', () => {
    render(<TabContent {...makeProps({ activeTab: 'publications' })} />);
    expect(screen.getByText('Publication Targets')).toBeInTheDocument();
    expect(screen.getByText('No publication targets')).toBeInTheDocument();
  });

  it('shows filter controls', () => {
    render(<TabContent {...makeProps({ activeTab: 'publications' })} />);
    expect(screen.getByText('Search publications')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  11. Accessibility – ARIA attributes                                */
/* ------------------------------------------------------------------ */

describe('TabContent – accessibility', () => {
  it('wraps content in role=tabpanel', () => {
    const { container } = render(<TabContent {...makeProps()} />);
    expect(container.querySelector('[role="tabpanel"]')).toBeInTheDocument();
  });

  it('sets aria-live=polite on tabpanel', () => {
    const { container } = render(<TabContent {...makeProps()} />);
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });

  it('save button has aria-label', () => {
    render(<TabContent {...makeProps({ activeTab: 'settings', settingsDirty: true })} />);
    const saveBtn = screen.getByText('Save Settings');
    expect(saveBtn).toHaveAttribute('aria-label', 'Save settings');
  });

  it('fieldset has aria-label', () => {
    const { container } = render(<TabContent {...makeProps({ activeTab: 'settings' })} />);
    const fieldset = container.querySelector('fieldset');
    expect(fieldset).toHaveAttribute('aria-label', 'Lexical module settings');
  });

  it('tables have captions', () => {
    const props = makeProps({
      activeTab: 'overview',
      metrics: {
        runsTotal: 0,
        termsTotal: 0,
        clustersTotal: 0,
        glossaryTotal: 0,
        reviewPending: 0,
        reviewBacklog: 0,
        publicationsPending: 0,
        publicationsFailed: 0,
        localizationsApproved: 0,
        runsActive: 0,
        runsPaused: 0,
        pausedBudgetBlocked: 0,
        pausedProviderUnavailable: 0,
        shardsFailed: 0,
        publishConflicts: 0,
        staleCheckpoints: 0,
        aiBatchBacklog: 0,
        dlqEntries: 0,
        workersOnline: 0,
        workersTotal: 0,
        retentionLag: 0,
        tmHitRatePercent: 0,
        tmMissRatePercent: 0,
        tmAverageSimilarity: null,
        tmHits: 0,
        tmMisses: 0,
        alerts: [],
        workers: [],
        queues: [
          {
            name: 'lex-extract',
            waiting: 0,
            active: 0,
            delayed: 0,
            failed: 0,
            completed: 0,
            dlqEntries: 0,
            queueUrl: '/q',
            dlqQueueName: 'lex-extract-dlq',
            dlqUrl: '/d',
          },
        ],
      },
      runs: [
        {
          id: 'run-1',
          shopId: 'shop-1',
          runType: 'delta_rebuild',
          status: 'completed',
          pauseReason: null,
          currentPhase: null,
          startedAt: '2025-01-01T00:00:00Z',
          completedAt: '2025-01-01T01:00:00Z',
          fragmentsCount: 0,
          occurrencesCount: 0,
          termsCount: 0,
          contextsCount: 0,
          senseClustersCount: 0,
          translationsCount: 0,
          aiBatchesCount: 0,
          errorMessage: null,
          metadata: {},
        },
      ],
    });
    const { container } = render(<TabContent {...props} />);
    const captions = container.querySelectorAll('caption');
    expect(captions.length).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Manual translation – LexTermManualTranslationBlock                 */
/* ------------------------------------------------------------------ */

describe('TabContent – manual translation (term detail)', () => {
  it('shows fixed target language when shop has a single targetLang', () => {
    const base = makeProps();
    render(
      <TabContent
        {...makeProps({
          activeTab: 'terms',
          selectedTerm: makeTermDetail(),
          settings: { ...base.settings!, targetLangs: ['de'] },
        })}
      />
    );
    const targetLine = screen.getByText(/Target language:/i).closest('p');
    expect(targetLine).not.toBeNull();
    expect(targetLine).toHaveTextContent('de');
  });

  it('submits selected target language when multiple targetLangs', async () => {
    const user = userEvent.setup();
    const createManualLexTranslation = vi.fn().mockResolvedValue(undefined);
    const base = makeProps();
    render(
      <TabContent
        {...makeProps({
          activeTab: 'terms',
          selectedTerm: makeTermDetail(),
          createManualLexTranslation,
          settings: { ...base.settings!, targetLangs: ['en', 'fr'] },
        })}
      />
    );
    const langSelect = screen.getByLabelText(/Target language/i);
    await user.selectOptions(langSelect, 'fr');
    await user.type(screen.getByPlaceholderText('Enter manual translation...'), '  Vitamin C  ');
    await user.click(screen.getByRole('button', { name: /save translation/i }));
    expect(createManualLexTranslation).toHaveBeenCalledWith({
      translatedText: 'Vitamin C',
      targetLang: 'fr',
      clusterId: null,
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Lex PIM helpers (profiles / publications)                         */
/* ------------------------------------------------------------------ */

describe('collectUniqueDomainCodesFromProfiles', () => {
  it('returns sorted unique codes, trims, skips empty', () => {
    expect(
      collectUniqueDomainCodesFromProfiles([
        makeLexDomainProfileDto('z'),
        makeLexDomainProfileDto('a'),
        makeLexDomainProfileDto('a'),
        { ...makeLexDomainProfileDto('x'), domainCode: '  x  ' },
        { ...makeLexDomainProfileDto('blank'), domainCode: '   ' },
        { ...makeLexDomainProfileDto('empty'), domainCode: '' },
      ])
    ).toEqual(['a', 'x', 'z']);
  });
});

describe('lexPublicationActionsDisabledTitle', () => {
  it('returns tooltip text when publishing is disabled', () => {
    expect(lexPublicationActionsDisabledTitle(true)).toContain('lex_publish_enabled');
  });

  it('returns undefined when publishing is allowed', () => {
    expect(lexPublicationActionsDisabledTitle(false)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Settings validation helpers                                         */
/* ------------------------------------------------------------------ */

describe('collectLexShopSettingsFieldErrors', () => {
  it('returns null when settings is null', () => {
    expect(collectLexShopSettingsFieldErrors(null)).toBeNull();
  });

  it('returns null for default makeProps settings', () => {
    expect(collectLexShopSettingsFieldErrors(makeProps().settings)).toBeNull();
  });

  it('flags invalid shard size', () => {
    const s = makeProps().settings!;
    const errs = collectLexShopSettingsFieldErrors({ ...s, shardSize: 0 });
    expect(errs).not.toBeNull();
    expect(errs?.some((m) => m.includes('Shard size'))).toBe(true);
  });
});

describe('parseExtractScopeTextError', () => {
  it('returns null for valid JSON object', () => {
    expect(parseExtractScopeTextError('{}')).toBeNull();
  });

  it('returns a message for invalid JSON', () => {
    const msg = parseExtractScopeTextError('{');
    expect(msg).not.toBeNull();
    expect(msg!.length).toBeGreaterThan(0);
  });
});
