<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getEffect, saveEffect, UnauthorizedError, type EffectSetting } from '../api';

const emit = defineEmits<{ logout: [] }>();

const MODES: { id: string; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade in' },
  { id: 'slide', label: 'Slide up' },
  { id: 'zoom', label: 'Zoom in' },
  { id: 'pulse', label: 'Button pulse' },
  { id: 'compare', label: 'Compare them all' }
];

const setting = ref<EffectSetting | null>(null);
const mode = ref('none');
const saving = ref(false);
const saved = ref(false);
const error = ref('');

async function run(action: () => Promise<EffectSetting>): Promise<boolean> {
  error.value = '';
  try {
    setting.value = await action();
    mode.value = setting.value.mode;
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
  saved.value = await run(() => saveEffect(mode.value));
  saving.value = false;
}

onMounted(() => run(getEffect));
</script>

<template>
  <section v-if="setting" class="card">
    <h2>Appearance effect</h2>
    <p class="muted">
      How a card appears when the visitor reaches it. "Compare them all" gives each tab session one effect at random,
      no effect included, and the overview shows their click-through rates. Visitors who prefer reduced motion see no
      effect. A change reaches pages within an hour, as <code>widget.js</code> is cached.
    </p>
    <form class="stuffing-form" @submit.prevent="save">
      <label>
        Effect
        <select v-model="mode" :disabled="!setting.editable">
          <option v-for="option in MODES" :key="option.id" :value="option.id">{{ option.label }}</option>
        </select>
      </label>
      <button type="submit" :disabled="saving || !setting.editable">Save</button>
    </form>
    <p v-if="!setting.editable" class="muted">Changing this setting requires Redis.</p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved.</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
</template>
