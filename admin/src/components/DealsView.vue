<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CircleAlert, Eye, ImageOff, Plus, Trash2 } from '@lucide/vue';
import {
  getStuffing, previewDeals, safeUrl, saveDealSearches, UnauthorizedError,
  type DealPreview, type DealSearch, type Stuffing
} from '../api';
import { CATEGORIES, MAX_PRODUCTS, MAX_SEARCHES } from '../deals';
import { activeSite } from '../site';

const emit = defineEmits<{ logout: [] }>();

const NEW_SEARCH: DealSearch = { keywords: '', searchIndex: 'All', minSavingPercent: 20, maxProducts: MAX_PRODUCTS };

const stuffing = ref<Stuffing | null>(null);
const searches = ref<DealSearch[]>([]);
// By position: what Amazon returned for the search as it was when previewed
const previews = ref<Record<number, { search: string; results: DealPreview[] } | { search: string; error: string } | undefined>>({});
const previewing = ref<number | null>(null);
const saving = ref(false);
const saved = ref(false);
const error = ref('');

const keyOf = (search: DealSearch) => JSON.stringify([search.keywords.trim(), search.searchIndex, search.minSavingPercent, search.maxProducts]);
const complete = computed(() => searches.value.every(search => search.keywords.trim() !== ''));
const changed = computed(() => stuffing.value !== null && JSON.stringify(searches.value.map(keyOf)) !== JSON.stringify(searchesOf(stuffing.value).map(keyOf)));
// The cards put the flash sales still running first
const flashSale = (deal: DealPreview) => deal.dealEnd !== undefined && Date.parse(deal.dealEnd) > Date.now();
const categoryOf = (id: string) => CATEGORIES.find(category => category.id === id)?.label ?? id;

function fail(e: unknown): void {
  if (e instanceof UnauthorizedError) {
    emit('logout');
    return;
  }
  error.value = e instanceof Error ? e.message : String(e);
}

/** The searches of the site; the single search saved before this view becomes the first one. */
function searchesOf(values: Stuffing): DealSearch[] {
  if (values.dealSearches?.length) return values.dealSearches;
  return values.deals?.keywords ? [{ ...values.deals, maxProducts: MAX_PRODUCTS }] : [];
}

function show(values: Stuffing): void {
  stuffing.value = values;
  searches.value = searchesOf(values).map(search => ({ ...search }));
}

function add(): void {
  if (searches.value.length >= MAX_SEARCHES) return;
  searches.value.push({ ...NEW_SEARCH });
  saved.value = false;
}

function remove(index: number): void {
  searches.value.splice(index, 1);
  // The previews follow their search
  const next: typeof previews.value = {};
  Object.entries(previews.value).forEach(([position, preview]) => {
    const at = Number(position);
    if (at < index) next[at] = preview;
    else if (at > index) next[at - 1] = preview;
  });
  previews.value = next;
  saved.value = false;
}

/** Runs one search: the cache of the cards, then Amazon, once every few hours at most. */
async function preview(index: number): Promise<void> {
  const search = { ...searches.value[index], keywords: searches.value[index].keywords.trim() };
  if (!search.keywords) return;
  previewing.value = index;
  try {
    const { results } = await previewDeals(search);
    previews.value[index] = { search: keyOf(search), results };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    previews.value[index] = { search: keyOf(search), error: e instanceof Error ? e.message : String(e) };
  } finally {
    previewing.value = null;
  }
}

/** Whether the preview shown still matches the search as it is now. */
const current = (index: number) => {
  const shown = previews.value[index];
  return shown !== undefined && shown.search === keyOf(searches.value[index]) ? shown : undefined;
};

async function save(): Promise<void> {
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    show(await saveDealSearches(searches.value.map(search => ({ ...search, keywords: search.keywords.trim() }))));
    saved.value = true;
  } catch (e) {
    fail(e);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    show(await getStuffing());
  } catch (e) {
    fail(e);
  }
});
</script>

