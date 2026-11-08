<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getEffects, getThemeStats, UnauthorizedError, type EffectStats, type ThemeStats, type ThemeTest } from '../api';
import type { VariantStats } from '../effects';
import EffectForm from './EffectForm.vue';
import ThemeTestForm from './ThemeTestForm.vue';
import VariantComparison from './VariantComparison.vue';

const props = defineProps<{ days: number }>();
const emit = defineEmits<{ logout: [] }>();

const effects = ref<EffectStats[]>([]);
const themes = ref<ThemeStats[]>([]);
const themeTest = ref<ThemeTest | null>(null);
const error = ref('');

const effectRows = computed<VariantStats[]>(() => effects.value.map(({ effect, ...figures }) => ({ name: effect, ...figures })));
const themeRows = computed<VariantStats[]>(() => themes.value.map(({ theme, ...figures }) => ({ name: theme, ...figures })));

/** The preferred control group, or the first group when it was left out of the test. */
function controlOf(rows: VariantStats[], preferred: string): string {
  return rows.some(row => row.name === preferred) ? preferred : rows[0]?.name ?? preferred;
}

async function load(): Promise<void> {
  error.value = '';
  try {
    [effects.value, themes.value] = await Promise.all([getEffects(props.days), getThemeStats(props.days)]);
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
defineExpose({ load });
</script>

<template>
  <p v-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
  <p class="muted">
    Click-through rate per group over the period, unique views only. Decide once the period is over rather than as soon
    as a line looks good: looking early is how false winners get chosen.
  </p>

  <section class="card">
    <h2>Themes</h2>
    <ThemeTestForm @logout="emit('logout')" @change="themeTest = $event" />
    <VariantComparison
      v-if="themeRows.length > 0"
      :rows="themeRows"
      :control="controlOf(themeRows, themeTest?.defaultTheme ?? 'default')"
      label="Theme"
    />
    <p v-else class="muted">No theme test result over the period.</p>
  </section>

  <section class="card">
    <h2>Appearance effects</h2>
    <EffectForm @logout="emit('logout')" />
    <VariantComparison v-if="effectRows.length > 0" :rows="effectRows" :control="controlOf(effectRows, 'none')" label="Effect" />
    <p v-else class="muted">No effect result over the period.</p>
  </section>
</template>
