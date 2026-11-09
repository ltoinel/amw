<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getThemeTest, saveThemeTest, UnauthorizedError, type ThemeTest } from '../api';

const emit = defineEmits<{ logout: []; change: [ThemeTest] }>();

// Must match WIDGET_THEMES in src/server/Settings.ts
const THEMES = ['default', 'native', 'shelf', 'receipt', 'blueprint', 'outdoor', 'terminal', 'magazine', 'pastel', 'neon', 'denim', 'leather', 'canvas', 'alpine', 'christmas', 'halloween', 'blackfriday'];

const setting = ref<ThemeTest | null>(null);
const enabled = ref(false);
const themes = ref<string[]>([]);
const saving = ref(false);
const saved = ref(false);
const error = ref('');

const incomplete = computed(() => enabled.value && themes.value.length < 2);

async function run(action: () => Promise<ThemeTest>): Promise<boolean> {
  error.value = '';
  try {
    setting.value = await action();
    enabled.value = setting.value.mode === 'compare';
    // The site's theme first, as the control group
    themes.value = setting.value.themes.length > 0 ? setting.value.themes : [setting.value.defaultTheme];
    emit('change', setting.value);
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
  const chosen = THEMES.filter(theme => themes.value.includes(theme));
  saved.value = await run(() => saveThemeTest(enabled.value ? 'compare' : 'off', chosen));
  saving.value = false;
}

onMounted(() => run(getThemeTest));
</script>

<template>
  <div v-if="setting">
    <p class="muted">
      The A/B test gives each tab session one of the selected themes at random, in place of the theme of the site
      (<code>{{ setting.defaultTheme }}</code>, the control group) and of <code>data-theme</code>. A page that sets its
      theme with <code>AmwWidget.setApiConfig</code> is left out of the measure.
    </p>
    <form class="stuffing-form" @submit.prevent="save">
      <label class="choice">
        <input v-model="enabled" type="checkbox" role="switch" :disabled="!setting.editable" />
        Compare themes
      </label>
      <fieldset v-if="enabled" class="stuffing-mode" :disabled="!setting.editable">
        <legend>Themes compared (two at least)</legend>
        <label v-for="theme in THEMES" :key="theme" class="choice">
          <input v-model="themes" type="checkbox" role="switch" :value="theme" />
          {{ theme }}<span v-if="theme === setting.defaultTheme" class="muted">(control)</span>
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
