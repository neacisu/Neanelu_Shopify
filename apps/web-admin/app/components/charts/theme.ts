export const chartColors = {
  blue: '#2563eb',
  green: '#16a34a',
  red: '#dc2626',
  amber: '#f59e0b',
  violet: '#7c3aed',
  gray: '#64748b',
} as const;

export type ChartColor = keyof typeof chartColors;
