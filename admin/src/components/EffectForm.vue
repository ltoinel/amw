<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getEffect, saveEffect, UnauthorizedError, type EffectSetting } from '../api';

const emit = defineEmits<{ logout: [] }>();

// Must match WIDGET_EFFECTS in src/server/Settings.ts
const EFFECTS: { id: string; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade in' },
  { id: 'slide', label: 'Slide up' },
  { id: 'zoom', label: 'Zoom in' },
  { id: 'pulse', label: 'Button pulse' }
];
const MODES = [...EFFECTS, { id: 'compare', label: 'A/B test of the effects below' }];

const setting = ref<EffectSetting | null>(null);
const mode = ref('none');
const effects = ref<string[]>([]);
const saving = ref(false);
const saved = ref(false);
const error = ref('');

// A comparison needs two groups; the server refuses less
const incomplete = computed(() => mode.value === 'compare' && effects.value.length < 2);

async function run(action: () => Promise<EffectSetting>): Promise<boolean> {
  error.value = '';
  try {
    setting.value = await action();
    mode.value = setting.value.mode;
    // Older servers compare all the effects
    effects.value = setting.value.effects ?? EFFECTS.map(effect => effect.id);
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

async function save(): Promise<void> {
  saving.value = true;
  saved.value = false;
  // In the order of the list, whatever the order of the clicks
  const chosen = EFFECTS.map(effect => effect.id).filter(id => effects.value.includes(id));
  saved.value = await run(() => saveEffect(mode.value, chosen));
  saving.value = false;
}

onMounted(() => run(getEffect));
</script>

<template>
  <div v-if="setting">
    <p class="muted">
      How a card appears when the visitor reaches it. The A/B test gives each tab session one of the selected effects at
      random; keep <code>none</code> in it as the control group. Visitors who prefer reduced motion see no effect and are
      left out of the measure.
    </p>
    <form class="stuffing-form" @submit.prevent="save">
      <label>
        Effect
        <select v-model="mode" :disabled="!setting.editable">
          <option v-for="option in MODES" :key="option.id" :value="option.id">{{ option.label }}</option>
        </select>
      </label>
      <fieldset v-if="mode === 'compare'" class="stuffing-mode" :disabled="!setting.editable">
        <legend>Effects compared (two at least)</legend>
        <label v-for="effect in EFFECTS" :key="effect.id" class="choice">
          <input v-model="effects" type="checkbox" :value="effect.id" />
          {{ effect.label }}
        </label>
      </fieldset>
      <button type="submit" :disabled="saving || !setting.editable || incomplete">Save</button>
    </form>
    <p v-if="!setting.editable" class="muted">Changing this setting requires Redis or <code>Admin.settingsFile</code>.</p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved. Pages pick it up within an hour, as <code>widget.js</code> is cached.</p>
  </div>
  <p v-else-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
</template>
