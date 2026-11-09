<script setup lang="ts">
import { computed } from 'vue';
import { ctrLevel, MIN_VIEWS } from '../ctr';

/** @param average The click-through rate of the site over the period. */
const props = defineProps<{ ctr: number; impressions: number; average: number }>();

const level = computed(() => ctrLevel(props.ctr, props.impressions, props.average));
const percent = (value: number) => `${(value * 100).toFixed(1)} %`;
const meaning = computed(() => {
  switch (level.value) {
    case 'few': return `fewer than ${MIN_VIEWS} views, too few to judge`;
    case 'good': return `well above the site's ${percent(props.average)}`;
    case 'low': return `well below the site's ${percent(props.average)}`;
    default: return `close to the site's ${percent(props.average)}`;
  }
});
</script>

<template>
  <span :class="['ctr-badge', level]" :title="`${percent(ctr)}: ${meaning}`">
    {{ percent(ctr) }}<span class="visually-hidden">, {{ meaning }}</span>
  </span>
</template>
