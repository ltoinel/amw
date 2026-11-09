<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDownRight, ArrowUpRight, Minus } from '@lucide/vue';

/**
 * A key figure with its trend over the period and its change against the previous period of the
 * same length.
 * @param kind count: the change is relative (+12 %); rate: in percentage points (+0.4 pt)
 * @param better The direction that is good news: more products not found is bad news
 */
const props = withDefaults(defineProps<{
  label: string;
  value: number;
  previous?: number | null;
  series?: number[];
  kind?: 'count' | 'rate';
  better?: 'up' | 'down';
}>(), { previous: null, series: () => [], kind: 'count', better: 'up' });

const display = computed(() => (props.kind === 'rate' ? `${(props.value * 100).toFixed(1)} %` : props.value.toLocaleString('en-US')));

const change = computed(() => {
  if (props.previous === null) return null;
  if (props.kind === 'rate') return (props.value - props.previous) * 100;
  // From nothing, any figure is new rather than infinitely up
  return props.previous > 0 ? ((props.value - props.previous) / props.previous) * 100 : null;
});
const direction = computed(() => {
  const value = change.value;
  if (value === null || Math.abs(value) < 0.05) return 'flat';
  return value > 0 ? 'up' : 'down';
});
const tone = computed(() => (direction.value === 'flat' ? 'flat' : direction.value === props.better ? 'good' : 'bad'));
const changeText = computed(() => {
  const value = change.value;
  if (value === null) return '';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return props.kind === 'rate' ? `${sign}${Math.abs(value).toFixed(1)} pt` : `${sign}${Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)} %`;
});

// A polyline in a 100 × 28 box; the area under it fades to the bottom
const points = computed(() => {
  const values = props.series;
  if (values.length < 2) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return values.map((value, index) => `${((index / (values.length - 1)) * 100).toFixed(2)},${(26 - ((value - min) / span) * 24).toFixed(2)}`).join(' ');
});
const gradientId = `kpi-${Math.random().toString(36).slice(2, 9)}`;
</script>

<template>
  <div class="card kpi">
    <span class="kpi-label">{{ label }}</span>
    <span class="kpi-value">{{ display }}</span>
    <span class="kpi-foot">
      <span v-if="change !== null" :class="['kpi-change', tone]" :title="`Against the previous period of the same length`">
        <ArrowUpRight v-if="direction === 'up'" class="icon" aria-hidden="true" />
        <ArrowDownRight v-else-if="direction === 'down'" class="icon" aria-hidden="true" />
        <Minus v-else class="icon" aria-hidden="true" />
        {{ changeText }}<span class="visually-hidden"> against the previous period</span>
      </span>
      <svg v-if="points" class="kpi-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="currentColor" stop-opacity="0.22" />
            <stop offset="1" stop-color="currentColor" stop-opacity="0" />
          </linearGradient>
        </defs>
        <polygon :points="`0,28 ${points} 100,28`" :fill="`url(#${gradientId})`" />
        <polyline :points="points" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
      </svg>
    </span>
  </div>
</template>
