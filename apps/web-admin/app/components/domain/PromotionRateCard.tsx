import type { ReactNode } from 'react';
import { ArrowUpRight, AlertTriangle, Trophy } from 'lucide-react';
import { InfoTooltip } from '../ui/info-tooltip';

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

const tooltipByLabel: Record<string, string> = {
  'La silver (24h)': 'Produse promovate la Silver în ultimele 24 de ore.',
  'La golden (24h)': 'Produse promovate la Golden Record în ultimele 24 de ore.',
  'La silver (7 zile)': 'Produse promovate la Silver în ultimele 7 zile.',
  'La golden (7 zile)': 'Produse promovate la Golden Record în ultimele 7 zile.',
  'Necesita review': 'Produse care necesită revizuire manuală înainte de promovare.',
};

export function PromotionRateCard({
  label,
  value,
  icon,
  variant = 'default',
}: PromotionRateCardProps) {
  const tooltip = tooltipByLabel[label] ?? `Metrică: ${label}`;
  return (
    <div
      className={`rounded-lg border bg-background p-4 transition-colors hover:border-muted/40 ${toneByVariant[variant]}`}
      role="group"
      aria-label={`${label}: ${value}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span>{label}</span>
          <InfoTooltip title={label}>{tooltip}</InfoTooltip>
        </div>
        {icon ?? defaultIcon(variant)}
      </div>
      <div className="text-h5">{value}</div>
    </div>
  );
}
