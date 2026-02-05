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
  recentlyPromoted?: boolean;
}>;

export function QualityLevelBadge({ level, recentlyPromoted }: QualityLevelBadgeProps) {
  if (!level) {
    return <PolarisBadge tone="neutral">Unknown</PolarisBadge>;
  }
  const badgeStyle = recentlyPromoted
    ? { animation: 'quality-pulse 2s ease-in-out 3', boxShadow: '0 0 8px currentColor' }
    : undefined;
  return (
    <>
      {recentlyPromoted ? (
        <style>
          {`@keyframes quality-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }`}
        </style>
      ) : null}
      <PolarisBadge tone={toneMap[level]} style={badgeStyle}>
        {labelMap[level]}
      </PolarisBadge>
    </>
  );
}
