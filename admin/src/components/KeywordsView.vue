<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CircleAlert, Info } from '@lucide/vue';
import {
  getRecommendations, productUrlOfPage, safeUrl, UnauthorizedError, updateRecommendation,
  type RecommendationEntry
} from '../api';

const emit = defineEmits<{ logout: [] }>();

const MAX_LENGTH = 100;

const loading = ref(true);
const error = ref('');
const unavailable = ref('');
const items = ref<RecommendationEntry[]>([]);
const total = ref(0);
const search = ref('');
// What is being typed, by page: kept apart from what is saved to know what changed
const drafts = ref<Record<string, string>>({});
const saving = ref('');
const saved = ref('');
const rowErrors = ref<Record<string, string>>({});

const shown = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return items.value;
  return items.value.filter(item => [item.url, item.title, item.product ?? ''].some(text => text.toLowerCase().includes(needle)));
});

const isDirty = (item: RecommendationEntry) => (drafts.value[item.hash] ?? '').trim() !== (item.product ?? '');

function handle(e: unknown, show: (message: string) => void): void {
  if (e instanceof UnauthorizedError) {
    emit('logout');
    return;
  }
  show(e instanceof Error ? e.message : String(e));
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const response = await getRecommendations();
    if (!response.available) {
      unavailable.value = response.reason;
      return;
    }
    items.value = response.items;
    total.value = response.total;
    drafts.value = Object.fromEntries(response.items.map(item => [item.hash, item.product ?? '']));
  } catch (e) {
    handle(e, message => { error.value = message; });
  } finally {
    loading.value = false;
  }
}

async function save(item: RecommendationEntry): Promise<void> {
  if (!isDirty(item) || saving.value) return;
  saving.value = item.hash;
  saved.value = '';
  rowErrors.value = { ...rowErrors.value, [item.hash]: '' };
  try {
    const updated = await updateRecommendation(item.hash, (drafts.value[item.hash] ?? '').trim() || null);
    items.value = items.value.map(entry => (entry.hash === item.hash ? updated : entry));
    // The server may have cleaned the text
    drafts.value = { ...drafts.value, [item.hash]: updated.product ?? '' };
    saved.value = item.hash;
  } catch (e) {
    handle(e, message => { rowErrors.value = { ...rowErrors.value, [item.hash]: message }; });
  } finally {
    saving.value = '';
  }
}

onMounted(load);
</script>

<template>
  <p v-if="loading" class="muted" role="status">Loading…</p>

  <p v-else-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>

  <section v-else-if="unavailable" class="card notice">
    <h2><Info class="icon" aria-hidden="true" /> Keywords are not available</h2>
    <p>{{ unavailable }}</p>
  </section>

  <section v-else class="card">
    <p class="muted">
      Pages with a widget without an <code>id</code>, and the Amazon search that fills it, most recent first.
      Empty the keywords if the page should have no chosen product: it then shows the most clicked product of its site, if any.
    </p>
    <p v-if="items.length === 0" class="muted">No page has requested a recommendation yet.</p>
    <template v-else>
      <label class="filter">
        Search
        <input v-model="search" type="search" placeholder="Page, title or keywords" />
      </label>
      <p v-if="total > items.length" class="muted">Showing the {{ items.length }} most recent pages out of {{ total }}.</p>
      <p v-if="shown.length === 0" class="muted">No page matches this search.</p>
      <div v-else class="table-wrapper">
        <table class="keywords">
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Keywords</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in shown" :key="item.hash">
              <td class="page">
                <a v-if="safeUrl(item.url)" :href="safeUrl(item.url)" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
                <span v-else>{{ item.title }}</span>
                <br />
                <span class="muted">{{ item.url }}</span>
              </td>
              <td>
                <form class="keywords-edit" @submit.prevent="save(item)">
                  <input
                    v-model="drafts[item.hash]"
                    type="text"
                    :maxlength="MAX_LENGTH"
                    placeholder="No chosen product"
                    :aria-label="`Keywords for ${item.title}`"
                  />
                  <button type="submit" :disabled="!isDirty(item) || saving !== ''">{{ saving === item.hash ? 'Saving…' : 'Save' }}</button>
                </form>
                <p class="keywords-meta muted">
                  <template v-if="item.editedAt">
                    Edited {{ new Date(item.editedAt).toLocaleDateString() }}. AI suggested: {{ item.suggested ?? 'no product' }}.
                  </template>
                  <template v-else>{{ item.product ? 'Chosen by AI' : 'No product suggested by AI' }} on {{ new Date(item.createdAt).toLocaleDateString() }}.</template>
                  <a v-if="item.searchUrl && safeUrl(item.searchUrl)" :href="safeUrl(item.searchUrl)" target="_blank" rel="noopener noreferrer">Check on Amazon</a>
                </p>
                <p v-if="rowErrors[item.hash]" class="error" role="alert">{{ rowErrors[item.hash] }}</p>
                <p v-if="saved === item.hash" class="keywords-saved" role="status">
                  Saved. Visitors can keep the previous product for up to 24 h. To apply it now, purge this URL in your CDN:
                  <code>{{ productUrlOfPage(item.hash) }}</code>
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
