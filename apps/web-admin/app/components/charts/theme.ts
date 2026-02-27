import { useEffect, useState } from 'react';

/** Culori pentru grafice – paletă coerentă light/dark */
export const chartColors = {
  blue: '#2563eb',
  green: '#16a34a',
  red: '#dc2626',
  amber: '#f59e0b',
  violet: '#7c3aed',
  gray: '#64748b',
} as const;

export type ChartColor = keyof typeof chartColors;

/** Paletă pentru grafice – light mode (contrast ridicat pe fundal deschis) */
export const chartPaletteLight = [
  chartColors.blue,
  chartColors.green,
  chartColors.amber,
  chartColors.violet,
  chartColors.red,
  chartColors.gray,
] as const;

/** Paletă pentru grafice – dark mode (tonuri mai deschise pentru vizibilitate) */
export const chartPaletteDark = [
  '#60a5fa', // blue-400
  '#4ade80', // green-400
  '#fbbf24', // amber-400
  '#a78bfa', // violet-400
  '#f87171', // red-400
  '#94a3b8', // slate-400
] as const;

/** Culori pentru text/etichete – light mode */
export const chartTextLight = {
  fill: '#475569',
  axis: '#64748b',
  legend: '#334155',
} as const;

/** Culori pentru text/etichete – dark mode */
export const chartTextDark = {
  fill: '#94a3b8',
  axis: '#94a3b8',
  legend: '#e2e8f0',
} as const;

/** Culori pentru grid/linii auxiliare */
export const chartGridLight = '#e2e8f0';
export const chartGridDark = '#334155';

/** Culori semantice pentru elemente de chart (gauge, badges, etc.) */
export const chartSemanticColors = {
  light: {
    success: '#16a34a',
    warning: '#f59e0b',
    danger: '#dc2626',
    info: '#2563eb',
    track: '#e2e8f0',
    needle: '#475569',
    centerDot: '#ffffff',
    centerDotStroke: '#94a3b8',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e2e8f0',
    tooltipText: '#334155',
  },
  dark: {
    success: '#4ade80',
    warning: '#fbbf24',
    danger: '#f87171',
    info: '#60a5fa',
    track: '#334155',
    needle: '#94a3b8',
    centerDot: '#1e293b',
    centerDotStroke: '#64748b',
    tooltipBg: '#1e293b',
    tooltipBorder: '#475569',
    tooltipText: '#e2e8f0',
  },
} as const;

function detectDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.classList.contains('dark')) return true;
  if (
    !document.documentElement.classList.contains('light') &&
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return true;
  }
  return false;
}

/**
 * Hook: detectează automat dark mode și returnează paleta, textul și gridul corespunzător.
 * Reacționează la schimbări de clasă pe <html> și la prefers-color-scheme.
 */
export function useChartTheme() {
  const [isDark, setIsDark] = useState(detectDarkMode);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const update = () => setIsDark(detectDarkMode());

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);

    return () => {
      observer.disconnect();
      mq.removeEventListener('change', update);
    };
  }, []);

  return {
    isDark,
    palette: isDark ? chartPaletteDark : chartPaletteLight,
    text: isDark ? chartTextDark : chartTextLight,
    grid: isDark ? chartGridDark : chartGridLight,
    semantic: isDark ? chartSemanticColors.dark : chartSemanticColors.light,
    background: isDark ? '#0f172a' : '#ffffff',
  };
}
