<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue';
import { CircleAlert, Database, RefreshCw } from '@lucide/vue';
import {
  getDaily, getNotFound, getPages, getProducts, getStatus, UnauthorizedError,
  type DailyStats, type NotFoundStats, type PageStats, type ProductStats, type Status
} from '../api';
import { useHashView, VIEWS } from '../navigation';
import ActivityBar from './ActivityBar.vue';
import DailyChart from './DailyChart.vue';
import TopProducts from './TopProducts.vue';
import TopPages from './TopPages.vue';
import NotFoundTable from './NotFoundTable.vue';
import InsightsView from './InsightsView.vue';

const emit = defineEmits<{ logout: [] }>();

const PERIODS = [7, 30, 90];
const days = ref(30);
const status = ref<Status | null>(null);
const daily = ref<DailyStats[]>([]);
const products = ref<ProductStats[]>([]);
const pages = ref<PageStats[]>([]);
const notFound = ref<NotFoundStats[]>([]);
const loading = ref(false);
const error = ref('');

const { view, navigate } = useHashView();
const current = computed(() => VIEWS.find(definition => definition.id === view.value) ?? VIEWS[0]);

watchEffect(() => { document.title = `${current.value.label} · AMW Admin`; });

const totals = computed(() => {
  const sum = (key: keyof Omit<DailyStats, 'date'>) => daily.value.reduce((total, day) => total + day[key], 0);
  const cache = sum('cache');
  const amazon = sum('amazon');
  const clicks = sum('clicks');
  const impressions = cache + amazon;
  return {
    hits: impressions + sum('notfound'),
    impressions,
    cacheRatio: impressions > 0 ? cache / impressions : 0,
    notFound: sum('notfound'),
    clicks,
    ctr: impressions > 0 ? clicks / impressions : 0
  };
});

const percent = (value: number) => `${(value * 100).toFixed(1)} %`;
const number = (value: number) => value.toLocaleString('en-US');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    status.value = status.value ?? await getStatus();
    if (!status.value.stats) return;
    [daily.value, products.value, pages.value, notFound.value] = await Promise.all([
      getDaily(days.value),
      getProducts(days.value),
      getPages(days.value),
      getNotFound()
    ]);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(days, load);
</script>

<template>
  <div class="workbench-shell">
    <ActivityBar :active="view" @select="navigate" @logout="emit('logout')" />

    <div class="workbench">
      <header class="titlebar">
        <div class="titlebar-title">
          <span class="brand">AMW</span>
          <span class="titlebar-separator" aria-hidden="true">/</span>
          <h1>{{ current.title }}</h1>
        </div>
        <div class="titlebar-actions">
          <div v-if="status?.stats" class="periods" role="group" aria-label="Period">
            <button
              v-for="period in PERIODS"
              :key="period"
              type="button"
              :class="{ active: days === period }"
              :aria-pressed="days === period"
              @click="days = period"
            >{{ period }} days</button>
          </div>
          <!-- Insights have their own Regenerate action, much slower than a refresh -->
          <button
            v-if="view !== 'insights'"
            type="button"
            class="icon-button"
            :class="{ spinning: loading }"
            aria-label="Refresh"
            title="Refresh"
            :disabled="loading"
            @click="load"
          >
            <RefreshCw class="icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      <main id="view-panel" class="content" role="tabpanel" :aria-labelledby="`tab-${view}`" tabindex="-1">
        <p v-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>

        <section v-if="status && !status.stats" class="card notice">
          <h2><Database class="icon" aria-hidden="true" /> {{ status.message || 'Statistics require Redis' }}</h2>
          <p class="muted">
            Usage statistics are stored in Redis. Enable it in the configuration
            (<code>Redis.enabled: true</code>) and restart the server to start collecting them.
          </p>
        </section>

        <template v-else-if="status">
          <template v-if="view === 'overview'">
            <section class="kpis" aria-label="Key figures">
              <div class="card kpi"><span class="kpi-label">Product requests</span><span class="kpi-value">{{ number(totals.hits) }}</span></div>
              <div class="card kpi"><span class="kpi-label">Served from cache</span><span class="kpi-value">{{ percent(totals.cacheRatio) }}</span></div>
              <div class="card kpi"><span class="kpi-label">Not found</span><span class="kpi-value">{{ number(totals.notFound) }}</span></div>
              <div class="card kpi"><span class="kpi-label">Clicks</span><span class="kpi-value">{{ number(totals.clicks) }}</span></div>
              <div class="card kpi"><span class="kpi-label">Click-through rate</span><span class="kpi-value">{{ percent(totals.ctr) }}</span></div>
            </section>
            <div class="charts">
              <section class="card">
                <h2>Hits per day</h2>
                <DailyChart :daily="daily" kind="hits" />
              </section>
              <section class="card">
                <h2>Clicks per day</h2>
                <DailyChart :daily="daily" kind="clicks" />
              </section>
            </div>
          </template>

          <section v-else-if="view === 'products'" class="card">
            <p class="muted">Products served to the widgets over the period, ranked by impressions.</p>
            <TopProducts :products="products" />
          </section>

          <section v-else-if="view === 'pages'" class="card">
            <p class="muted">Pages embedding the widget, ranked by clicks. Views are the product impressions served to the page.</p>
            <TopPages :pages="pages" />
          </section>

          <section v-else-if="view === 'notfound'" class="card">
            <p class="muted">Products Amazon no longer returns, with the pages where they are embedded.</p>
            <NotFoundTable :products="notFound" />
          </section>

          <!-- Kept alive so that going back to Insights does not ask the model again -->
          <KeepAlive>
            <InsightsView v-if="view === 'insights'" :days="days" @logout="emit('logout')" />
          </KeepAlive>
        </template>

        <p v-else-if="!error" class="muted">Loading…</p>
      </main>
    </div>
  </div>
</template>
