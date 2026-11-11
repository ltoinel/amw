<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { CircleAlert, RotateCcw } from '@lucide/vue';
import {
  getButtonLabel, getEffect, getEffects, getLabelStats, getThemeStats, getThemeTest, saveButtonLabel, saveEffect, saveThemeTest,
  UnauthorizedError, type ButtonLabel, type ButtonLabelSetting, type EffectSetting, type Period, type ThemeTest
} from '../api';
import type { VariantStats } from '../effects';
import AbExperiment from './AbExperiment.vue';

const props = defineProps<{ days: Period }>();
const emit = defineEmits<{ logout: [] }>();

// Must match WIDGET_THEMES, WIDGET_EFFECTS and BUTTON_LABELS in src/server/Settings.ts
const THEMES = ['default', 'native', 'shelf', 'receipt', 'blueprint', 'outdoor', 'terminal', 'magazine', 'pastel', 'neon', 'denim', 'leather', 'canvas', 'alpine', 'christmas', 'halloween', 'blackfriday']
  .map(id => ({ id, label: id }));
const EFFECTS = [
  { id: 'none', label: 'None' }, { id: 'fade', label: 'Fade in' }, { id: 'slide', label: 'Slide up' },
  { id: 'zoom', label: 'Zoom in' }, { id: 'pulse', label: 'Button pulse' }
];
const LABELS: { id: ButtonLabel; label: string }[] = [
  { id: 'offer', label: 'See the offer on Amazon' }, { id: 'price', label: 'Check the price on Amazon' },
  { id: 'view', label: 'View on Amazon' }, { id: 'buy', label: 'Buy on Amazon' }
];

const theme = ref<ThemeTest | null>(null);
const effect = ref<EffectSetting | null>(null);
const label = ref<ButtonLabelSetting | null>(null);
const themeRows = ref<VariantStats[]>([]);
const effectRows = ref<VariantStats[]>([]);
const labelRows = ref<VariantStats[]>([]);
const busy = ref(false);
const error = ref('');

// The value each one keeps while its test runs, and once it stops
const themeValue = computed(() => theme.value?.theme ?? theme.value?.defaultTheme ?? 'default');
// A running effect test keeps no single effect: "none" is the control
const effectValue = computed(() => (effect.value && effect.value.mode !== 'compare' ? effect.value.mode : 'none'));
const labelValue = computed(() => label.value?.label ?? 'offer');

const running = computed(() => {
  if (theme.value?.mode === 'compare') return 'theme';
  if (effect.value?.mode === 'compare') return 'effect';
  if (label.value?.mode === 'compare') return 'label';
  return null;
});
const blockedBy = (kind: string) => (running.value && running.value !== kind ? running.value : null);

// What the preview shows: the values chosen in the blocks, those of the site until then
const shown = ref<{ theme?: string; effect?: string; label?: string }>({});
// Reloading the frame plays an appearance effect again
const replay = ref(0);
const previewUrl = computed(() => `preview?${new URLSearchParams({
  theme: shown.value.theme ?? themeValue.value,
  effect: shown.value.effect ?? effectValue.value,
  label: shown.value.label ?? labelValue.value,
  lang: 'en'
})}`);

const rowsOf = <T extends Omit<VariantStats, 'name'>>(stats: T[], name: (row: T) => string) =>
  stats.map(row => ({ name: name(row), views: row.views, clicks: row.clicks, ctr: row.ctr, daily: row.daily }));

function fail(e: unknown): void {
  if (e instanceof UnauthorizedError) {
    emit('logout');
    return;
  }
  error.value = e instanceof Error ? e.message : String(e);
}

async function loadStats(): Promise<void> {
  try {
    const [themes, effects, labels] = await Promise.all([getThemeStats(props.days), getEffects(props.days), getLabelStats(props.days)]);
    themeRows.value = rowsOf(themes, row => row.theme);
    effectRows.value = rowsOf(effects, row => row.effect);
    labelRows.value = rowsOf(labels, row => row.label);
  } catch (e) {
    fail(e);
  }
}

