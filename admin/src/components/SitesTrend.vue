<script setup lang="ts">
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import {
  CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Tooltip,
  type ChartData, type ChartOptions
} from 'chart.js';
import CtrBadge from './CtrBadge.vue';
import { averageCtr } from '../ctr';
import type { DomainTrend } from '../api';
import { theme, themeColor } from '../theme';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Legend, Tooltip);

const props = defineProps<{ trends: DomainTrend[]; average?: number }>();
// The click-through rate of the site over the period, the same reference in every table; the
// whole table's when the table is shown alone
const tableCtr = computed(() => props.average ?? averageCtr(props.trends));

const SLOTS = 5;
const FALLBACKS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

// A site keeps its colour when the period changes and the ranking moves: slots
// are only given to new sites, from those left free
const slots = new Map<string, number>();
const slotOf = computed(() => {
  const domains = props.trends.slice(0, SLOTS).map(site => site.domain);
  for (const domain of [...slots.keys()]) {
    if (!domains.includes(domain)) slots.delete(domain);
  }
  for (const domain of domains) {
    if (slots.has(domain)) continue;
    const used = new Set(slots.values());
    slots.set(domain, [...Array(SLOTS).keys()].find(slot => !used.has(slot)) ?? 0);
  }
  return new Map(slots);
});

// Read from the theme, like DailyChart: the canvas cannot use CSS variables
const colors = computed(() => {
  void theme.value;
  return {
    series: FALLBACKS.map((fallback, i) => themeColor(`--chart-series-${i + 1}`, fallback)),
    text: themeColor('--muted', '#9a9aa8'),
    legend: themeColor('--text', '#c9c9d4'),
    grid: themeColor('--chart-grid', '#2e2e3a')
  };
});

const colorOf = (domain: string) => colors.value.series[slotOf.value.get(domain) ?? 0];

const data = computed<ChartData<'line', (number | null)[]>>(() => ({
  labels: props.trends[0]?.daily.map(day => day.date.slice(5)) ?? [],
  datasets: props.trends.slice(0, SLOTS).map(site => ({
    label: site.domain,
    // Days without views stay gaps: a 0 % CTR there would read as a drop
    data: site.daily.map(day => (day.ctr === null ? null : Math.round(day.ctr * 1000) / 10)),
    borderColor: colorOf(site.domain),
    backgroundColor: colorOf(site.domain),
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHitRadius: 8,
    tension: 0.25
  }))
}));

const options = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { labels: { color: colors.value.legend, usePointStyle: true, boxHeight: 8 } },
    tooltip: { callbacks: { label: item => `${item.dataset.label}: ${item.parsed.y === null ? '—' : `${item.parsed.y.toFixed(1)} %`}` } }
  },
  scales: {
    x: { ticks: { color: colors.value.text }, grid: { display: false } },
    y: {
      beginAtZero: true,
      ticks: { color: colors.value.text, callback: value => `${value} %` },
      grid: { color: colors.value.grid },
      border: { display: false }
    }
  }
}));
</script>

<template>
  <p v-if="trends.length === 0" class="muted">No view over this period.</p>
  <div v-else class="sites">
    <div class="chart">
      <Line :data="data" :options="options" aria-label="Daily click-through rate of the most viewed sites" role="img" />
    </div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col" class="num">Views</th>
            <th scope="col" class="num">Clicks</th>
            <th scope="col" class="num">CTR</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="site in trends" :key="site.domain">
            <td><span class="swatch" :style="{ background: colorOf(site.domain) }" aria-hidden="true" />{{ site.domain }}</td>
            <td class="num">{{ site.impressions.toLocaleString('en-US') }}</td>
            <td class="num">{{ site.clicks.toLocaleString('en-US') }}</td>
            <td class="num"><CtrBadge :ctr="site.ctr" :impressions="site.impressions" :average="tableCtr" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
