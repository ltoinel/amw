<script setup lang="ts">
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import {
  CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Tooltip,
  type ChartData, type ChartOptions
} from 'chart.js';
import type { VariantStats } from '../effects';
import { theme, themeColor } from '../theme';
import { baseOptions, chartColors, crosshair, shortDate } from '../chartStyle';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Legend, Tooltip);

/**
 * The daily click-through rate of each group of an A/B test: a gap that holds day after day is
 * worth more than one made by the first days, when the new look draws clicks by being new.
 */
const props = defineProps<{ rows: VariantStats[]; label: string }>();

const FALLBACKS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

// Read from the theme, like the other charts: the canvas cannot use CSS variables
const colors = computed(() => {
  void theme.value;
  return { ...chartColors(), series: FALLBACKS.map((fallback, i) => themeColor(`--chart-series-${i + 1}`, fallback)) };
});

const dated = computed(() => props.rows.filter(row => row.daily && row.daily.length > 0));
// One day is a point, not a trend
const shown = computed(() => (dated.value[0]?.daily?.length ?? 0) > 1 && dated.value.some(row => row.daily!.some(day => day.ctr !== null)));

const data = computed<ChartData<'line', (number | null)[]>>(() => ({
  labels: dated.value[0]?.daily?.map(day => day.date) ?? [],
  datasets: dated.value.map((row, i) => {
    const color = colors.value.series[i % colors.value.series.length];
    return {
      label: row.name,
      // Days without impressions stay gaps: a 0 % there would read as a drop
      data: row.daily!.map(day => (day.ctr === null ? null : Math.round(day.ctr * 1000) / 10)),
      borderColor: color,
      backgroundColor: color,
      // Past five groups the colours come back: dashes keep the lines apart
      borderDash: i >= colors.value.series.length ? [6, 4] : [],
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHitRadius: 8,
      spanGaps: false,
      tension: 0.3
    };
  })
}));

const options = computed<ChartOptions<'line'>>(() => {
  const base = baseOptions(colors.value, true);
  return {
    ...base,
    plugins: {
      ...base.plugins,
      tooltip: {
        ...base.plugins.tooltip,
        callbacks: {
          title: items => shortDate(String(items[0]?.label ?? '')),
          label: item => {
            const day = dated.value[item.datasetIndex]?.daily?.[item.dataIndex];
            const rate = item.parsed.y === null ? '—' : `${item.parsed.y.toFixed(1)} %`;
            return ` ${item.dataset.label}: ${rate}${day ? ` (${day.clicks.toLocaleString('en-US')} / ${day.views.toLocaleString('en-US')} impressions)` : ''}`;
          }
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
  <div v-if="shown" class="variant-trend">
    <h3>Daily click-through rate per {{ label.toLowerCase() }}</h3>
    <p class="muted hint">
      A gap that holds over the days is worth more than one made in the first days only. A day with few impressions
      swings widely: read the trend, not one day.
    </p>
    <div class="chart">
      <Line :data="data" :options="options" :plugins="[crosshair]" role="img" :aria-label="`Daily click-through rate of each ${label.toLowerCase()} of the test`" />
    </div>
  </div>
</template>
