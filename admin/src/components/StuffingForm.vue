<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { BadgePercent, CircleAlert, ListOrdered, Sparkles, TrendingUp } from '@lucide/vue';
import {
  getStuffing, saveStuffing, UnauthorizedError,
  type Stuffing, type StuffingMode, type StuffingSource
} from '../api';
import { activeSite } from '../site';

const emit = defineEmits<{ logout: [] }>();

const SOURCES: { id: StuffingSource; label: string; description: string; icon: unknown }[] = [
  { id: 'recommendation', label: 'AI recommendations', description: 'Claude picks products for each article, one billed call per page.', icon: Sparkles },
  { id: 'popular', label: 'Best products of the site', description: 'The most clicked products of the site over the last 30 days. No AI call.', icon: TrendingUp },
  { id: 'manual', label: 'Custom product list', description: 'Your custom products, in the same order on every page. No AI call.', icon: ListOrdered },
  { id: 'deals', label: 'Best deals', description: 'Discounted products of an Amazon search, the larger discounts more often. No AI call.', icon: BadgePercent },
];
const NO_WEIGHTS: Record<StuffingSource, number> = { recommendation: 0, popular: 0, manual: 0, deals: 0 };
// Search indexes found on most marketplaces; "All" searches every category
const CATEGORIES: { id: string; label: string }[] = [
  { id: 'All', label: 'Every category' }, { id: 'Electronics', label: 'Electronics' }, { id: 'Computers', label: 'Computers' },
  { id: 'VideoGames', label: 'Video games' }, { id: 'HomeAndKitchen', label: 'Home and kitchen' },
  { id: 'ToolsAndHomeImprovement', label: 'Tools and DIY' }, { id: 'GardenAndOutdoor', label: 'Garden' },
  { id: 'SportsAndOutdoors', label: 'Sports and outdoors' }, { id: 'ToysAndGames', label: 'Toys and games' },
  { id: 'Books', label: 'Books' }, { id: 'Beauty', label: 'Beauty' }, { id: 'HealthPersonalCare', label: 'Health' },
  { id: 'Baby', label: 'Baby' }, { id: 'PetSupplies', label: 'Pet supplies' }, { id: 'OfficeProducts', label: 'Office' },
  { id: 'MusicalInstruments', label: 'Musical instruments' }, { id: 'Automotive', label: 'Automotive' }, { id: 'Fashion', label: 'Fashion' }
];

// How the cards use the custom products, which have their own page
const listUse = computed(() => {
  const single = singleSource();
  if (single === 'deals') return '';
  return LIST_USES[single ?? 'mix'];
});
const LIST_USES: Record<string, string> = {
  manual: 'The cards show the',
  popular: 'While the site has too few clicks, the cards show the',
  recommendation: 'A card without a product chosen for its page shows the',
  mix: 'The custom list cards, and those of other sources without a product, show the'
};

const stuffing = ref<Stuffing | null>(null);
const enabled = ref(false);
const count = ref(0);
const mode = ref<StuffingMode>('recommendation');
const containerId = ref('');
const products = ref<string[]>([]);
const wordsPerCard = ref(0);
const deals = ref({ keywords: '', searchIndex: 'All', minSavingPercent: 20 });
const weights = ref<Record<StuffingSource, number>>({ ...NO_WEIGHTS });
// Deals need their search once they have a share
const needsDeals = computed(() => weights.value.deals > 0);

/** Sets the share of one source alone: the total is checked, not balanced, so nothing moves by itself. */
function setShare(source: StuffingSource, value: number): void {
  weights.value = { ...weights.value, [source]: Math.min(100, Math.max(0, Math.round(value / 5) * 5)) };
  saved.value = false;
}
const total = computed(() => SOURCES.reduce((sum, { id }) => sum + weights.value[id], 0));

