<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getStuffing, saveStuffing, UnauthorizedError, type Stuffing } from '../api';

const emit = defineEmits<{ logout: [] }>();

const stuffing = ref<Stuffing | null>(null);
const count = ref(0);
const containerId = ref('');
const saving = ref(false);
const saved = ref(false);
const error = ref('');

function show(values: Stuffing): void {
  stuffing.value = values;
  count.value = values.count;
  containerId.value = values.containerId;
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
  saved.value = await run(() => saveStuffing(Number(count.value), containerId.value));
  saving.value = false;
}

onMounted(() => run(getStuffing));
</script>

<template>
  <section v-if="stuffing" class="card">
    <h2>Stuffing</h2>
    <p class="muted">
      Stuffing adds cards at the end of a paragraph, before a heading of the article, each with a different
      recommended product. 0 adds none. A change reaches pages within an hour, as <code>widget.js</code> is cached.
    </p>
    <form class="stuffing-form" @submit.prevent="save">
      <label>
        Number of cards
        <input v-model.number="count" type="number" min="0" max="5" step="1" required :disabled="!stuffing.editable" />
      </label>
      <label>
        Article container (HTML id)
        <input v-model="containerId" type="text" pattern="[A-Za-z][\w\-]{0,63}" required :disabled="!stuffing.editable" />
      </label>
      <button type="submit" :disabled="saving || !stuffing.editable">Save</button>
    </form>
    <p v-if="!stuffing.editable" class="muted">Changing these settings requires Redis.</p>
    <p v-if="!stuffing.recommendationEnabled" class="muted">
      Cards show recommended products: enable <code>Recommendation.enabled</code> first.
    </p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved.</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
</template>
