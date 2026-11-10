<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue';
import { CircleAlert, Database, Download, RefreshCw, Settings } from '@lucide/vue';
import {
  getDaily, getDomainTrends, getProductCount, getNotFound, getPages, getProducts, getSites, getStatus, periodLength, periodSlug, UnauthorizedError,
  type DailyStats, type DomainTrend, type NotFoundStats, type PageSort, type PageStats, type Period, type ProductStats, type Status
} from '../api';
import { SERVER_VIEWS, useHashView, VIEWS, type ViewId } from '../navigation';
import { activeSite, setActiveSite } from '../site';
import { downloadCsv, toCsv } from '../tables';
import ActivityBar from './ActivityBar.vue';
import AmwLogo from './AmwLogo.vue';
import DailyChart from './DailyChart.vue';
import KpiTile from './KpiTile.vue';
import TopProducts from './TopProducts.vue';
import TopPages from './TopPages.vue';
import NotFoundTable from './NotFoundTable.vue';
import SitesTrend from './SitesTrend.vue';
import InsightsView from './InsightsView.vue';
import KeywordsView from './KeywordsView.vue';
import AiCostView from './AiCostView.vue';
import AbTestsView from './AbTestsView.vue';
import SettingsView from './SettingsView.vue';
import QuotaView from './QuotaView.vue';
import SitesView from './SitesView.vue';
import StuffingForm from './StuffingForm.vue';
import CustomProductsView from './CustomProductsView.vue';
import DealsView from './DealsView.vue';

// Settings rather than figures: no period, nothing to refresh
const NO_PERIOD_VIEWS: ViewId[] = ['stuffing', 'custom', 'deals'];

const emit = defineEmits<{ logout: [] }>();

const PERIODS = [1, 7, 30, 90];
// A number of days up to today, or a custom range of dates
const days = ref<Period>(30);
const custom = computed(() => typeof days.value !== 'number');
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (count: number) => new Date(Date.now() - count * 86400000).toISOString().slice(0, 10);
// The statistics are kept 90 days: older dates have nothing to show
const OLDEST = daysAgo(89);
const range = ref({ from: daysAgo(6), to: today() });

function chooseCustom(): void {
  days.value = { ...range.value };
}

/** Applied once both dates are valid and in order, so that a half-typed date sends no request. */
function setRange(field: 'from' | 'to', value: string): void {
  range.value = { ...range.value, [field]: value };
  const { from, to } = range.value;
  if (from && to && from <= to && from >= OLDEST && to <= today()) days.value = { from, to };
}

const periodLabel = computed(() => (typeof days.value === 'number'
  ? `the last ${days.value === 1 ? 'day' : `${days.value} days`}`
  : `${days.value.from} to ${days.value.to}`));
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

function totalsOf(days: DailyStats[]) {
  const sum = (key: keyof Omit<DailyStats, 'date' | 'amazonCalls' | 'visits'>) => days.reduce((total, day) => total + day[key], 0);
  // Null when no day of the period counted them: older servers, or days before the widget did
  const counted = days.filter(day => typeof day.visits === 'number');
  const visits = counted.length > 0 ? counted.reduce((total, day) => total + (day.visits ?? 0), 0) : null;
  const cache = sum('cache');
  const amazon = sum('amazon');
  const clicks = sum('clicks');
  const impressions = sum('views');
  const served = cache + amazon;
  return {
    hits: served + sum('notfound'),
    impressions,
    visits,
    cacheRatio: served > 0 ? cache / served : 0,
    notFound: sum('notfound'),
    clicks,
    ctr: impressions > 0 ? clicks / impressions : 0
  };
}

const totals = computed(() => totalsOf(daily.value));
// The period of the same length just before, to tell whether a figure goes up or down
const previousDaily = ref<DailyStats[]>([]);
const previousProductCount = ref<number | null>(null);
// A previous period with traffic on fewer than half of its days (a new site, statistics started
// since) would turn any figure into a rise of thousands of percent: no change is shown then
const previousCovered = computed(() => previousDaily.value.filter(day => day.views > 0).length >= periodLength(days.value) / 2);
const previousTotals = computed(() => (previousCovered.value ? totalsOf(previousDaily.value) : null));

function previousPeriod(period: Period): Period {
  const length = periodLength(period);
  const end = typeof period === 'number' ? Date.now() - length * 86400000 : Date.parse(`${period.from}T00:00:00Z`) - 86400000;
  const day = (time: number) => new Date(time).toISOString().slice(0, 10);
  return { from: day(end - (length - 1) * 86400000), to: day(end) };
}

