import type { QualityLevel } from '@app/types';
import { PolarisBadge } from '../../../components/polaris/badge';

const labelMap: Record<QualityLevel, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  golden: 'Golden',
  review_needed: 'Review',
};

const toneMap: Record<
  QualityLevel,
  'success' | 'warning' | 'critical' | 'info' | 'new' | 'neutral'
> = {
  bronze: 'neutral',
  silver: 'info',
  golden: 'success',
  review_needed: 'warning',
};

type QualityLevelBadgeProps = Readonly<{
  level: QualityLevel | null | undefined;
}>;

export function QualityLevelBadge({ level }: QualityLevelBadgeProps) {
  if (!level) {
    return <PolarisBadge tone="neutral">Unknown</PolarisBadge>;
  }
  return <PolarisBadge tone={toneMap[level]}>{labelMap[level]}</PolarisBadge>;
}
