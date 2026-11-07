<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue';
import { CircleAlert, Database, Download, RefreshCw } from '@lucide/vue';
import {
  getDaily, getDomainTrends, getProductCount, getDomains, getEffects, getLlmUsage, getNotFound, getPages, getProducts, getStatus, UnauthorizedError,
  type DailyStats, type DomainStats, type DomainTrend, type EffectStats, type LlmUsage, type NotFoundStats, type PageSort, type PageStats, type ProductStats, type Status
} from '../api';
import { useHashView, VIEWS } from '../navigation';
import { downloadCsv, toCsv } from '../tables';
import ActivityBar from './ActivityBar.vue';
import AmazonQuota from './AmazonQuota.vue';
import DailyChart from './DailyChart.vue';
import TopProducts from './TopProducts.vue';
import TopPages from './TopPages.vue';
import NotFoundTable from './NotFoundTable.vue';
import SitesTrend from './SitesTrend.vue';
import InsightsView from './InsightsView.vue';
import KeywordsView from './KeywordsView.vue';
import LlmCosts from './LlmCosts.vue';
import EffectComparison from './EffectComparison.vue';
import SettingsView from './SettingsView.vue';

const emit = defineEmits<{ logout: [] }>();

const PERIODS = [7, 30, 90];
const days = ref(30);
const status = ref<Status | null>(null);
const daily = ref<DailyStats[]>([]);
const products = ref<ProductStats[]>([]);
const productCount = ref(0);
const pages = ref<PageStats[]>([]);
const pageSort = ref<PageSort>('clicks');
const pageDomain = ref('');
const domains = ref<DomainStats[]>([]);
const siteTrends = ref<DomainTrend[]>([]);
const notFound = ref<NotFoundStats[]>([]);
const llmUsage = ref<LlmUsage[]>([]);
const effects = ref<EffectStats[]>([]);
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
  const impressions = sum('views');
  const served = cache + amazon;
  return {
    hits: served + sum('notfound'),
    impressions,
    cacheRatio: served > 0 ? cache / served : 0,
    notFound: sum('notfound'),
    clicks,
    ctr: impressions > 0 ? clicks / impressions : 0
  };
});

const REPOSITORY = 'https://github.com/ltoinel/amw';
const year = new Date().getFullYear();
const version = computed(() => status.value?.version);
const releaseUrl = computed(() => `${REPOSITORY}/releases/tag/v${version.value?.release}`);
// Commit and date of the Docker build, absent for other installs
const build = computed(() => {
  const { revision, buildDate } = version.value ?? {};
  const parts = [revision?.slice(0, 7), buildDate ? new Date(buildDate).toLocaleDateString() : undefined].filter(Boolean);
  return parts.join(', ');
});

const percent = (value: number) => `${(value * 100).toFixed(1)} %`;
const number = (value: number) => value.toLocaleString('en-US');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    status.value = status.value ?? await getStatus();
    if (!status.value.stats) return;
    let count: { count?: number };
    [daily.value, products.value, count, pages.value, domains.value, siteTrends.value, notFound.value, llmUsage.value, effects.value] = await Promise.all([
      getDaily(days.value),
      getProducts(days.value),
      getProductCount(days.value),
      getPages(days.value, pageSort.value, pageDomain.value),
      getDomains(days.value),
      getDomainTrends(days.value),
      getNotFound(),
      getLlmUsage(days.value),
      getEffects(days.value)
    ]);
    productCount.value = count.count ?? 0;
    // A site without traffic over the new period is no longer in the filter
    if (pageDomain.value && !domains.value.some(site => site.domain === pageDomain.value)) pageDomain.value = '';
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

