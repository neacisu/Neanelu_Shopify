import { useEffect, useState } from 'react';

/** Culori pentru grafice – paletă coerentă light/dark */
export const chartColors = {
  blue: 'rgb(var(--chart-1))',
  green: 'rgb(var(--chart-5))',
  red: 'rgb(var(--color-error))',
  amber: 'rgb(var(--color-warning))',
  violet: 'rgb(var(--chart-4))',
  gray: 'rgb(var(--color-muted))',
} as const;

export type ChartColor = keyof typeof chartColors;

/** Paletă pentru grafice – light mode (contrast ridicat pe fundal deschis) */
export const chartPaletteLight = [
  'rgb(var(--chart-1))',
  'rgb(var(--chart-2))',
  'rgb(var(--chart-3))',
  'rgb(var(--chart-4))',
  'rgb(var(--chart-5))',
  'rgb(var(--chart-6))',
] as const;

/** Paletă pentru grafice – dark mode (tonuri mai deschise pentru vizibilitate) */
export const chartPaletteDark = [
  'rgb(var(--chart-1))',
  'rgb(var(--chart-2))',
  'rgb(var(--chart-3))',
  'rgb(var(--chart-4))',
  'rgb(var(--chart-5))',
  'rgb(var(--chart-6))',
] as const;

/** Culori pentru text/etichete – light mode */
export const chartTextLight = {
  fill: 'rgb(var(--color-muted))',
  axis: 'rgb(var(--color-muted))',
  legend: 'rgb(var(--color-foreground))',
} as const;

/** Culori pentru text/etichete – dark mode */
export const chartTextDark = {
  fill: 'rgb(var(--color-muted))',
  axis: 'rgb(var(--color-muted))',
  legend: 'rgb(var(--color-foreground))',
} as const;

/** Culori pentru grid/linii auxiliare */
export const chartGridLight = 'rgb(var(--color-border))';
export const chartGridDark = 'rgb(var(--color-border))';

/** Culori semantice pentru elemente de chart (gauge, badges, etc.) */
export const chartSemanticColors = {
  light: {
    success: 'rgb(var(--color-success))',
    warning: 'rgb(var(--color-warning))',
    danger: 'rgb(var(--color-error))',
    info: 'rgb(var(--color-info))',
    track: 'rgb(var(--color-border))',
    needle: 'rgb(var(--color-muted))',
    centerDot: 'rgb(var(--color-card))',
    centerDotStroke: 'rgb(var(--color-border))',
    tooltipBg: 'rgb(var(--color-card))',
    tooltipBorder: 'rgb(var(--color-border))',
    tooltipText: 'rgb(var(--color-foreground))',
  },
  dark: {
    success: 'rgb(var(--color-success))',
    warning: 'rgb(var(--color-warning))',
    danger: 'rgb(var(--color-error))',
    info: 'rgb(var(--color-info))',
    track: 'rgb(var(--color-border))',
    needle: 'rgb(var(--color-muted))',
    centerDot: 'rgb(var(--color-card))',
    centerDotStroke: 'rgb(var(--color-border))',
    tooltipBg: 'rgb(var(--color-card))',
    tooltipBorder: 'rgb(var(--color-border))',
    tooltipText: 'rgb(var(--color-foreground))',
  },
} as const;

function readCssColor(variableName: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value ? `rgb(${value})` : fallback;
}

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
    palette: [
      readCssColor('--chart-1', chartPaletteLight[0]),
      readCssColor('--chart-2', chartPaletteLight[1]),
      readCssColor('--chart-3', chartPaletteLight[2]),
      readCssColor('--chart-4', chartPaletteLight[3]),
      readCssColor('--chart-5', chartPaletteLight[4]),
      readCssColor('--chart-6', chartPaletteLight[5]),
    ],
    text: {
      fill: readCssColor('--color-muted', chartTextLight.fill),
      axis: readCssColor('--color-muted', chartTextLight.axis),
      legend: readCssColor('--color-foreground', chartTextLight.legend),
    },
    grid: readCssColor('--color-border', isDark ? chartGridDark : chartGridLight),
    semantic: {
      success: readCssColor('--color-success', chartSemanticColors.light.success),
      warning: readCssColor('--color-warning', chartSemanticColors.light.warning),
      danger: readCssColor('--color-error', chartSemanticColors.light.danger),
      info: readCssColor('--color-info', chartSemanticColors.light.info),
      track: readCssColor('--color-border', chartSemanticColors.light.track),
      needle: readCssColor('--color-muted', chartSemanticColors.light.needle),
      centerDot: readCssColor('--color-card', chartSemanticColors.light.centerDot),
      centerDotStroke: readCssColor('--color-border', chartSemanticColors.light.centerDotStroke),
      tooltipBg: readCssColor('--color-card', chartSemanticColors.light.tooltipBg),
      tooltipBorder: readCssColor('--color-border', chartSemanticColors.light.tooltipBorder),
      tooltipText: readCssColor('--color-foreground', chartSemanticColors.light.tooltipText),
    },
    background: readCssColor(
      '--color-card',
      isDark ? 'rgb(var(--color-card))' : 'rgb(var(--color-card))'
    ),
  };
}
