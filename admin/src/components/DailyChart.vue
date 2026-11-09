<script setup lang="ts">
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import {
  BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip,
  type ChartData, type ChartOptions
} from 'chart.js';
import type { DailyStats } from '../api';
import { theme, themeColor } from '../theme';
import { baseOptions, chartColors, compact, crosshair, shortDate } from '../chartStyle';

// Registering only what is used keeps the rest of Chart.js out of the bundle
ChartJS.register(BarElement, CategoryScale, LinearScale, Legend, Tooltip);

const props = defineProps<{ daily: DailyStats[]; kind: 'hits' | 'clicks' }>();

// The canvas cannot use CSS variables: the colors are read from the current
// theme, and reading `theme` makes the chart re-render when it changes
const colors = computed(() => {
  void theme.value;
  return {
    ...chartColors(),
    cache: themeColor('--chart-cache', '#6d28d9'),
    amazon: themeColor('--chart-amazon', '#0e9f8a'),
    notfound: themeColor('--chart-notfound', '#e8590c'),
    clicks: themeColor('--chart-clicks', '#c77d00')
  };
});

// Thin bars, rounded at their data end only; a 2px line of the surface between stacked segments
const BAR = { categoryPercentage: 0.72, barPercentage: 0.9, maxBarThickness: 28 } as const;

const data = computed<ChartData<'bar'>>(() => {
  const labels = props.daily.map(day => day.date);
  if (props.kind === 'clicks') {
    return {
      labels,
      datasets: [{ ...BAR, label: 'Clicks', data: props.daily.map(day => day.clicks), backgroundColor: colors.value.clicks, borderRadius: 4 }]
    };
  }
  const segments: [string, string, number[]][] = [
    ['Cache', colors.value.cache, props.daily.map(day => day.cache)],
    ['Amazon', colors.value.amazon, props.daily.map(day => day.amazon)],
    ['Not found', colors.value.notfound, props.daily.map(day => day.notfound)]
  ];
  return {
    labels,
    datasets: segments.map(([label, color, values], index) => ({
      ...BAR,
      label,
      data: values,
      backgroundColor: color,
      borderColor: colors.value.surface,
      // The segment above another starts with a gap; only the top of the stack is rounded
      borderWidth: index === 0 ? 0 : { bottom: 2, top: 0, left: 0, right: 0 },
      borderSkipped: false,
      borderRadius: index === segments.length - 1 ? { topLeft: 4, topRight: 4 } : 0
    }))
  };
});

const options = computed<ChartOptions<'bar'>>(() => {
  const base = baseOptions(colors.value, props.kind === 'hits');
  return {
    ...base,
    plugins: {
      ...base.plugins,
      tooltip: {
        ...base.plugins.tooltip,
        callbacks: {
          title: items => shortDate(String(items[0]?.label ?? '')),
          label: item => ` ${item.dataset.label}: ${Number(item.parsed.y).toLocaleString('en-US')}`,
          // Stacked bars: the whole of the day, which no segment shows alone
          footer: items => (items.length > 1 ? `Total: ${items.reduce((sum, item) => sum + Number(item.parsed.y), 0).toLocaleString('en-US')}` : '')
        }
      }
    },
    scales: {
      x: { ...base.scales.x, stacked: true, ticks: { ...base.scales.x.ticks, callback(value) { return shortDate(String(this.getLabelForValue(Number(value)))); } } },
      y: { ...base.scales.y, stacked: true, ticks: { ...base.scales.y.ticks, precision: 0, callback: value => compact(Number(value)) } }
    }
  } as ChartOptions<'bar'>;
});
</script>

<template>
  <div class="chart">
    <!-- A chart has no text of its own: the label names it, the table of the period gives its figures -->
    <Bar
      :data="data"
      :options="options"
      :plugins="[crosshair]"
      role="img"
      :aria-label="kind === 'clicks' ? 'Clicks per day' : 'Product requests per day, from the cache, from Amazon and not found'"
    />
  </div>
</template>