// The server returns the top pages for the sort and the site: the browser cannot
// reorder or filter them itself
async function reloadPages(): Promise<void> {
  error.value = '';
  try {
    pages.value = await getPages(days.value, pageSort.value, pageDomain.value);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function exportDaily(): void {
  downloadCsv(`amw-daily-${days.value}d.csv`, toCsv(
    ['Date', 'Views', 'Clicks', 'From cache', 'From Amazon', 'Not found'],
    daily.value.map(day => [day.date, day.views, day.clicks, day.cache, day.amazon, day.notfound])
  ));
}

function exportSites(): void {
  downloadCsv(`amw-sites-${days.value}d.csv`, toCsv(
    ['Site', 'Views', 'Clicks', 'CTR'],
    domains.value.map(site => [site.domain, site.impressions, site.clicks, site.ctr])
  ));
}

onMounted(load);
watch(days, load);
watch([pageSort, pageDomain], reloadPages);
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
          <div v-if="status?.stats && view !== 'settings'" class="periods" role="group" aria-label="Period">
            <button
              v-for="period in PERIODS"
              :key="period"
              type="button"
              :class="{ active: days === period }"
              :aria-pressed="days === period"
              @click="days = period"
            >{{ period }} days</button>
          </div>
          <!-- Insights have their own Regenerate action, much slower than a refresh; settings only change on restart -->
          <button
            v-if="view !== 'insights' && view !== 'keywords' && view !== 'settings'"
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

        <!-- Before the Redis notice: the settings do not depend on the statistics -->
        <SettingsView v-if="view === 'settings'" @logout="emit('logout')" />

        <section v-else-if="status && !status.stats" class="card notice">
          <h2><Database class="icon" aria-hidden="true" /> {{ status.message || 'Statistics require Redis' }}</h2>
          <p class="muted">
            Usage statistics are stored in Redis. Enable it in the configuration
            (<code>Redis.enabled: true</code>) and restart the server to start collecting them.
          </p>
        </section>

        <template v-else-if="status">
          <template v-if="view === 'overview'">
            <section class="kpis" aria-label="Key figures">
              <div class="card kpi"><span class="kpi-label">Views</span><span class="kpi-value">{{ number(totals.impressions) }}</span></div>
              <div class="card kpi"><span class="kpi-label">Products shown</span><span class="kpi-value">{{ number(productCount) }}</span></div>
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
            <section class="card">
              <h2>Click-through rate per site</h2>
              <p class="muted">Daily CTR of the 5 most viewed sites; days without views are left blank.</p>
              <SitesTrend :trends="siteTrends" />
            </section>
            <section class="card">
              <h2>Amazon quota estimate</h2>
              <AmazonQuota :daily="daily" />
            </section>
            <div class="exports">
              <button type="button" class="secondary" @click="exportDaily"><Download class="icon" aria-hidden="true" /> Daily figures (CSV)</button>
              <button type="button" class="secondary" @click="exportSites"><Download class="icon" aria-hidden="true" /> All sites (CSV)</button>
            </div>
            <section v-if="effects.length > 0" class="card">
              <h2>Appearance effects</h2>
              <EffectComparison :rows="effects" />
            </section>
            <section v-if="llmUsage.length > 0" class="card">
              <h2>Estimated AI cost</h2>
              <LlmCosts :usage="llmUsage" />
            </section>
          </template>

          <section v-else-if="view === 'products'" class="card">
            <p class="muted">Products served to the widgets over the period, ranked by impressions.</p>
            <TopProducts :products="products" :days="days" />
          </section>

          <section v-else-if="view === 'pages'" class="card">
            <p class="muted">Pages embedding the widget, ranked by the selected column. Views are the products displayed by the page, each counted once per visit (tab session).</p>
            <label v-if="domains.length > 0" class="filter">
              Site
              <select v-model="pageDomain">
                <option value="">All sites</option>
                <option v-for="site in domains" :key="site.domain" :value="site.domain">{{ site.domain }}</option>
              </select>
            </label>
            <TopPages :pages="pages" :sort="pageSort" :days="days" @sort="pageSort = $event" />
          </section>

          <section v-else-if="view === 'notfound'" class="card">
            <p class="muted">Products the Amazon API does not return: their cards stay hidden on these pages. Some may still be on sale, as the API does not serve every product: check them with their link.</p>
            <NotFoundTable :products="notFound" />
          </section>

          <!-- Not kept alive: reopening it shows the pages requested since, and drops unsaved text -->
          <KeywordsView v-else-if="view === 'keywords'" @logout="emit('logout')" />

          <!-- Kept alive so that going back to Insights does not ask the model again -->
          <KeepAlive>
            <InsightsView v-if="view === 'insights'" :days="days" @logout="emit('logout')" />
          </KeepAlive>
        </template>

        <p v-else-if="!error" class="muted">Loading…</p>
      </main>

      <footer class="footer">
        <span>© 2024–{{ year }} Ludovic Toinel</span>
        <template v-if="version?.release">
          <span aria-hidden="true">·</span>
          <a :href="releaseUrl" target="_blank" rel="noopener noreferrer">AMW {{ version.release }}</a>
        </template>
        <span v-if="build">· build {{ build }}</span>
      </footer>
    </div>
  </div>
</template>
