<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getStuffing, saveStuffing, UnauthorizedError, type Stuffing, type StuffingMode } from '../api';

const emit = defineEmits<{ logout: [] }>();

const stuffing = ref<Stuffing | null>(null);
const count = ref(0);
const mode = ref<StuffingMode>('recommendation');
const containerId = ref('');
const products = ref('');
const wordsPerCard = ref(0);
// By host; an empty field leaves the site on the default number
const siteCounts = ref<Record<string, number | ''>>({});
const saving = ref(false);
const saved = ref(false);
const error = ref('');

function show(values: Stuffing): void {
  stuffing.value = values;
  count.value = values.count;
  // Older servers have no modes: their cards are recommendations
  mode.value = values.mode ?? 'recommendation';
  containerId.value = values.containerId;
  products.value = (values.products ?? []).join('\n');
  // Older servers have neither the ratio nor the numbers per site
  wordsPerCard.value = values.wordsPerCard ?? 0;
  siteCounts.value = Object.fromEntries(sites(values).map(site => [site, values.sites?.[site] ?? '']));
}

/** The sites served, and those set before they left the list, so that they can be cleared. */
function sites(values: Stuffing): string[] {
  return [...new Set([...(values.allowedSites ?? []), ...Object.keys(values.sites ?? {})])];
}

const siteList = computed(() => (stuffing.value ? sites(stuffing.value) : []));

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

async function save(): Promise<void> {
  saving.value = true;
  saved.value = false;
  // One ASIN per line, or separated by commas or spaces; the server validates them
  const asins = products.value.split(/[\s,]+/).map(asin => asin.trim().toUpperCase()).filter(Boolean);
  const ownNumbers = Object.entries(siteCounts.value)
    .filter(([, cards]) => cards !== '' && cards !== null)
    .map(([site, cards]) => [site, Number(cards)]);
  saved.value = await run(() => saveStuffing({
    count: Number(count.value),
    mode: mode.value,
    containerId: containerId.value,
    products: asins,
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
      article, Stuffing adds 2. 0 adds none. A change reaches pages within an hour, as <code>widget.js</code> is cached.
    </p>
    <form class="stuffing-form" @submit.prevent="save">
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
      <fieldset class="stuffing-mode" :disabled="!stuffing.editable">
        <legend>Products of the cards</legend>
        <label class="choice">
          <input v-model="mode" type="radio" name="stuffing-mode" value="recommendation" />
          Recommendations for the page content
        </label>
        <label class="choice">
          <input v-model="mode" type="radio" name="stuffing-mode" value="manual" />
          Manual list below
        </label>
      </fieldset>
      <label>
        Article container (HTML id)
        <input v-model="containerId" type="text" pattern="[A-Za-z][\w\-]{0,63}" required :disabled="!stuffing.editable" />
      </label>
      <label class="products">
        Products (ASINs, one per line)
        <textarea v-model="products" rows="4" spellcheck="false" placeholder="B084DN3XVN" :disabled="!stuffing.editable"></textarea>
        <span v-if="mode === 'manual'" class="muted">The first card shows the first product, the second card the second one, and so on. 20 at most.</span>
        <span v-else class="muted">A card without a product chosen for its page shows these, in order, then the most clicked products of the site. 20 at most.</span>
      </label>
      <button type="submit" :disabled="saving || !stuffing.editable">Save</button>
    </form>
    <p v-if="!stuffing.editable" class="muted">Changing these settings requires Redis.</p>
    <p v-if="mode === 'recommendation' && !stuffing.recommendationEnabled" class="muted">
      Recommended cards need <code>Recommendation.enabled</code>: enable it, or choose the manual list.
    </p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved.</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
</template>
