<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue';
import { CircleAlert, Database, Download, Globe, RefreshCw, Settings } from '@lucide/vue';
import {
  getDaily, getDomainTrends, getProductCount, getLlmUsage, getNotFound, getPages, getProducts, getSites, getStatus, UnauthorizedError,
  type DailyStats, type DomainTrend, type LlmUsage, type NotFoundStats, type PageSort, type PageStats, type ProductStats, type Status
} from '../api';
import { EVERY_SITE_VIEWS, SERVER_VIEWS, useHashView, VIEWS } from '../navigation';
import { activeSite, setActiveSite } from '../site';
import { downloadCsv, toCsv } from '../tables';
import ActivityBar from './ActivityBar.vue';
import AmwLogo from './AmwLogo.vue';
import DailyChart from './DailyChart.vue';
import TopProducts from './TopProducts.vue';
import TopPages from './TopPages.vue';
import NotFoundTable from './NotFoundTable.vue';
import SitesTrend from './SitesTrend.vue';
import InsightsView from './InsightsView.vue';
import KeywordsView from './KeywordsView.vue';
import LlmCosts from './LlmCosts.vue';
import AbTestsView from './AbTestsView.vue';
import SettingsView from './SettingsView.vue';
import QuotaView from './QuotaView.vue';
import SitesView from './SitesView.vue';
import StuffingForm from './StuffingForm.vue';

const emit = defineEmits<{ logout: [] }>();

const PERIODS = [7, 30, 90];
const days = ref(30);
const status = ref<Status | null>(null);
const daily = ref<DailyStats[]>([]);
const products = ref<ProductStats[]>([]);
const productCount = ref(0);
const pages = ref<PageStats[]>([]);
const pageSort = ref<PageSort>('clicks');
const productSort = ref<PageSort>('impressions');
// The active site, remembered by the browser, the first site of the list otherwise: the dashboard
// is remounted when it changes
const site = activeSite.value;
const sites = ref<string[]>(site ? [site] : []);
// Until the list is read, an empty active site may only be the first visit, not a lack of sites
const sitesLoaded = ref(false);
const siteTrends = ref<DomainTrend[]>([]);
const notFound = ref<NotFoundStats[]>([]);
const llmUsage = ref<LlmUsage[]>([]);
const abTests = ref<InstanceType<typeof AbTestsView> | null>(null);
const loading = ref(false);
const error = ref('');

// The sites of the Sites page, to switch between them
async function loadSites(): Promise<void> {
  try {
    followSites((await getSites()).sites.map(entry => entry.host));
  } catch {
    // The switcher keeps the active site alone
  }
  sitesLoaded.value = true;
}

/** A first visit, or a removed or renamed active site, opens the first site of the list. */
function followSites(hosts: string[]): void {
  sites.value = hosts;
  if (!hosts.includes(site)) setActiveSite(hosts[0] ?? '');
}

function switchSite(event: Event): void {
  setActiveSite((event.target as HTMLSelectElement).value);
}

// The trend of the active site: its hostname, as pages are grouped by hostname
const visibleTrends = computed(() => siteTrends.value.filter(trend => trend.domain === site.replace(/:\d+$/, '')));

const { view, navigate } = useHashView();
const current = computed(() => VIEWS.find(definition => definition.id === view.value) ?? VIEWS[0]);

watchEffect(() => { document.title = `${current.value.label} · AMW Admin`; });

