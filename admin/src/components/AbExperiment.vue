<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { ChevronRight, FlaskConical, Play, RotateCcw, Square, Timer } from '@lucide/vue';
import type { VariantStats } from '../effects';
import VariantComparison from './VariantComparison.vue';

/**
 * One thing the cards can vary (theme, effect or button label): either one value for the site,
 * applied as is, or an A/B test of several, ended by keeping one of them.
 */
const props = defineProps<{
  title: string;
  /** The column of the results table: "Theme", "Effect"… */
  noun: string;
  options: { id: string; label: string }[];
  /** The value of the site, or the one kept while its test runs. */
  value: string;
  testing: boolean;
  compared: string[];
  rows: VariantStats[];
  control: string;
  editable: boolean;
  /** The kind of the test running on the site, when it is another one. */
  blockedBy: string | null;
  /** The preview of a value: the URL of the sample card. */
  previewOf: (value: string) => string;
  busy: boolean;
  /** When the running test started (ISO date); older servers do not say. */
  startedAt?: string;
}>();
const emit = defineEmits<{ apply: [value: string]; start: [values: string[]]; stop: [kept: string] }>();

const chosen = ref(props.value);
const variants = ref<string[]>(props.testing && props.compared.length > 0 ? [...props.compared] : [props.value]);
// Reloading the frame plays an appearance effect again
const replay = ref(0);

// A new test starts from the value of the site; a running one shows its variants
watch(() => [props.value, props.testing, props.compared] as const, ([value, testing, compared]) => {
  chosen.value = value;
  variants.value = testing && compared.length > 0 ? [...compared] : [value];
});

// Ticks while a test runs, so that its duration stays current on a page left open
const now = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 30_000);
onUnmounted(() => clearInterval(clock));

/** "3 d 4 h", "5 h 12 min" or "8 min": precise enough to judge a test. */
const runningFor = computed(() => {
  const start = props.startedAt ? Date.parse(props.startedAt) : NaN;
  if (Number.isNaN(start)) return '';
  const minutes = Math.max(0, Math.floor((now.value - start) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes % 60} min`;
  return `${minutes} min`;
});
const startedOn = computed(() => (props.startedAt ? new Date(props.startedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : ''));

const labelOf = (id: string) => props.options.find(option => option.id === id)?.label ?? id;
const changed = computed(() => chosen.value !== props.value);
const startable = computed(() => props.editable && !props.blockedBy && variants.value.length >= 2);

function toggle(id: string): void {
  variants.value = variants.value.includes(id) ? variants.value.filter(other => other !== id) : [...variants.value, id];
}

function start(): void {
  // In the order of the options, whatever the order of the clicks
  emit('start', props.options.map(option => option.id).filter(id => variants.value.includes(id)));
}
</script>

<template>
  <!-- Folded by default: a running test opens its block, the one that needs watching -->
  <details class="card experiment" :open="testing || undefined">
    <summary class="experiment-head">
      <ChevronRight class="icon experiment-chevron" aria-hidden="true" />
      <h2>{{ title }}</h2>
      <span v-if="testing" class="experiment-status running"><FlaskConical class="icon" aria-hidden="true" /> A/B test running</span>
      <span v-else class="experiment-status">{{ labelOf(value) }}</span>
    </summary>

    <div class="experiment-body">
      <div class="experiment-preview">
        <iframe :key="`${chosen}-${replay}`" :src="previewOf(chosen)" :title="`Preview: ${labelOf(chosen)}`" />
        <button type="button" class="link-button" @click="replay++"><RotateCcw class="icon inline-icon" aria-hidden="true" /> Replay</button>
      </div>

      <div class="experiment-controls">
        <template v-if="!testing">
          <label class="experiment-field">
            {{ noun }} of the site
            <select v-model="chosen" :disabled="!editable || busy">
              <option v-for="option in options" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
          </label>
          <button type="button" :disabled="!editable || busy || !changed" @click="emit('apply', chosen)">Apply</button>
          <p v-if="!changed" class="muted hint">Shown on the site now.</p>

          <fieldset class="experiment-variants" :disabled="!editable || busy">
            <legend>A/B test: compare</legend>
            <div class="chips">
              <label v-for="option in options" :key="option.id" :class="['chip', { selected: variants.includes(option.id) }]">
                <input type="checkbox" :checked="variants.includes(option.id)" @change="toggle(option.id)" />
                {{ option.label }}<span v-if="option.id === value" class="muted"> (current)</span>
              </label>
            </div>
          </fieldset>
          <button type="button" class="secondary" :disabled="!startable || busy" @click="start">
            <Play class="icon" aria-hidden="true" /> Start the test
          </button>
          <p v-if="blockedBy" class="muted hint">A {{ blockedBy }} test runs on this site: one test at a time, so that their results do not mix.</p>
          <p v-else-if="variants.length < 2" class="muted hint">Choose two {{ noun.toLowerCase() }}s at least.</p>
        </template>

        <template v-else>
          <p>Each visitor gets one of: <strong>{{ compared.map(labelOf).join(', ') }}</strong>.</p>
          <p class="muted hint">Keep the best one in the results below; stopping keeps {{ labelOf(value) }}.</p>
          <div class="experiment-stop">
            <button type="button" class="secondary" :disabled="!editable || busy" @click="emit('stop', value)">
              <Square class="icon" aria-hidden="true" /> Stop the test
            </button>
            <span v-if="runningFor" class="experiment-timer" :title="`Started ${startedOn}`">
              <Timer class="icon" aria-hidden="true" /> Running for {{ runningFor }}
            </span>
          </div>
        </template>
      </div>
    </div>

    <VariantComparison
      v-if="rows.length > 0"
      :rows="rows"
      :control="control"
      :label="noun"
      :choosable="testing && editable"
      :busy="busy"
      @choose="emit('stop', $event)"
    />
    <p v-else class="muted">No test result over the period.</p>
  </details>
</template>
