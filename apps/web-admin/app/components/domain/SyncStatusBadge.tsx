import type { SyncStatus } from '@app/types';
import { PolarisBadge } from '../../../components/polaris/badge';
import { PolarisTooltip } from '../../../components/polaris/tooltip';

const labelMap: Record<SyncStatus, string> = {
  synced: 'Synced',
  pending: 'Pending',
  error: 'Error',
  never: 'Never',
};

const toneMap: Record<SyncStatus, 'success' | 'warning' | 'critical' | 'info' | 'new' | 'neutral'> =
  {
    synced: 'success',
    pending: 'warning',
    error: 'critical',
    never: 'neutral',
  };

type SyncStatusBadgeProps = Readonly<{
  status: SyncStatus | null | undefined;
  lastSyncedAt?: string | null;
  errorMessage?: string | null;
}>;

export function SyncStatusBadge({ status, lastSyncedAt, errorMessage }: SyncStatusBadgeProps) {
  const resolved: SyncStatus = status ?? 'never';
  const tooltip = (() => {
    if (resolved === 'synced') {
      return lastSyncedAt ? `Last synced: ${lastSyncedAt}` : 'Synced';
    }
    if (resolved === 'pending') return 'Sync pending';
    if (resolved === 'error') return errorMessage ?? 'Sync error';
    return 'Never synced';
  })();

  return (
    <PolarisTooltip content={tooltip}>
      <PolarisBadge tone={toneMap[resolved]}>{labelMap[resolved]}</PolarisBadge>
    </PolarisTooltip>
  );
}
