<script setup lang="ts">
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import {
  BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip,
  type ChartData, type ChartOptions
} from 'chart.js';
import type { DailyStats } from '../api';
import { theme, themeColor } from '../theme';

// Registering only what is used keeps the rest of Chart.js out of the bundle
ChartJS.register(BarElement, CategoryScale, LinearScale, Legend, Tooltip);

const props = defineProps<{ daily: DailyStats[]; kind: 'hits' | 'clicks' }>();

// The canvas cannot use CSS variables: the colors are read from the current
// theme, and reading `theme` makes the chart re-render when it changes
const colors = computed(() => {
  void theme.value;
  return {
    cache: themeColor('--chart-cache', '#8b5cf6'),
    amazon: themeColor('--chart-amazon', '#3e8d4d'),
    notfound: themeColor('--chart-notfound', '#e74c3c'),
    clicks: themeColor('--chart-clicks', '#f5b400'),
    text: themeColor('--muted', '#9a9aa8'),
    legend: themeColor('--text', '#c9c9d4'),
    grid: themeColor('--chart-grid', '#2e2e3a')
  };
});

const data = computed<ChartData<'bar'>>(() => {
  const labels = props.daily.map(day => day.date.slice(5));
  if (props.kind === 'clicks') {
    return {
      labels,
      datasets: [{ label: 'Clicks', data: props.daily.map(day => day.clicks), backgroundColor: colors.value.clicks }]
    };
  }
  return {
    labels,
    datasets: [
      { label: 'Cache', data: props.daily.map(day => day.cache), backgroundColor: colors.value.cache },
      { label: 'Amazon', data: props.daily.map(day => day.amazon), backgroundColor: colors.value.amazon },
      { label: 'Not found', data: props.daily.map(day => day.notfound), backgroundColor: colors.value.notfound }
    ]
  };
});

const options = computed<ChartOptions<'bar'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: colors.value.legend } } },
  scales: {
    x: { stacked: true, ticks: { color: colors.value.text }, grid: { display: false } },
    y: {
      stacked: true,
      beginAtZero: true,
      ticks: { color: colors.value.text, precision: 0 },
      grid: { color: colors.value.grid },
      border: { display: false }
    }
  }
}));
</script>

<template>
  <div class="chart">
    <Bar :data="data" :options="options" />
  </div>
</template>
