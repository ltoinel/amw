<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowDown, ArrowUp, CircleAlert, ImageOff, ListOrdered, Plus, Sparkles, Trash2, TrendingUp } from '@lucide/vue';
import {
  getStuffing, previewProducts, safeUrl, saveStuffing, UnauthorizedError,
  type ProductPreview, type Stuffing, type StuffingMode
} from '../api';

const emit = defineEmits<{ logout: [] }>();

// Same rules as the server
const ASIN = /^[A-Z0-9]{10}$/;
const MAX_PRODUCTS = 20;
const SOURCES: { id: StuffingMode; label: string; description: string; icon: unknown }[] = [
  { id: 'recommendation', label: 'AI recommendations', description: 'Claude picks products for each article, one billed call per page.', icon: Sparkles },
  { id: 'popular', label: 'Best products of the site', description: 'The most clicked products of the site over the last 30 days. No AI call.', icon: TrendingUp },
  { id: 'manual', label: 'Custom product list', description: 'The products below, in the same order on every page. No AI call.', icon: ListOrdered },
];

const stuffing = ref<Stuffing | null>(null);
const enabled = ref(false);
const count = ref(0);
const mode = ref<StuffingMode>('recommendation');
const containerId = ref('');
const products = ref<string[]>([]);
const newAsin = ref('');
const wordsPerCard = ref(0);
// By host; an empty field leaves the site on the default number
const siteCounts = ref<Record<string, number | ''>>({});
const saving = ref(false);
const saved = ref(false);
const error = ref('');
// By ASIN: what Amazon returns, kept across saves so that a product is looked up once
const previews = ref<Record<string, ProductPreview>>({});
const previewError = ref('');

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
  siteCounts.value = Object.fromEntries(sites(values).map(site => [site, values.sites?.[site] ?? '']));
}

/** The sites served, and those set before they left the list, so that they can be cleared. */
function sites(values: Stuffing): string[] {
  return [...new Set([...(values.allowedSites ?? []), ...Object.keys(values.sites ?? {})])];
}

const siteList = computed(() => (stuffing.value ? sites(stuffing.value) : []));
const candidate = computed(() => newAsin.value.trim().toUpperCase());
const candidateError = computed(() => {
  if (candidate.value === '') return '';
  if (!ASIN.test(candidate.value)) return 'An ASIN has 10 letters or digits, such as B084DN3XVN.';
  if (products.value.includes(candidate.value)) return 'This product is already in the list.';
  return '';
});
const full = computed(() => products.value.length >= MAX_PRODUCTS);