/** The shares of a saved value: a single source of older values is that source at 100 %. */
function sharesOf(values: Stuffing): Record<StuffingSource, number> {
  const stored = values.weights;
  const total = stored ? Object.values(stored).reduce((sum, weight) => sum + weight, 0) : 0;
  if (values.mode === 'mix' && stored && total > 0) {
    // Weights saved before the shares made 100 are scaled to it
    return Object.fromEntries(SOURCES.map(({ id }) => [id, Math.round((stored[id] / total) * 20) * 5])) as Record<StuffingSource, number>;
  }
  const single = values.mode && values.mode !== 'mix' ? values.mode : 'recommendation';
  return { ...NO_WEIGHTS, [single]: 100 };
}
// By host; an empty field leaves the site on the default number
const siteCounts = ref<Record<string, number | ''>>({});
const saving = ref(false);
const saved = ref(false);
const error = ref('');

function show(values: Stuffing): void {
  stuffing.value = values;
  // Older servers have no switch: their cards were on whenever there was a number
  enabled.value = values.enabled ?? (values.count > 0 || Object.values(values.sites ?? {}).some(cards => cards > 0));
  count.value = values.count;
  // Older servers have no modes: their cards are recommendations
  mode.value = values.mode ?? 'recommendation';
  containerId.value = values.containerId;
  products.value = [...(values.products ?? [])];
  // Older servers have neither the ratio nor the numbers per site
  wordsPerCard.value = values.wordsPerCard ?? 0;
  deals.value = { ...(values.deals ?? { keywords: '', searchIndex: 'All', minSavingPercent: 20 }) };
  weights.value = sharesOf(values);
  siteCounts.value = Object.fromEntries(sites(values).map(site => [site, values.sites?.[site] ?? '']));
}

/** The sites served, and those set before they left the list, so that they can be cleared. */
function sites(values: Stuffing): string[] {
  return [...new Set([...(values.allowedSites ?? []), ...Object.keys(values.sites ?? {})])];
}


async function run(action: () => Promise<Stuffing>): Promise<boolean> {
  error.value = '';
  try {
    show(await action());
    return true;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return false;
    }
    error.value = e instanceof Error ? e.message : String(e);
    return false;
  }
}

/** The only source with a share, when there is one. */
function singleSource(): StuffingSource | null {
  const active = SOURCES.map(option => option.id).filter(id => weights.value[id] > 0);
  return active.length === 1 ? active[0] : null;
}

async function save(): Promise<void> {
  saving.value = true;
  saved.value = false;
  const ownNumbers = Object.entries(siteCounts.value)
    .filter(([, cards]) => cards !== '' && cards !== null)
    .map(([site, cards]) => [site, Number(cards)]);
  saved.value = await run(() => saveStuffing({
    enabled: enabled.value,
    count: Number(count.value),
    // A single source keeps its mode, so that older servers and the API read it as before
    mode: singleSource() ?? (stuffing.value?.weights ? 'mix' : mode.value),
    containerId: containerId.value,
    products: products.value,
    wordsPerCard: Number(wordsPerCard.value) || 0,
    ...(stuffing.value?.weights ? { weights: { ...weights.value } } : {}),
    ...(stuffing.value?.deals ? { deals: { ...deals.value, keywords: deals.value.keywords.trim(), minSavingPercent: Number(deals.value.minSavingPercent) } } : {}),
    sites: Object.fromEntries(ownNumbers)
  }));
  saving.value = false;
}

onMounted(() => run(getStuffing));
</script>

