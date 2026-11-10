<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowDown, ArrowUp, CircleAlert, ImageOff, Plus, Trash2 } from '@lucide/vue';
import {
  getStuffing, previewProducts, safeUrl, saveStuffingProducts, UnauthorizedError,
  type ProductPreview, type Stuffing
} from '../api';
import { activeSite } from '../site';

const emit = defineEmits<{ logout: [] }>();

// Same rules as the server
const ASIN = /^[A-Z0-9]{10}$/;
const MAX_PRODUCTS = 20;
// What the list does depends on the source of the Stuffing cards
const USES: Record<string, string> = {
  manual: 'The Stuffing cards show these products: the first card the first one, the second card the second one, and so on.',
  popular: 'The Stuffing cards show them after the most clicked products of the site, while it has too few clicks.',
  recommendation: 'A Stuffing card without a product chosen by the AI for its page shows these, in order, then the most clicked products of the site.',
  deals: 'The Stuffing cards show the best deals: this list is kept for when you choose another source.'
};

const stuffing = ref<Stuffing | null>(null);
const products = ref<string[]>([]);
const newAsin = ref('');
const saving = ref(false);
const saved = ref(false);
const error = ref('');
// By ASIN: what Amazon returns, kept across saves so that a product is looked up once
const previews = ref<Record<string, ProductPreview>>({});
const previewError = ref('');

const candidate = computed(() => newAsin.value.trim().toUpperCase());
const candidateError = computed(() => {
  if (candidate.value === '') return '';
  if (!ASIN.test(candidate.value)) return 'An ASIN has 10 letters or digits, such as B084DN3XVN.';
  if (products.value.includes(candidate.value)) return 'This product is already in the list.';
  return '';
});
const full = computed(() => products.value.length >= MAX_PRODUCTS);
const changed = computed(() => stuffing.value !== null && products.value.join() !== stuffing.value.products.join());
const use = computed(() => (stuffing.value ? USES[stuffing.value.mode] ?? '' : ''));

function fail(e: unknown): void {
  if (e instanceof UnauthorizedError) {
    emit('logout');
    return;
  }
  error.value = e instanceof Error ? e.message : String(e);
}

function show(values: Stuffing): void {
  stuffing.value = values;
  products.value = [...(values.products ?? [])];
  void preview(products.value);
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
  const asin = candidate.value;
  products.value.push(asin);
  newAsin.value = '';
  saved.value = false;
  void preview([asin]);
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
  error.value = '';
  try {
    show(await saveStuffingProducts(products.value));
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
    <h2>Custom products ({{ products.length }}/{{ MAX_PRODUCTS }})</h2>
    <p class="muted">
      The products you choose for {{ activeSite || 'every site' }}. {{ use }}
      A new product is looked up on Amazon, which uses one call of the quota when it is not in the cache.
    </p>
    <p v-if="stuffing.own === false" class="muted site-inherit">
      {{ activeSite }} uses the Stuffing of every site: saving gives it its own settings, which the other sites keep apart from.
    </p>

    <form class="stuffing-form" @submit.prevent="save">
      <fieldset class="stuffing-products" :disabled="!stuffing.editable">
        <legend class="visually-hidden">Products, in order</legend>
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
        <p v-else class="muted">No product yet: add one with its ASIN, the 10 characters after <code>/dp/</code> in its Amazon address.</p>
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

      <button type="submit" :disabled="saving || !stuffing.editable || !changed">Save the list</button>
    </form>
    <p v-if="!stuffing.editable" class="muted">Changing the list requires Redis or <code>Admin.settingsFile</code>.</p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved.</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
  <p v-else class="muted" role="status">Loading…</p>
</template>
