<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DailyStats } from '../api';
import { amazonUsage, estimateQuota, INITIAL_QUOTA } from '../quota';

const props = defineProps<{ daily: DailyStats[] }>();

const DOCS_URL = 'https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/api-rates';
// Business data: kept in this browser only, the estimate needs nothing from the server
const STORAGE_KEY = 'amw-admin-shipped-revenue';

function restore(): number | '' {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY) ?? NaN);
    return Number.isFinite(stored) && stored >= 0 ? stored : '';
  } catch {
    return '';
  }
}

const revenue = ref<number | ''>(restore());
const valid = computed(() => typeof revenue.value === 'number' && Number.isFinite(revenue.value) && revenue.value >= 0);
const quota = computed(() => (valid.value ? estimateQuota(revenue.value as number) : null));
const usage = computed(() => amazonUsage(props.daily));
const share = computed(() => (quota.value && quota.value.perDay > 0 ? usage.value.peak / quota.value.perDay : null));
const number = (value: number) => value.toLocaleString('en-US');

watch(revenue, value => {
  try {
    if (valid.value) localStorage.setItem(STORAGE_KEY, String(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A blocked storage only means typing the amount again next time
  }
});
</script>

<template>
  <p class="muted">
    Amazon grants its quota from the revenue of the items shipped through your links over the last 30 days:
    sales, not your commissions. The API itself has no price.
  </p>
  <label class="filter">
    Shipped revenue, last 30 days
    <input v-model.number="revenue" type="number" min="0" step="any" inputmode="decimal" placeholder="0" />
  </label>

  <section class="kpis" aria-label="Amazon quota">
    <div class="card kpi"><span class="kpi-label">Estimated quota per day</span><span class="kpi-value">{{ quota ? number(quota.perDay) : '—' }}</span></div>
    <div class="card kpi"><span class="kpi-label">Estimated quota per second</span><span class="kpi-value">{{ quota ? quota.perSecond : '—' }}</span></div>
    <div class="card kpi"><span class="kpi-label">Amazon lookups, daily average</span><span class="kpi-value">{{ number(usage.average) }}</span></div>
    <div class="card kpi"><span class="kpi-label">Amazon lookups, busiest day</span><span class="kpi-value">{{ number(usage.peak) }}</span></div>
  </section>

  <p v-if="share !== null && share > 1" class="error" role="status">
    The busiest day of the period is above this estimate: expect Amazon to throttle calls, or cache products longer.
  </p>
  <p v-else-if="share !== null" class="muted" role="status">The busiest day used about {{ Math.round(share * 100) }} % of this estimate.</p>
  <p v-else-if="valid" class="error" role="status">
    Without qualified sales for 30 days in a row, Amazon removes access to the API until new sales ship.
  </p>

  <p class="muted">
    An estimate, not your real allocation, which only Amazon knows. During the first 30 days after creating your credentials,
    the quota is {{ INITIAL_QUOTA.perSecond }} request per second and {{ number(INITIAL_QUOTA.perDay) }} per day whatever the revenue.
    The <a :href="DOCS_URL" target="_blank" rel="noopener noreferrer">Amazon rule</a> is written in dollars and names no currency.
  </p>
</template>
