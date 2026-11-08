<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getStuffing, saveStuffing, UnauthorizedError, type Stuffing, type StuffingMode } from '../api';

const emit = defineEmits<{ logout: [] }>();

const stuffing = ref<Stuffing | null>(null);
const count = ref(0);
const mode = ref<StuffingMode>('recommendation');
const containerId = ref('');
const products = ref('');
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

async function save(): Promise<void> {
  saving.value = true;
  saved.value = false;
  // One ASIN per line, or separated by commas or spaces; the server validates them
  const asins = products.value.split(/[\s,]+/).map(asin => asin.trim().toUpperCase()).filter(Boolean);
  saved.value = await run(() => saveStuffing(Number(count.value), mode.value, containerId.value, asins));
  saving.value = false;
}

onMounted(() => run(getStuffing));
</script>

<template>
  <section v-if="stuffing" class="card">
    <h2>Stuffing</h2>
    <p class="muted">
      Stuffing adds cards at the end of a paragraph, before a heading of the article, each with a different
      product. 0 adds none. A change reaches pages within an hour, as <code>widget.js</code> is cached.
    </p>
    <form class="stuffing-form" @submit.prevent="save">
      <label>
        Number of cards
        <input v-model.number="count" type="number" min="0" max="5" step="1" required :disabled="!stuffing.editable" />
      </label>
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