const totals = computed(() => {
  const sum = (key: keyof Omit<DailyStats, 'date' | 'amazonCalls'>) => daily.value.reduce((total, day) => total + day[key], 0);
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
    // Without a site there are no figures to show
    if (!status.value.stats || !site) return;
    let count: { count?: number };
    [daily.value, products.value, count, pages.value, siteTrends.value, notFound.value, llmUsage.value] = await Promise.all([
      getDaily(days.value, site),
      getProducts(days.value, site, productSort.value),
      getProductCount(days.value, site),
      getPages(days.value, pageSort.value, site),
      // The active site may be beyond the most viewed ones
      getDomainTrends(days.value, 20),
      getNotFound(site),
      getLlmUsage(days.value)
    ]);
    productCount.value = count.count ?? 0;
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

// The server returns the top rows for the sort: the browser cannot reorder them itself
async function reload(table: () => Promise<void>): Promise<void> {
  error.value = '';
  try {
    await table();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function exportDaily(): void {
  downloadCsv(`amw-daily-${site.replace(/[^a-z0-9.-]/gi, '_')}-${days.value}d.csv`, toCsv(
    ['Date', 'Views', 'Clicks', 'From cache', 'From Amazon', 'Not found'],
    daily.value.map(day => [day.date, day.views, day.clicks, day.cache, day.amazon, day.notfound])
  ));
}

// The A/B tests view loads its own figures
function refresh(): void {
  void load();
  void abTests.value?.load();
}

// The sites do not need the statistics: the switcher works without Redis
onMounted(() => { void loadSites(); void load(); });
watch(days, load);
watch(pageSort, () => reload(async () => { pages.value = await getPages(days.value, pageSort.value, site); }));
watch(productSort, () => reload(async () => { products.value = await getProducts(days.value, site, productSort.value); }));
</script>

<template>
  <div class="workbench-shell">
    <ActivityBar :active="view" @select="navigate" @logout="emit('logout')" />

    <div class="workbench">
      <header class="titlebar">
        <div class="titlebar-title">
          <!-- On phones the activity bar, and its logo, move to the bottom -->
          <AmwLogo class="titlebar-logo" />
          <span class="brand">AMW</span>
          <span class="titlebar-separator" aria-hidden="true">/</span>
          <h1>{{ current.title }}</h1>
        </div>
        <div class="titlebar-actions">
          <div v-if="!SERVER_VIEWS.includes(view)" class="site-switcher">
            <!-- Not yet per site: naming the active site there would suggest otherwise -->
            <span v-if="EVERY_SITE_VIEWS.includes(view)" class="scope-badge" title="This view covers every site, whatever the active site">
              <Globe class="icon" aria-hidden="true" /> Every site
            </span>
            <select v-else-if="sites.length > 0" :value="site" class="site-filter" aria-label="Active site" title="Active site" @change="switchSite">
              <option v-for="host in sites" :key="host" :value="host">{{ host }}</option>
            </select>
            <span v-else-if="sitesLoaded" class="scope-badge">No site yet</span>
            <button type="button" class="icon-button" aria-label="Manage the sites" title="Manage the sites" @click="navigate('sites')">
              <Settings class="icon" aria-hidden="true" />
            </button>
          </div>
          <div v-if="status?.stats && !SERVER_VIEWS.includes(view) && view !== 'stuffing'" class="periods" role="group" aria-label="Period">
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
            v-if="view !== 'insights' && view !== 'keywords' && !SERVER_VIEWS.includes(view) && view !== 'stuffing'"
            type="button"
            class="icon-button"
            :class="{ spinning: loading }"
            aria-label="Refresh"
            title="Refresh"
            :disabled="loading"
            @click="refresh"
          >
            <RefreshCw class="icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      <!-- The landmark stays a <main>: a role on it would replace the one screen readers jump to -->
      <main class="workbench-main">
      <!-- A view without a tab (the sites, opened with the gear) is named by its title -->
      <div
        id="view-panel"
        class="content"
        role="tabpanel"
        :aria-labelledby="current.hidden ? undefined : `tab-${view}`"
        :aria-label="current.hidden ? current.title : undefined"
        tabindex="-1"
      >
        <p v-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>

        <!-- Before the Redis notice: the settings, the sites and Stuffing do not depend on the statistics -->
        <SettingsView v-if="view === 'settings'" @logout="emit('logout')" />
        <SitesView v-else-if="view === 'sites'" @logout="emit('logout')" @changed="followSites" />
        <QuotaView v-else-if="view === 'quota' && status?.stats" @logout="emit('logout')" />
        <StuffingForm v-else-if="view === 'stuffing'" @logout="emit('logout')" />

        <!-- Sites are only managed with the gear of the title bar -->
        <section v-else-if="!site && sitesLoaded" class="card notice">
          <h2>No site yet</h2>
          <p class="muted">
            Add your first site with the gear <Settings class="icon inline-icon" aria-hidden="true" /> to the right of the site
            list, at the top of the page: the views then show its figures.
          </p>
        </section>

        <section v-else-if="status && !status.stats" class="card notice">
          <h2><Database class="icon" aria-hidden="true" /> {{ status.message || 'Statistics require Redis' }}</h2>
          <p class="muted">
            Usage statistics are stored in Redis. Enable it in the configuration
            (<code>Redis.enabled: true</code>) and restart the server to start collecting them.
          </p>
        </section>

        <template v-else-if="status">

          <!-- A new site, or one whose pages lost the widget: charts of zeros would explain nothing -->
          <section v-if="view === 'overview' && totals.hits === 0 && totals.impressions === 0 && !loading" class="card notice">
            <h2>No traffic from {{ site }} over the last {{ days }} days</h2>
            <p class="muted">
              Its figures appear once its pages show the widget. Check that they load <code>widget.js</code>, and that
              the host of the Sites page matches the address of the pages, port included.
              <a href="https://ltoinel.github.io/amw/user-guide/integration/" target="_blank" rel="noopener noreferrer">How to integrate the widget</a>
            </p>
          </section>

          <template v-else-if="view === 'overview'">
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
              <h2>Click-through rate per day</h2>
              <p class="muted">Days without views are left blank.</p>
              <SitesTrend :trends="visibleTrends" :average="totals.ctr" />
            </section>
            <div class="exports">
              <button type="button" class="secondary" @click="exportDaily"><Download class="icon" aria-hidden="true" /> Daily figures (CSV)</button>
            </div>
          </template>

          <section v-else-if="view === 'products'" class="card">
            <p class="muted">Products served to the widgets over the period, ranked by the selected column.</p>
            <TopProducts :products="products" :sort="productSort" :days="days" :average="totals.ctr" @sort="productSort = $event" />
          </section>

          <section v-else-if="view === 'pages'" class="card">
            <p class="muted">Pages embedding the widget, ranked by the selected column. Views are the products displayed by the page, each counted once per visit (tab session).</p>
            <TopPages :pages="pages" :sort="pageSort" :days="days" :average="totals.ctr" @sort="pageSort = $event" />
          </section>

          <section v-else-if="view === 'notfound'" class="card">
            <p class="muted">Products the Amazon API does not return: their cards stay hidden on these pages. Some may still be on sale, as the API does not serve every product: check them with their link.</p>
            <NotFoundTable :products="notFound" />
          </section>

          <!-- Not kept alive: reopening it shows the pages requested since, and drops unsaved text -->
          <KeywordsView v-else-if="view === 'keywords'" @logout="emit('logout')" />

          <AbTestsView v-else-if="view === 'abtests'" ref="abTests" :days="days" @logout="emit('logout')" />

          <!-- The AI view: what Claude costs, then the insights -->
          <section v-if="view === 'insights'" class="card ai-cost">
            <h2>Estimated AI cost</h2>
            <LlmCosts v-if="llmUsage.length > 0" :usage="llmUsage" />
            <p v-else class="muted">No call to Claude over the period: recommendations and insights are billed when they call it.</p>
          </section>

          <!-- Kept alive so that going back to the AI view does not ask the model again -->
          <KeepAlive>
            <InsightsView v-if="view === 'insights'" :days="days" @logout="emit('logout')" />
          </KeepAlive>
        </template>

        <p v-else-if="!error" class="muted">Loading…</p>
      </div>
      </main>

      <footer class="footer">
        <span>© 2024–{{ year }} <a href="https://ludovic.toinel.com" target="_blank" rel="noopener noreferrer">Ludovic Toinel</a></span>
        <template v-if="version?.release">
          <span aria-hidden="true">·</span>
          <a :href="releaseUrl" target="_blank" rel="noopener noreferrer">AMW {{ version.release }}</a>
        </template>
        <span v-if="build">· build {{ build }}</span>
      </footer>
    </div>
  </div>
</template>
