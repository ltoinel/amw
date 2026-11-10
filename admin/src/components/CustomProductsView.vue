<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowDown, ArrowUp, CircleAlert, ImageOff, Megaphone, Plus, Trash2 } from '@lucide/vue';
import {
  getStuffing, previewProducts, safeUrl, saveStuffingProducts, UnauthorizedError,
  type Banner, type ProductPreview, type Stuffing
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
  deals: 'The Stuffing cards show the best deals: this list is kept for when you choose another source.',
  mix: 'The cards drawn from the custom list show these products in order; the other sources show them when they have none.'
};

const stuffing = ref<Stuffing | null>(null);
const products = ref<string[]>([]);
// Cards of the site's own, outside Amazon: the list names them banner:<id>
const banners = ref<Banner[]>([]);
const BANNER_PREFIX = 'banner:';
const BANNER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const isBanner = (item: string) => item.startsWith(BANNER_PREFIX);
const bannerOf = (item: string) => banners.value.find(banner => `${BANNER_PREFIX}${banner.id}` === item);
const newBanner = ref<Banner>({ id: '', title: '', image: '', url: '', label: '' });
const addingBanner = ref(false);
/** Same rules as the server: an id, a title, an https image and a web link. */
const bannerError = computed(() => {
  const banner = newBanner.value;
  if (!BANNER_ID.test(banner.id)) return 'The id has lowercase letters, digits and dashes, such as newsletter.';
  if (banners.value.some(other => other.id === banner.id)) return 'Another banner has this id.';
  if (!banner.title.trim()) return 'Give the banner a title.';
  if (/[<>]/.test(banner.title + (banner.label ?? ''))) return 'The texts cannot hold < or >.';
  if (!/^https:\/\//.test(banner.image)) return 'The image needs an https address.';
  if (!/^https?:\/\//.test(banner.url)) return 'The link needs a web address.';
  return '';
});
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
const changed = computed(() => stuffing.value !== null && (products.value.join() !== stuffing.value.products.join()
  || JSON.stringify(banners.value) !== JSON.stringify(stuffing.value.banners ?? [])));
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
  banners.value = (values.banners ?? []).map(banner => ({ ...banner }));
  void preview(products.value.filter(item => !isBanner(item)));
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
  const [item] = products.value.splice(index, 1);
  if (isBanner(item)) banners.value = banners.value.filter(banner => `${BANNER_PREFIX}${banner.id}` !== item);
  saved.value = false;
}

function addBanner(): void {
  if (bannerError.value || full.value) return;
  const { label, ...banner } = newBanner.value;
  banners.value.push({ ...banner, title: banner.title.trim(), ...(label?.trim() ? { label: label.trim() } : {}) });
  products.value.push(`${BANNER_PREFIX}${banner.id}`);
  newBanner.value = { id: '', title: '', image: '', url: '', label: '' };
  addingBanner.value = false;
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
    show(await saveStuffingProducts(products.value, stuffing.value?.banners !== undefined ? banners.value : undefined));
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
          <li v-for="(asin, index) in products" :key="asin" :class="['product-row', { 'banner-row': isBanner(asin) }]">
            <template v-if="isBanner(asin)">
              <span class="product-thumb">
                <img v-if="safeUrl(bannerOf(asin)?.image)" :src="safeUrl(bannerOf(asin)?.image)" alt="" loading="lazy" referrerpolicy="no-referrer" />
                <Megaphone v-else class="icon" aria-hidden="true" />
              </span>
              <span class="product-text">
                <a v-if="safeUrl(bannerOf(asin)?.url)" :href="safeUrl(bannerOf(asin)?.url)" target="_blank" rel="noopener noreferrer">{{ bannerOf(asin)?.title }}</a>
                <span class="banner-meta muted"><span class="banner-tag">Banner</span> outside Amazon · <code>{{ asin.slice(BANNER_PREFIX.length) }}</code></span>
              </span>
            </template>
            <template v-else>
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
            </template>
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

        <template v-if="stuffing.banners !== undefined">
          <button v-if="!addingBanner" type="button" class="link-button add-banner" :disabled="full" @click="addingBanner = true">
            <Megaphone class="icon inline-icon" aria-hidden="true" /> Add a banner of your own, outside Amazon
          </button>
          <fieldset v-else class="banner-form">
            <legend>New banner: no price, no #Amazon ribbon and no affiliate disclosure</legend>
            <label>Id <input v-model.trim="newBanner.id" type="text" maxlength="32" placeholder="newsletter" spellcheck="false" /></label>
            <label class="banner-wide">Title <input v-model="newBanner.title" type="text" maxlength="150" placeholder="Join the newsletter" /></label>
            <label class="banner-wide">Image (https) <input v-model.trim="newBanner.image" type="url" maxlength="1000" placeholder="https://www.example.com/banner.png" /></label>
            <label class="banner-wide">Link <input v-model.trim="newBanner.url" type="url" maxlength="1000" placeholder="https://www.example.com/newsletter" /></label>
            <label>Button (optional) <input v-model="newBanner.label" type="text" maxlength="40" placeholder="Learn more" /></label>
            <div class="banner-buttons">
              <button type="button" class="secondary" :disabled="bannerError !== ''" @click="addBanner"><Plus class="icon" aria-hidden="true" /> Add the banner</button>
              <button type="button" class="link-button" @click="addingBanner = false">Cancel</button>
            </div>
            <p v-if="bannerError && (newBanner.id || newBanner.title || newBanner.image || newBanner.url)" class="muted hint">{{ bannerError }}</p>
          </fieldset>
        </template>
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
