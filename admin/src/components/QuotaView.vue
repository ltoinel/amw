<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getDaily, UnauthorizedError, type DailyStats } from '../api';
import AmazonQuota from './AmazonQuota.vue';

const emit = defineEmits<{ logout: [] }>();

// Amazon grants the quota from the sales of the last 30 days, for the whole Associates account
const QUOTA_DAYS = 30;
const daily = ref<DailyStats[] | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    const days = await getDaily(QUOTA_DAYS);
    // An older server, or an unexpected answer, must not break the page
    if (!Array.isArray(days) || !days.every(day => typeof day?.date === 'string')) {
      throw new Error('The Amazon calls are not available on this server');
    }
    daily.value = days;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    error.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <p v-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
  <section v-else-if="daily" class="card">
    <h2>Amazon quota estimate</h2>
    <p class="muted">Every site together over the last {{ QUOTA_DAYS }} days: the quota belongs to the Associates account.</p>
    <AmazonQuota :daily="daily" />
  </section>
  <p v-else class="muted" role="status">Loading…</p>
</template>
