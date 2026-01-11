import { Database, Package, RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react';

import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { Timeline, type TimelineEvent } from '../components/ui/Timeline';
import { Button } from '../components/ui/button';
import { PolarisCard } from '../../components/polaris/index.js';

// Demo data for Timeline - in production this would come from an API
const demoIngestionEvents: TimelineEvent[] = [
  {
    id: '1',
    timestamp: new Date(),
    title: 'Products sync completed',
    description: 'Successfully synced 1,250 products from Shopify',
    status: 'success',
    metadata: { productsCount: 1250, duration: '2m 34s', source: 'Shopify GraphQL' },
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    title: 'Collections sync started',
    description: 'Fetching collections from Shopify Admin API',
    status: 'info',
    metadata: { collectionsQueued: 45 },
  },
  {
    id: '3',
    timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
    title: 'Inventory update failed',
    description: 'Rate limit exceeded - will retry in 5 minutes',
    status: 'error',
    metadata: { errorCode: 'RATE_LIMIT', retryAt: '14:35:00' },
  },
  {
    id: '4',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
    title: 'Full catalog sync completed',
    description: 'Daily scheduled sync finished successfully',
    status: 'success',
    metadata: { products: 1248, collections: 42, variants: 5420 },
  },
  {
    id: '5',
    timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000), // Yesterday
    title: 'Full catalog sync started',
    description: 'Scheduled daily sync initiated',
    status: 'info',
  },
  {
    id: '6',
    timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000), // 2 days ago
    title: 'Webhook received: product/update',
    description: 'Product "Summer T-Shirt" was updated in Shopify',
    status: 'neutral',
    metadata: { productId: '7654321098765', handle: 'summer-t-shirt' },
  },
];

export default function IngestionPage() {
  const location = useLocation();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Ingestion', href: location.pathname },
    ],
    [location.pathname]
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Simulate API call
    setTimeout(() => setIsRefreshing(false), 1500);
  };

  // Stats computed from events
  const stats = useMemo(() => {
    const successCount = demoIngestionEvents.filter((e) => e.status === 'success').length;
    const errorCount = demoIngestionEvents.filter((e) => e.status === 'error').length;
    const pendingCount = demoIngestionEvents.filter((e) => e.status === 'info').length;
    return { successCount, errorCount, pendingCount, total: demoIngestionEvents.length };
  }, []);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-h2">Bulk Ingestion</h1>
          <p className="mt-1 text-body text-muted">
            Monitor and manage data synchronization with Shopify
          </p>
        </div>
        <Button variant="secondary" onClick={handleRefresh} disabled={isRefreshing}>
          <span className="inline-flex items-center gap-2">
            <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </span>
        </Button>
      </header>

      {/* Stats Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PolarisCard>
          <div className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900">
              <CheckCircle className="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="text-h3">{stats.successCount}</div>
              <div className="text-caption text-muted">Successful</div>
            </div>
          </div>
        </PolarisCard>

        <PolarisCard>
          <div className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-red-100 p-2 dark:bg-red-900">
              <AlertCircle className="size-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <div className="text-h3">{stats.errorCount}</div>
              <div className="text-caption text-muted">Failed</div>
            </div>
          </div>
        </PolarisCard>

        <PolarisCard>
          <div className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900">
              <Clock className="size-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="text-h3">{stats.pendingCount}</div>
              <div className="text-caption text-muted">In Progress</div>
            </div>
          </div>
        </PolarisCard>

        <PolarisCard>
          <div className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-gray-100 p-2 dark:bg-gray-800">
              <Package className="size-5 text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <div className="text-h3">{stats.total}</div>
              <div className="text-caption text-muted">Total Events</div>
            </div>
          </div>
        </PolarisCard>
      </section>

      {/* Timeline Section */}
      <section>
        <PolarisCard>
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-h3">Sync Activity Timeline</h2>
                <p className="text-caption text-muted">
                  Recent synchronization events and status updates
                </p>
              </div>
              <Database className="size-5 text-muted" />
            </div>

            <Timeline
              events={demoIngestionEvents}
              showGroupHeaders
              relativeTime
              expandable
              maxHeight={500}
              className="rounded-md border bg-muted/5"
            />
          </div>
        </PolarisCard>
      </section>
    </div>
  );
}
