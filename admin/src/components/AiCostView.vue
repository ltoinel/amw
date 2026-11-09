<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getLlmUsage, UnauthorizedError, type LlmUsage, type Period } from '../api';
import LlmCosts from './LlmCosts.vue';

// Every site together: the Claude calls are billed to one Anthropic account
const props = defineProps<{ days: Period }>();
const emit = defineEmits<{ logout: [] }>();

const usage = ref<LlmUsage[] | null>(null);
const error = ref('');

async function load(): Promise<void> {
  error.value = '';
  try {
    usage.value = await getLlmUsage(props.days);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    error.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(load);
watch(() => props.days, load);
</script>

<template>
  <p v-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
  <section v-else-if="usage" class="card ai-cost">
    <h2>Estimated AI cost</h2>
    <p class="muted">Every site together: recommendations and insights are billed to the Anthropic account of the server.</p>
    <LlmCosts v-if="usage.length > 0" :usage="usage" />
    <p v-else class="muted">No call to Claude over the period: recommendations and insights are billed when they call it.</p>
  </section>
  <p v-else class="muted" role="status">Loading…</p>
</template>
