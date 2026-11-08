<script setup lang="ts">
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import {
  BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip,
  type ChartData, type ChartOptions, type TooltipItem
} from 'chart.js';
import type { DailyStats } from '../api';
import { amazonCallsOf } from '../quota';
import { theme, themeColor } from '../theme';

// The 100 % reference is a line drawn over the bars
ChartJS.register(BarElement, CategoryScale, LinearScale, LineController, LineElement, PointElement, Legend, Tooltip);

/** @param perDay The estimated daily quota; without it, the chart shows the calls themselves. */
const props = defineProps<{ daily: DailyStats[]; perDay: number | null }>();

const colors = computed(() => {
  void theme.value;
  return {
    within: themeColor('--chart-amazon', '#3e8d4d'),
    over: themeColor('--chart-notfound', '#e74c3c'),
    limit: themeColor('--text', '#c9c9d4'),
    text: themeColor('--muted', '#9a9aa8'),
    grid: themeColor('--chart-grid', '#2e2e3a')
  };
});

const days = computed(() => props.daily.map(day => {
  const { calls, counted } = amazonCallsOf(day);
  const share = props.perDay ? (calls / props.perDay) * 100 : null;
  return { date: day.date, calls, counted, share, over: share !== null && share > 100 };
}));

const percent = (value: number) => `${value < 1 && value > 0 ? value.toFixed(1) : Math.round(value)} %`;

const data = computed<ChartData<'bar' | 'line'>>(() => {
  const labels = days.value.map(day => day.date.slice(5));
  if (props.perDay === null) {
    return {
      labels,
      datasets: [{ type: 'bar', label: 'Amazon calls', data: days.value.map(day => day.calls), backgroundColor: colors.value.within }]
    };
  }
  return {
    labels,
    datasets: [
      {
        type: 'bar',
        label: 'Share of the daily quota',
        data: days.value.map(day => day.share ?? 0),
        // A day over the quota stands out: Amazon throttled its calls
        backgroundColor: days.value.map(day => (day.over ? colors.value.over : colors.value.within))
      },
      {
        type: 'line',
        label: 'Quota (100 %)',
        data: days.value.map(() => 100),
        borderColor: colors.value.limit,
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        pointHitRadius: 0
      }
    ]
  };
});

const options = computed<ChartOptions<'bar' | 'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { labels: { color: colors.value.limit } },
    tooltip: {
      filter: (item: TooltipItem<'bar' | 'line'>) => item.datasetIndex === 0,
      callbacks: {
        label: (item: TooltipItem<'bar' | 'line'>) => {
          const day = days.value[item.dataIndex];
          const calls = `${day.calls.toLocaleString('en-US')} calls${day.counted ? '' : ' (estimated)'}`;
          return props.perDay === null ? calls : `${percent(day.share ?? 0)}: ${calls} of ${props.perDay.toLocaleString('en-US')}`;
        }
      }
    }
  },
  scales: {
    x: { ticks: { color: colors.value.text }, grid: { display: false } },
    y: {
      beginAtZero: true,
      // The reference line stays in view on quiet days
      suggestedMax: props.perDay === null ? undefined : 100,
      ticks: { color: colors.value.text, precision: 0, callback: value => (props.perDay === null ? value : `${value} %`) },
      grid: { color: colors.value.grid },
      border: { display: false }
    }
  }
}));
</script>

<template>
  <div class="chart" role="img" :aria-label="perDay === null ? 'Amazon calls per day' : 'Share of the daily Amazon quota used per day'">
    <Bar :data="data as ChartData<'bar'>" :options="options as ChartOptions<'bar'>" />
  </div>
  <details class="chart-figures">
    <summary>Figures per day</summary>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col" class="num">Amazon calls</th>
            <th v-if="perDay !== null" scope="col" class="num">Share of the quota</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="day in days" :key="day.date" :class="{ over: day.over }">
            <td>{{ day.date }}</td>
            <td class="num">{{ day.calls.toLocaleString('en-US') }}<span v-if="!day.counted" class="muted"> (estimated)</span></td>
            <td v-if="perDay !== null" class="num">{{ percent(day.share ?? 0) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </details>
</template>
