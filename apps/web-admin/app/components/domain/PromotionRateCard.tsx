import type { ReactNode } from 'react';
import { ArrowUpRight, AlertTriangle, Trophy } from 'lucide-react';

export interface PromotionRateCardProps {
  label: string;
  value: number;
  icon?: ReactNode;
  variant?: 'default' | 'warning' | 'success';
}

const toneByVariant: Record<NonNullable<PromotionRateCardProps['variant']>, string> = {
  default: 'border-muted/20',
  warning: 'border-amber-300/80',
  success: 'border-emerald-300/80',
};

function defaultIcon(variant: NonNullable<PromotionRateCardProps['variant']>) {
  if (variant === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (variant === 'success') return <Trophy className="h-4 w-4 text-emerald-500" />;
  return <ArrowUpRight className="h-4 w-4 text-muted" />;
}

export function PromotionRateCard({
  label,
  value,
  icon,
  variant = 'default',
}: PromotionRateCardProps) {
  return (
    <div
      className={`rounded-lg border bg-background p-4 ${toneByVariant[variant]}`}
      role="group"
      aria-label={`${label}: ${value}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs text-muted">{label}</div>
        {icon ?? defaultIcon(variant)}
      </div>
      <div className="text-h5">{value}</div>
    </div>
  );
}
