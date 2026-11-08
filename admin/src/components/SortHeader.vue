<script setup lang="ts">
import { ArrowDown } from '@lucide/vue';

// A column header that ranks the rows of its table, best first
defineProps<{ label: string; active: boolean; numeric?: boolean }>();
const emit = defineEmits<{ sort: [] }>();
</script>

<template>
  <th scope="col" :class="{ num: numeric }" :aria-sort="active ? 'descending' : 'none'">
    <button type="button" class="sort" :class="{ active }" @click="emit('sort')">
      {{ label }}<ArrowDown v-if="active" class="icon" aria-hidden="true" />
    </button>
  </th>
</template>
