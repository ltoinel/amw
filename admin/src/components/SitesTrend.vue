<script setup lang="ts">
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import {
  CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip,
  type ChartData, type ChartOptions, type ScriptableContext
} from 'chart.js';
import CtrBadge from './CtrBadge.vue';
import { averageCtr } from '../ctr';
import type { DomainTrend } from '../api';
import { theme, themeColor } from '../theme';
import { baseOptions, chartColors, crosshair, shortDate } from '../chartStyle';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Legend, Tooltip);

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
    ...chartColors(),
    series: FALLBACKS.map((fallback, i) => themeColor(`--chart-series-${i + 1}`, fallback))
  };
});

const colorOf = (domain: string) => colors.value.series[slotOf.value.get(domain) ?? 0];

/** A single line gets an area fading to the axis; overlapping areas would hide each other. */
function areaUnder(color: string) {
  return (context: ScriptableContext<'line'>) => {
    const { ctx, chartArea } = context.chart;
    if (!chartArea) return 'transparent';
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, `${color}38`);
    gradient.addColorStop(1, `${color}00`);
    return gradient;
  };
}

const data = computed<ChartData<'line', (number | null)[]>>(() => {
  const single = Math.min(props.trends.length, SLOTS) === 1;
  return {
  labels: props.trends[0]?.daily.map(day => day.date) ?? [],
  datasets: props.trends.slice(0, SLOTS).map(site => ({
    label: site.domain,
    // Days without views stay gaps: a 0 % CTR there would read as a drop
    data: site.daily.map(day => (day.ctr === null ? null : Math.round(day.ctr * 1000) / 10)),
    borderColor: colorOf(site.domain),
    backgroundColor: single ? areaUnder(colorOf(site.domain)) : colorOf(site.domain),
    fill: single ? 'origin' : false,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBorderWidth: 2,
    pointHoverBorderColor: colors.value.surface,
    pointHoverBackgroundColor: colorOf(site.domain),
    pointHitRadius: 8,
    tension: 0.35
  }))
  };
});

const options = computed<ChartOptions<'line'>>(() => {
  const base = baseOptions(colors.value, props.trends.length > 1);
  return {
    ...base,
    plugins: {
      ...base.plugins,
      tooltip: {
        ...base.plugins.tooltip,
        callbacks: {
          title: items => shortDate(String(items[0]?.label ?? '')),
          label: item => ` ${item.dataset.label}: ${item.parsed.y === null ? '—' : `${item.parsed.y.toFixed(1)} %`}`
        }
      }
    },
    scales: {
      x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, callback(value) { return shortDate(String(this.getLabelForValue(Number(value)))); } } },
      y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: value => `${value} %` } }
    }
  } as ChartOptions<'line'>;
});
</script>

<template>
  <p v-if="trends.length === 0" class="muted">No view over this period.</p>
  <div v-else class="sites">
    <div class="chart">
      <Line :data="data" :options="options" :plugins="[crosshair]" aria-label="Daily click-through rate of the most viewed sites" role="img" />
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
