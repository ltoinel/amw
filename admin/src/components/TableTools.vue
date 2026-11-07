<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight, Download } from '@lucide/vue';
import { MAX_ROWS } from '../api';
import { PAGE_SIZES } from '../tables';

// total: the rows matching the search; loaded: every row the server sent
const props = defineProps<{ total: number; loaded: number; page: number; pageCount: number; pageSize: number }>();
const emit = defineEmits<{ 'update:page': [page: number]; 'update:pageSize': [size: number]; export: [] }>();

const first = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const last = computed(() => Math.min(props.page * props.pageSize, props.total));
</script>

<template>
  <div class="table-tools">
    <button type="button" class="secondary" @click="emit('export')">
      <Download class="icon" aria-hidden="true" /> Export CSV
    </button>
    <span v-if="loaded >= MAX_ROWS" class="muted">Limited to the first {{ MAX_ROWS }} rows.</span>
    <label class="page-size muted">
      Rows per page
      <select :value="pageSize" @change="emit('update:pageSize', Number(($event.target as HTMLSelectElement).value))">
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
      </select>
    </label>
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
