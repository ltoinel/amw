<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight, Download } from '@lucide/vue';
import { MAX_ROWS } from '../api';

const props = defineProps<{ total: number; page: number; pageCount: number; pageSize: number }>();
const emit = defineEmits<{ 'update:page': [page: number]; export: [] }>();

const first = computed(() => (props.page - 1) * props.pageSize + 1);
const last = computed(() => Math.min(props.page * props.pageSize, props.total));
</script>

<template>
  <div class="table-tools">
    <button type="button" class="secondary" @click="emit('export')">
      <Download class="icon" aria-hidden="true" /> Export CSV
    </button>
    <span v-if="total >= MAX_ROWS" class="muted">Limited to the first {{ MAX_ROWS }} rows.</span>
    <nav v-if="pageCount > 1" class="pager" aria-label="Pages of the table">
      <span class="muted" aria-live="polite">{{ first }}–{{ last }} of {{ total }}</span>
      <button type="button" class="secondary" aria-label="Previous page" :disabled="page <= 1" @click="emit('update:page', page - 1)">
        <ChevronLeft class="icon" aria-hidden="true" />
      </button>
      <button type="button" class="secondary" aria-label="Next page" :disabled="page >= pageCount" @click="emit('update:page', page + 1)">
        <ChevronRight class="icon" aria-hidden="true" />
      </button>
    </nav>
  </div>
</template>