async function run(action: () => Promise<Stuffing>): Promise<boolean> {
  error.value = '';
  try {
    show(await action());
    void preview(products.value);
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

/** Looks up the products not seen yet: those missing from the cache use the Amazon quota. */
async function preview(asins: string[]): Promise<void> {
  const missing = asins.filter(asin => !previews.value[asin]);
  if (missing.length === 0) return;
  previewError.value = '';
  try {
    const { results } = await previewProducts(missing);
    for (const result of results ?? []) previews.value[result.id] = result;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    previewError.value = `The products could not be previewed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function add(): void {
  if (candidate.value === '' || candidateError.value || full.value) return;
  products.value.push(candidate.value);
  newAsin.value = '';
  saved.value = false;
  void preview([products.value[products.value.length - 1]]);
}

function remove(index: number): void {
  products.value.splice(index, 1);
  saved.value = false;
}

function move(index: number, offset: -1 | 1): void {
  const [asin] = products.value.splice(index, 1);
  products.value.splice(index + offset, 0, asin);
  saved.value = false;
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
    mode: mode.value,
    containerId: containerId.value,
    products: products.value,
    wordsPerCard: Number(wordsPerCard.value) || 0,
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
        <fieldset v-if="siteList.length > 0" class="stuffing-sites" :disabled="!stuffing.editable">
          <legend>Most cards per site (empty: {{ count }})</legend>
          <label v-for="site in siteList" :key="site">
            <code>{{ site }}</code>
            <input v-model.number="siteCounts[site]" type="number" min="0" max="5" step="1" :placeholder="String(count)" />
          </label>
        </fieldset>
        <fieldset class="stuffing-sources" :disabled="!stuffing.editable">
          <legend>Products of the cards</legend>
          <label v-for="source in SOURCES" :key="source.id" :class="['source-option', { selected: mode === source.id }]">
            <input v-model="mode" type="radio" name="stuffing-mode" :value="source.id" />
            <component :is="source.icon" class="icon" aria-hidden="true" />
            <span>
              <strong>{{ source.label }}</strong>
              <span class="muted">{{ source.description }}</span>
            </span>
          </label>
        </fieldset>
        <label>
          Article container (HTML id)
          <input v-model="containerId" type="text" pattern="[A-Za-z][\w\-]{0,63}" required :disabled="!stuffing.editable" />
        </label>
      </template>

      <!-- Off, the page shows the switch alone: the rest only matters once cards are added -->
      <fieldset v-if="enabled" class="stuffing-products" :disabled="!stuffing.editable">
        <legend>Products ({{ products.length }}/{{ MAX_PRODUCTS }})</legend>
        <p class="muted hint">
          <template v-if="mode === 'manual'">The first card shows the first product, the second card the second one, and so on.</template>
          <template v-else-if="mode === 'popular'">Shown after the most clicked products of the site, while it has too few clicks.</template>
          <template v-else>A card without a product chosen for its page shows these, in order, then the most clicked products of the site.</template>
          A new product is looked up on Amazon, which uses one call of the quota when it is not in the cache.
        </p>
        <ol v-if="products.length > 0" class="product-list">
          <li v-for="(asin, index) in products" :key="asin" class="product-row">
            <span class="product-thumb">
              <img
                v-if="safeUrl(previews[asin]?.product?.image)"
                :src="safeUrl(previews[asin]?.product?.image)"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
              />
              <ImageOff v-else class="icon" aria-hidden="true" />
            </span>
            <span class="product-text">
              <a
                v-if="previews[asin]?.product?.title && safeUrl(previews[asin]?.product?.url)"
                :href="safeUrl(previews[asin]?.product?.url)"
                target="_blank"
                rel="noopener noreferrer"
              >{{ previews[asin]?.product?.title }}</a>
              <span v-else-if="previews[asin]?.product?.title">{{ previews[asin]?.product?.title }}</span>
              <span v-else-if="previews[asin] && previews[asin].status === 404" class="error">Amazon does not return this product</span>
              <span v-else class="muted">{{ previews[asin] ? 'No preview' : 'Loading…' }}</span>
              <code class="muted">{{ asin }}</code>
            </span>
            <span class="product-actions">
              <button type="button" class="icon-button" :aria-label="`Move ${asin} up`" title="Move up" :disabled="index === 0" @click="move(index, -1)">
                <ArrowUp class="icon" aria-hidden="true" />
              </button>
              <button type="button" class="icon-button" :aria-label="`Move ${asin} down`" title="Move down" :disabled="index === products.length - 1" @click="move(index, 1)">
                <ArrowDown class="icon" aria-hidden="true" />
              </button>
              <button type="button" class="icon-button" :aria-label="`Remove ${asin}`" title="Remove" @click="remove(index)">
                <Trash2 class="icon" aria-hidden="true" />
              </button>
            </span>
          </li>
        </ol>
        <div class="product-add">
          <input
            v-model="newAsin"
            type="text"
            aria-label="ASIN to add"
            placeholder="B084DN3XVN"
            maxlength="10"
            spellcheck="false"
            autocapitalize="characters"
            :disabled="full"
            @keydown.enter.prevent="add"
          />
          <button type="button" class="secondary" :disabled="full || candidate === '' || candidateError !== ''" @click="add">
            <Plus class="icon" aria-hidden="true" /> Add
          </button>
        </div>
        <p v-if="candidateError" class="error" role="alert">{{ candidateError }}</p>
        <p v-if="previewError" class="muted" role="status">{{ previewError }}</p>
      </fieldset>

      <button type="submit" :disabled="saving || !stuffing.editable">Save</button>
    </form>
    <p v-if="!stuffing.editable" class="muted">Changing these settings requires Redis or <code>Admin.settingsFile</code>.</p>
    <p v-if="enabled && mode === 'recommendation' && !stuffing.recommendationEnabled" class="muted">
      Recommended cards need <code>Recommendation.enabled</code>: enable it, or choose the products below.
    </p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved.</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
  <p v-else class="muted" role="status">Loading…</p>
</template>
