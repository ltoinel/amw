<script setup lang="ts">
import { Search } from '@lucide/vue';

defineProps<{ placeholder: string; matches: number; loaded: number }>();
const query = defineModel<string>({ required: true });
</script>

<template>
  <div class="table-search">
    <Search class="icon" aria-hidden="true" />
    <input v-model="query" type="search" :placeholder="placeholder" aria-label="Search the table" spellcheck="false" />
    <span v-if="query.trim()" class="muted" aria-live="polite">{{ matches }} of {{ loaded }} rows</span>
  </div>
</template>
