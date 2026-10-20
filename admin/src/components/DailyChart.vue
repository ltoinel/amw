<script setup lang="ts">
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import {
  BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip,
  type ChartData, type ChartOptions
} from 'chart.js';
import type { DailyStats } from '../api';

// Registering only what is used keeps the rest of Chart.js out of the bundle
ChartJS.register(BarElement, CategoryScale, LinearScale, Legend, Tooltip);

const props = defineProps<{ daily: DailyStats[]; kind: 'hits' | 'clicks' }>();

const data = computed<ChartData<'bar'>>(() => {
  const labels = props.daily.map(day => day.date.slice(5));
  if (props.kind === 'clicks') {
    return {
      labels,
      datasets: [{ label: 'Clicks', data: props.daily.map(day => day.clicks), backgroundColor: '#f5b400' }]
    };
  }
  return {
    labels,
    datasets: [
      { label: 'Cache', data: props.daily.map(day => day.cache), backgroundColor: '#8b5cf6' },
      { label: 'Amazon', data: props.daily.map(day => day.amazon), backgroundColor: '#3e8d4d' },
      { label: 'Not found', data: props.daily.map(day => day.notfound), backgroundColor: '#e74c3c' }
    ]
  };
});

const options: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { labels: { color: '#c9c9d4' } } },
  scales: {
    x: { stacked: true, ticks: { color: '#9a9aa8' }, grid: { display: false } },
    y: { stacked: true, beginAtZero: true, ticks: { color: '#9a9aa8', precision: 0 }, grid: { color: '#2e2e3a' } }
  }
};
</script>

<template>
  <div class="chart">
    <Bar :data="data" :options="options" />
  </div>
</template>