<template>
  <section v-if="stuffing" class="card">
    <h2>Stuffing</h2>
    <p class="muted">
      Stuffing adds cards at the end of a paragraph, before a heading of the article, each with a different
      product. The number is a maximum, cards already placed in the article included: with 3 and one card in the
      article, Stuffing adds 2. A change reaches pages within an hour, as <code>widget.js</code> is cached.
    </p>
    <p v-if="stuffing.own === false" class="muted site-inherit">
      {{ activeSite }} uses the Stuffing of every site: saving gives it its own settings, which the other sites keep apart from.
    </p>
    <form class="stuffing-form" @submit.prevent="save">
      <label class="choice stuffing-switch">
        <input v-model="enabled" type="checkbox" role="switch" :disabled="!stuffing.editable" />
        <span>Add cards to the articles</span>
      </label>

      <template v-if="enabled">
        <label>
          Most cards per article
          <input v-model.number="count" type="number" min="0" max="5" step="1" required :disabled="!stuffing.editable" />
        </label>
        <label>
          Words per card (0: no limit)
          <input v-model.number="wordsPerCard" type="number" min="0" max="10000" step="50" required :disabled="!stuffing.editable" />
        </label>
        <p v-if="wordsPerCard > 0" class="muted hint">
          An article of {{ (wordsPerCard * 2).toLocaleString('en-US') }} words gets 2 cards at most, a shorter one fewer.
        </p>
        <fieldset class="stuffing-mix" :disabled="!stuffing.editable">
          <legend>Products of the cards: share of each source</legend>
          <div v-for="source in SOURCES" :key="source.id" :class="['mix-source', { off: weights[source.id] === 0 }]">
            <component :is="source.icon" class="icon" aria-hidden="true" />
            <span class="mix-text">
              <strong :id="`mix-${source.id}`">{{ source.label }}</strong>
              <span class="muted">{{ source.description }}</span>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              :value="weights[source.id]"
              :aria-labelledby="`mix-${source.id}`"
              :aria-valuetext="weights[source.id] === 0 ? 'Off' : `${weights[source.id]} %`"
              @input="setShare(source.id, Number(($event.target as HTMLInputElement).value))"
            />
            <output :for="`mix-${source.id}`" :class="['mix-share', { over: total > 100 }]">{{ weights[source.id] === 0 ? 'Off' : `${weights[source.id]} %` }}</output>
          </div>
          <p :class="['mix-total', { over: total > 100, under: total < 100 }]" aria-live="polite">
            Total: {{ total }} %
            <template v-if="total > 100"> — {{ total - 100 }} % too many: lower a share.</template>
            <template v-else-if="total < 100"> — {{ 100 - total }} % left to give.</template>
          </p>
          <p class="muted hint">
            0 turns a source off, 100 % makes it the only one; the shares make 100 % to save.
            A page keeps its cards; a source without a product hands the card to another one.
          </p>
        </fieldset>
        <fieldset v-if="needsDeals" class="stuffing-deals" :disabled="!stuffing.editable">
          <legend>Deals search</legend>
          <label>
            Keywords
            <input v-model="deals.keywords" type="text" maxlength="100" required placeholder="bluetooth headphones" />
          </label>
          <label>
            Category
            <select v-model="deals.searchIndex">
              <option v-if="!CATEGORIES.some(category => category.id === deals.searchIndex)" :value="deals.searchIndex">{{ deals.searchIndex }}</option>
              <option v-for="category in CATEGORIES" :key="category.id" :value="category.id">{{ category.label }}</option>
            </select>
          </label>
          <label>
            Smallest discount (%)
            <input v-model.number="deals.minSavingPercent" type="number" min="5" max="90" step="5" required />
          </label>
          <p class="muted hint">
            One Amazon search every 3 hours finds up to 10 products; each page draws its cards among them, a product
            with 40 % off twice as often as one with 20 % off.
          </p>
        </fieldset>
        <label>
          Article container (HTML id)
          <input v-model="containerId" type="text" pattern="[A-Za-z][\w\-]{0,63}" required :disabled="!stuffing.editable" />
        </label>
      </template>

      <!-- The list has its own page: saving here keeps it as loaded -->
      <p v-if="enabled && listUse" class="muted hint stuffing-products-link">
        {{ listUse }} <a href="#/custom">custom products</a> of the site ({{ products.length }}).
      </p>

      <button type="submit" :disabled="saving || !stuffing.editable || (enabled && total !== 100)">Save</button>
    </form>
    <p v-if="!stuffing.editable" class="muted">Changing these settings requires Redis or <code>Admin.settingsFile</code>.</p>
    <p v-if="enabled && weights.recommendation > 0 && !stuffing.recommendationEnabled" class="muted">
      Recommended cards need <code>Recommendation.enabled</code>: enable it, or choose another source.
    </p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved.</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
  <p v-else class="muted" role="status">Loading…</p>
</template>
