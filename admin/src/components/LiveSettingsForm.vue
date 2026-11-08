<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getTunables, saveTunables, UnauthorizedError, type TunableValues, type Tunables } from '../api';

const emit = defineEmits<{ logout: []; saved: [] }>();

type NumberKey = 'httpCache' | 'rateLimit' | 'clickRateLimit' | 'viewRateLimit' | 'dailyLimit';
type FlagKey = 'recommendations' | 'fallback' | 'insights';

const NUMBERS: { key: NumberKey; label: string; config: string; min: number; max: number }[] = [
  { key: 'httpCache', label: 'HTTP cache (seconds)', config: 'Server.httpCache', min: 0, max: 86400 },
  { key: 'rateLimit', label: 'Product requests per IP and minute', config: 'Server.rateLimit', min: 1, max: 100000 },
  { key: 'clickRateLimit', label: 'Clicks per IP and minute', config: 'Server.clickRateLimit', min: 1, max: 100000 },
  { key: 'viewRateLimit', label: 'View reports per IP and minute', config: 'Server.viewRateLimit', min: 1, max: 100000 },
  { key: 'dailyLimit', label: 'Recommendations per day', config: 'Recommendation.dailyLimit', min: 1, max: 100000 },
];
const FLAGS: { key: FlagKey; label: string; config: string }[] = [
  { key: 'recommendations', label: 'Recommendations (Claude API)', config: 'Recommendation.enabled' },
  { key: 'fallback', label: 'Most clicked product on pages without one', config: 'Recommendation.fallback' },
  { key: 'insights', label: 'AI insights (Claude API)', config: 'Admin.insights' },
];

const setting = ref<Tunables | null>(null);
const values = ref<TunableValues | null>(null);
const saving = ref(false);
const saved = ref(false);
const error = ref('');

// The AI features need their credentials, checked at startup: the portal can only pause them
const lockedOff = (key: FlagKey) => (key === 'recommendations' || key === 'insights') && !setting.value?.configured[key];

const changed = computed(() => {
  if (!setting.value || !values.value) return {};
  const configured = setting.value.configured;
  const current = values.value;
  return Object.fromEntries((Object.keys(current) as (keyof TunableValues)[])
    .filter(key => current[key] !== configured[key])
    .map(key => [key, current[key]])) as Partial<TunableValues>;
});

async function run(action: () => Promise<Tunables>): Promise<boolean> {
  error.value = '';
  try {
    const answer = await action();
    // An older server answers without these settings: the card then stays hidden
    if (!answer?.configured || !answer.effective) {
      setting.value = null;
      return false;
    }
    setting.value = answer;
    values.value = { ...answer.effective };
    return true;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return false;
    }
    error.value = e instanceof Error ? e.message : String(e);
    return false;
  }
}

async function save(overrides: Partial<TunableValues>): Promise<void> {
  saving.value = true;
  saved.value = false;
  saved.value = await run(() => saveTunables(overrides));
  saving.value = false;
  if (saved.value) emit('saved');
}

onMounted(() => run(getTunables));
</script>

<template>
  <section v-if="setting && values" class="card">
    <h2>Live settings</h2>
    <p class="muted">
      These settings override the configuration file while the server runs, and reach every server process within a
      minute; <code>widget.js</code> and the products stay cached for up to their HTTP cache. A value equal to the
      file's follows the file again.
    </p>
    <form class="stuffing-form" @submit.prevent="save(changed)">
      <label>
        Default theme
        <select v-model="values.theme" :disabled="!setting.editable">
          <option v-for="theme in setting.themes" :key="theme" :value="theme">{{ theme }}</option>
        </select>
        <span class="muted hint">File: {{ setting.configured.theme }} (<code>Server.theme</code>)</span>
      </label>
      <label v-for="field in NUMBERS" :key="field.key">
        {{ field.label }}
        <input v-model.number="values[field.key]" type="number" :min="field.min" :max="field.max" step="1" required :disabled="!setting.editable" />
        <span class="muted hint">File: {{ setting.configured[field.key] }} (<code>{{ field.config }}</code>)</span>
      </label>
      <fieldset class="stuffing-mode" :disabled="!setting.editable">
        <legend>Features</legend>
        <label v-for="flag in FLAGS" :key="flag.key" class="choice">
          <input v-model="values[flag.key]" type="checkbox" role="switch" :disabled="lockedOff(flag.key)" />
          <span>{{ flag.label }}<span v-if="lockedOff(flag.key)" class="muted">: off in the configuration (<code>{{ flag.config }}</code>)</span></span>
        </label>
      </fieldset>
      <button type="submit" :disabled="saving || !setting.editable">Save</button>
      <button type="button" class="secondary" :disabled="saving || !setting.editable || Object.keys(setting.overrides).length === 0" @click="save({})">
        Back to the configuration
      </button>
    </form>
    <p v-if="!setting.editable" class="muted">Changing these settings requires Redis or <code>Admin.settingsFile</code>.</p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved.</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
</template>