async function load(): Promise<void> {
  error.value = '';
  try {
    [theme.value, effect.value, label.value] = await Promise.all([getThemeTest(), getEffect(), getButtonLabel()]);
  } catch (e) {
    fail(e);
    return;
  }
  await loadStats();
}

/** Runs a change, then shows what the server kept. */
async function change(action: () => Promise<unknown>): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await action();
    [theme.value, effect.value, label.value] = await Promise.all([getThemeTest(), getEffect(), getButtonLabel()]);
  } catch (e) {
    fail(e);
  } finally {
    busy.value = false;
  }
}

/** "none" when it was in the test, the first effect otherwise: a test without a control has none. */
const effectControl = computed(() => (effectRows.value.some(row => row.name === 'none') ? 'none' : effectRows.value[0]?.name ?? 'none'));

const allEffects = () => effect.value?.effects ?? EFFECTS.map(option => option.id);

onMounted(load);
watch(() => props.days, loadStats);
defineExpose({ load });
</script>

<template>
  <p v-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
  <p class="muted">
    Choose how the cards of this site look, or compare a few in an A/B test: each visitor gets one of them, and the
    click-through rate of each tells which works best. One test at a time, and decide once the period is over: looking
    early is how false winners get chosen. The preview shows the values chosen below before you apply them.
  </p>

  <section v-if="theme && effect && label" class="card design-preview">
    <iframe :key="`${previewUrl}-${replay}`" :src="previewUrl" title="Preview of a card with the theme, effect and label chosen below" />
    <button type="button" class="link-button" @click="replay++"><RotateCcw class="icon inline-icon" aria-hidden="true" /> Replay the effect</button>
  </section>

  <AbExperiment
    v-if="theme"
    title="Theme"
    noun="Theme"
    :options="THEMES"
    :value="themeValue"
    :testing="theme.mode === 'compare'"
    :compared="theme.themes"
    :rows="themeRows"
    :control="themeValue"
    :editable="theme.editable"
    :blocked-by="blockedBy('theme')"
    @preview="value => (shown.theme = value)"
    :busy="busy"
    :started-at="theme.startedAt"
    @apply="value => change(() => saveThemeTest('off', [], value))"
    @start="values => change(() => saveThemeTest('compare', values, themeValue))"
    @stop="kept => change(() => saveThemeTest('off', [], kept))"
  />

  <AbExperiment
    v-if="effect"
    title="Appearance effect"
    noun="Effect"
    :options="EFFECTS"
    :value="effectValue"
    :testing="effect.mode === 'compare'"
    :compared="effect.mode === 'compare' ? effect.effects : []"
    :rows="effectRows"
    :control="effectControl"
    :editable="effect.editable"
    :blocked-by="blockedBy('effect')"
    @preview="value => (shown.effect = value)"
    :busy="busy"
    :started-at="effect.startedAt"
    @apply="value => change(() => saveEffect(value, allEffects()))"
    @start="values => change(() => saveEffect('compare', values))"
    @stop="kept => change(() => saveEffect(kept, allEffects()))"
  />

  <AbExperiment
    v-if="label"
    title="Button label"
    noun="Label"
    :options="LABELS"
    :value="labelValue"
    :testing="label.mode === 'compare'"
    :compared="label.mode === 'compare' ? label.labels : []"
    :rows="labelRows"
    :control="labelValue"
    :editable="label.editable"
    :blocked-by="blockedBy('label')"
    @preview="value => (shown.label = value)"
    :busy="busy"
    :started-at="label.startedAt"
    @apply="value => change(() => saveButtonLabel(value as ButtonLabel, 'off', []))"
    @start="values => change(() => saveButtonLabel(labelValue, 'compare', values as ButtonLabel[]))"
    @stop="kept => change(() => saveButtonLabel(kept as ButtonLabel, 'off', []))"
  />
</template>