<template>
  <section v-if="stuffing" class="card">
    <h2>Best deals ({{ searches.length }}/{{ MAX_SEARCHES }} searches)</h2>
    <p class="muted">
      The discounted products the Stuffing cards of {{ activeSite || 'every site' }} draw from, when best deals have a
      share in the Stuffing view. Each search keeps its products for 24 hours: up to 3 Amazon calls a day each, previews included.
      The cards draw among the products of every search, a larger discount more often.
    </p>
    <p v-if="stuffing.own === false" class="muted site-inherit">
      {{ activeSite }} uses the Stuffing of every site: saving gives it its own settings, which the other sites keep apart from.
    </p>

    <form class="deals-form" @submit.prevent="save">
      <p v-if="searches.length === 0" class="muted">No search yet: add one with the keywords of the products you want, such as <em>bluetooth headphones</em>.</p>
      <fieldset v-for="(search, index) in searches" :key="index" class="deal-search" :disabled="!stuffing.editable">
        <legend>Search {{ index + 1 }}</legend>
        <div class="deal-fields">
          <label class="deal-keywords">
            Keywords
            <input v-model="search.keywords" type="text" maxlength="100" required placeholder="bluetooth headphones" />
          </label>
          <label>
            Category
            <select v-model="search.searchIndex">
              <option v-if="!CATEGORIES.some(category => category.id === search.searchIndex)" :value="search.searchIndex">{{ search.searchIndex }}</option>
              <option v-for="category in CATEGORIES" :key="category.id" :value="category.id">{{ category.label }}</option>
            </select>
          </label>
          <label>
            Smallest discount (%)
            <input v-model.number="search.minSavingPercent" type="number" min="5" max="90" step="5" required />
          </label>
          <label>
            Products, at most
            <input v-model.number="search.maxProducts" type="number" min="1" :max="MAX_PRODUCTS" step="1" required />
          </label>
        </div>
        <div class="deal-actions">
          <button type="button" class="secondary" :disabled="!search.keywords.trim() || previewing !== null" @click="preview(index)">
            <Eye class="icon" aria-hidden="true" /> {{ previewing === index ? 'Searching…' : 'Preview' }}
          </button>
          <button type="button" class="icon-button" :aria-label="`Remove search ${index + 1}`" title="Remove" @click="remove(index)">
            <Trash2 class="icon" aria-hidden="true" />
          </button>
        </div>

        <template v-if="current(index)">
          <p v-if="'error' in current(index)!" class="error" role="alert">The products could not be found: {{ (current(index) as { error: string }).error }}</p>
          <p v-else-if="(current(index) as { results: DealPreview[] }).results.length === 0" class="muted" role="status">
            Amazon finds no product of {{ categoryOf(search.searchIndex).toLowerCase() }} with {{ search.minSavingPercent }} % off at least for these keywords.
          </p>
          <ul v-else class="deal-results" :aria-label="`Products of search ${index + 1}`">
            <li v-for="deal in (current(index) as { results: DealPreview[] }).results" :key="deal.asin" class="deal-result">
              <span class="product-thumb">
                <img v-if="safeUrl(deal.product?.image)" :src="safeUrl(deal.product?.image)" alt="" loading="lazy" referrerpolicy="no-referrer" />
                <ImageOff v-else class="icon" aria-hidden="true" />
              </span>
              <span class="product-text">
                <a v-if="deal.product?.title && safeUrl(deal.product?.url)" :href="safeUrl(deal.product?.url)" target="_blank" rel="noopener noreferrer">{{ deal.product.title }}</a>
                <span v-else>{{ deal.product?.title ?? deal.asin }}</span>
                <code class="muted">{{ deal.asin }}</code>
              </span>
              <span v-if="flashSale(deal)" class="deal-flash">Flash sale</span>
              <span class="deal-saving">-{{ deal.savings }} %</span>
            </li>
          </ul>
        </template>
      </fieldset>

      <div class="deals-buttons">
        <button type="button" class="secondary" :disabled="!stuffing.editable || searches.length >= MAX_SEARCHES" @click="add">
          <Plus class="icon" aria-hidden="true" /> Add a search
        </button>
        <button type="submit" :disabled="saving || !stuffing.editable || !changed || !complete">Save the searches</button>
      </div>
    </form>
    <p v-if="!stuffing.editable" class="muted">Changing the searches requires Redis or <code>Admin.settingsFile</code>.</p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved.</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
  <p v-else class="muted" role="status">Loading…</p>
</template>