// The daily series of each key figure, for its sparkline
const series = computed(() => ({
  views: daily.value.map(day => day.views),
  visits: daily.value.map(day => day.visits ?? 0),
  requests: daily.value.map(day => day.cache + day.amazon + day.notfound),
  cache: daily.value.map(day => (day.cache + day.amazon > 0 ? day.cache / (day.cache + day.amazon) : 0)),
  notFound: daily.value.map(day => day.notfound),
  clicks: daily.value.map(day => day.clicks),
  ctr: daily.value.map(day => (day.views > 0 ? day.clicks / day.views : 0))
}));

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
    let previousCount: { count?: number };
    const previous = previousPeriod(days.value);
    [daily.value, products.value, count, pages.value, siteTrends.value, notFound.value, previousDaily.value, previousCount] = await Promise.all([
      getDaily(days.value, site),
      getProducts(days.value, site, productSort.value),
      getProductCount(days.value, site),
      getPages(days.value, pageSort.value, site),
      // The active site may be beyond the most viewed ones
      getDomainTrends(days.value, 20),
      getNotFound(days.value, site),
      getDaily(previous, site),
      getProductCount(previous, site)
    ]);
    productCount.value = count.count ?? 0;
    if (!Array.isArray(previousDaily.value)) previousDaily.value = [];
    previousProductCount.value = previousCovered.value ? previousCount?.count ?? null : null;
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
  downloadCsv(`amw-daily-${site.replace(/[^a-z0-9.-]/gi, '_')}-${periodSlug(days.value)}.csv`, toCsv(
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
          <a class="home-link" href="#/overview" title="Overview">
            <AmwLogo class="titlebar-logo" />
            <span class="brand">AMW</span>
          </a>
          <span class="titlebar-separator" aria-hidden="true">/</span>
          <h1>{{ current.title }}</h1>
        </div>
        <div class="titlebar-actions">
          <div v-if="!SERVER_VIEWS.includes(view)" class="site-switcher">
            <select v-if="sites.length > 0" :value="site" class="site-filter" aria-label="Active site" title="Active site" @change="switchSite">
              <option v-for="host in sites" :key="host" :value="host">{{ host }}</option>
            </select>
            <span v-else-if="sitesLoaded" class="scope-badge">No site yet</span>
            <button type="button" class="icon-button" aria-label="Manage the sites" title="Manage the sites" @click="navigate('sites')">
              <Settings class="icon" aria-hidden="true" />
            </button>
          </div>
          <div v-if="status?.stats && (!SERVER_VIEWS.includes(view) || view === 'aicost') && !NO_PERIOD_VIEWS.includes(view)" class="periods" role="group" aria-label="Period">
            <button
              v-for="period in PERIODS"
              :key="period"
              type="button"
              :class="{ active: days === period }"
              :aria-pressed="days === period"
              @click="days = period"
            >{{ period === 1 ? '1 day' : `${period} days` }}</button>
            <button type="button" :class="{ active: custom }" :aria-pressed="custom" @click="chooseCustom">Custom</button>
          </div>
          <div v-if="custom && status?.stats && (!SERVER_VIEWS.includes(view) || view === 'aicost') && !NO_PERIOD_VIEWS.includes(view)" class="period-range">
            <input type="date" aria-label="From" :min="OLDEST" :max="range.to" :value="range.from" @change="setRange('from', ($event.target as HTMLInputElement).value)" />
            <span aria-hidden="true">→</span>
            <input type="date" aria-label="To" :min="range.from" :max="today()" :value="range.to" @change="setRange('to', ($event.target as HTMLInputElement).value)" />
          </div>
          <!-- Insights have their own Regenerate action, much slower than a refresh; settings only change on restart -->
          <button
            v-if="view !== 'insights' && view !== 'keywords' && !SERVER_VIEWS.includes(view) && !NO_PERIOD_VIEWS.includes(view)"
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
        <AiCostView v-else-if="view === 'aicost' && status?.stats" :days="days" @logout="emit('logout')" />
        <StuffingForm v-else-if="view === 'stuffing'" @logout="emit('logout')" />
        <CustomProductsView v-else-if="view === 'custom'" @logout="emit('logout')" />
        <DealsView v-else-if="view === 'deals'" @logout="emit('logout')" />

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
            <h2>No traffic from {{ site }} over {{ periodLabel }}</h2>
            <p class="muted">
              Its figures appear once its pages show the widget. Check that they load <code>widget.js</code>, and that
              the host of the Sites page matches the address of the pages, port included.
              <a href="https://ltoinel.github.io/amw/user-guide/integration/" target="_blank" rel="noopener noreferrer">How to integrate the widget</a>
            </p>
          </section>

          <template v-else-if="view === 'overview'">
            <section class="kpis" aria-label="Key figures">
              <KpiTile v-if="totals.visits !== null" label="Visits" :value="totals.visits" :previous="previousTotals?.visits" :series="series.visits" />
              <KpiTile label="Views" :value="totals.impressions" :previous="previousTotals?.impressions" :series="series.views" />
              <KpiTile label="Products shown" :value="productCount" :previous="previousProductCount" />
              <KpiTile label="Product requests" :value="totals.hits" :previous="previousTotals?.hits" :series="series.requests" />
              <KpiTile label="Served from cache" kind="rate" :value="totals.cacheRatio" :previous="previousTotals?.cacheRatio" :series="series.cache" />
              <KpiTile label="Not found" better="down" :value="totals.notFound" :previous="previousTotals?.notFound" :series="series.notFound" />
              <KpiTile label="Clicks" :value="totals.clicks" :previous="previousTotals?.clicks" :series="series.clicks" />
              <KpiTile label="Click-through rate" kind="rate" :value="totals.ctr" :previous="previousTotals?.ctr" :series="series.ctr" />
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

          <!-- Kept alive so that going back to the AI view does not ask the model again. Insights are
               kept per number of days up to today: a custom range gets as many days -->
          <KeepAlive>
            <InsightsView v-if="view === 'insights'" :days="periodLength(days)" @logout="emit('logout')" />
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
