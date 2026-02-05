import type { QualityLevel } from '@app/types';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';

import { Button } from '../ui/button';
import { GaugeChart } from '../charts/GaugeChart';
import type { GaugeThreshold } from '../charts/GaugeChart';

type PromotionEligibilityCardProps = Readonly<{
  productId: string;
  currentLevel: QualityLevel;
  qualityScore: number | null;
  sourceCount: number;
  specsCount: number;
  eligibleForPromotion: boolean;
  nextLevel: QualityLevel | null;
  nextThreshold: number | null;
  thresholds: { silver: number; golden: number };
  missingRequirements: string[];
  promotedToSilverAt: string | null;
  promotedToGoldenAt: string | null;
  onPromote?: (level: QualityLevel) => void;
}>;

const LEVELS: QualityLevel[] = ['bronze', 'silver', 'golden'];

function getLevelIndex(level: QualityLevel): number {
  if (level === 'review_needed') return 0;
  return LEVELS.indexOf(level);
}

export function PromotionEligibilityCard(props: PromotionEligibilityCardProps) {
  const {
    currentLevel,
    qualityScore,
    sourceCount,
    specsCount,
    eligibleForPromotion,
    nextLevel,
    nextThreshold,
    thresholds,
    missingRequirements,
    onPromote,
  } = props;

  const gaugeThresholds: GaugeThreshold[] = [
    { value: thresholds.silver, color: '#ffc453' },
    { value: thresholds.golden, color: '#22c55e' },
  ];

  const progressLevelIndex = getLevelIndex(currentLevel);
  const scoreValue = typeof qualityScore === 'number' ? qualityScore : 0;
  const showGoldenBadge = currentLevel === 'golden';

  type ChecklistStatus = 'missing' | 'met' | 'info';
  interface ChecklistItem {
    status: ChecklistStatus;
    text: string;
  }

  const missingItems: ChecklistItem[] = (missingRequirements ?? []).map(
    (text): ChecklistItem => ({ status: 'missing', text })
  );
  const checklistItems: ChecklistItem[] = [...missingItems];

  if (nextLevel && nextThreshold !== null) {
    const meetsScore = scoreValue >= nextThreshold;
    checklistItems.unshift({
      status: meetsScore ? 'met' : 'missing',
      text: `Quality score: ${scoreValue} (target ${nextThreshold} for ${nextLevel})`,
    });
  }

  checklistItems.push({
    status: 'info',
    text: `Sources: ${sourceCount} | Specs: ${specsCount}`,
  });

  if (checklistItems.length === 0) {
    checklistItems.push({ status: 'met', text: 'All promotion requirements met' });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {LEVELS.map((level, index) => {
          const isDone = index < progressLevelIndex;
          const isCurrent = index === progressLevelIndex;
          const circleClass = isCurrent
            ? 'border-2 border-black text-black shadow-sm'
            : isDone
              ? 'border border-emerald-500 text-emerald-600'
              : 'border border-muted text-muted';
          return (
            <div key={level} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full bg-background text-xs font-semibold ${circleClass}`}
              >
                {isDone ? '✓' : level.charAt(0).toUpperCase()}
              </div>
              <div className="text-xs font-medium capitalize">{level}</div>
              {index < LEVELS.length - 1 ? (
                <div className="mx-2 h-1 flex-1 rounded bg-muted/50" />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4">
        <GaugeChart
          value={scoreValue}
          min={0}
          max={1}
          thresholds={gaugeThresholds}
          trackColor="#f87171"
          showValue
          formatValue={(v) => `${Math.round(v * 100)}%`}
          label={nextLevel ? `Next: ${nextThreshold} for ${nextLevel}` : 'Golden Record'}
          size={120}
        />
        <div className="text-sm text-muted">
          <div className="font-medium text-foreground">Quality Score</div>
          <div>Current level: {currentLevel}</div>
          <div>Next level: {nextLevel ?? '—'}</div>
        </div>
      </div>

      <div className="space-y-2">
        {checklistItems.map((item, index) => {
          const icon =
            item.status === 'met' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : item.status === 'missing' ? (
              <XCircle className="h-4 w-4 text-rose-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-500" />
            );
          return (
            <div key={`${item.text}-${index}`} className="flex items-center gap-2 text-sm">
              {icon}
              <span>{item.text}</span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        {eligibleForPromotion && nextLevel ? (
          <Button variant="positive" onClick={() => onPromote?.(nextLevel)}>
            Promote to {nextLevel}
          </Button>
        ) : (
          <Button variant="secondary" disabled>
            Promotion not eligible
          </Button>
        )}

        {showGoldenBadge ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
            Golden Record
          </div>
        ) : null}
      </div>
    </div>
  );
}
