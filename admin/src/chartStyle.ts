import type { Chart, ChartOptions, Plugin, TooltipOptions } from 'chart.js';
import { themeColor } from './theme';

/** The colors every chart reads from the theme: the canvas cannot use CSS variables. */
export function chartColors() {
  return {
    text: themeColor('--muted', '#9a9aa8'),
    ink: themeColor('--text', '#16161d'),
    grid: themeColor('--chart-grid', '#e6e6ec'),
    surface: themeColor('--surface', '#ffffff'),
    tooltipBg: themeColor('--tooltip-bg', '#16161d'),
    tooltipText: themeColor('--tooltip-text', '#ffffff'),
  };
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** "2026-11-03" → "Nov 3": dates read without rotating the axis. */
export function shortDate(date: string): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(time) ? date : DAY_FORMAT.format(time);
}

/** 1234 → "1.2K": the axis needs the order of magnitude, the tooltip gives the exact figure. */
export function compact(value: number): string {
  return COMPACT.format(value);
}

/**
 * A thin vertical line at the hovered day, so that the eye finds every series of that day.
 * Drawn under the tooltip, over the plot.
 */
export const crosshair: Plugin = {
  id: 'amwCrosshair',
  afterDatasetsDraw(chart: Chart) {
    const active = chart.tooltip?.getActiveElements() ?? [];
    if (active.length === 0) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = chartColors().text;
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.restore();
  },
};

/** The axes, tooltip and legend shared by the charts of the portal. */
export function baseOptions(colors: ReturnType<typeof chartColors>, legend: boolean) {
  const tooltip: Partial<TooltipOptions<'bar' | 'line'>> = {
    backgroundColor: colors.tooltipBg,
    titleColor: colors.tooltipText,
    bodyColor: colors.tooltipText,
    footerColor: colors.tooltipText,
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    usePointStyle: true,
    titleFont: { weight: 600 },
    footerFont: { weight: 600 },
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    // Still charts: the figures change with the period, not to catch the eye
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      // A single series needs no legend: the title of the card names it
      legend: legend
        ? { position: 'top', align: 'start', labels: { color: colors.ink, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14 } }
        : { display: false },
      tooltip,
    },
    scales: {
      x: {
        ticks: { color: colors.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        grid: { display: false },
        border: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { color: colors.text, maxTicksLimit: 5, padding: 6 },
        grid: { color: colors.grid, drawTicks: false },
        border: { display: false },
      },
    },
  } satisfies ChartOptions<'bar' | 'line'>;
}
