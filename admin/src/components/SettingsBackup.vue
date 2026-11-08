<script setup lang="ts">
import { ref } from 'vue';
import { CircleAlert, Download, Upload } from '@lucide/vue';
import { exportSettings, importSettings, UnauthorizedError } from '../api';

const emit = defineEmits<{ logout: []; imported: [] }>();

const busy = ref(false);
const picker = ref<HTMLInputElement | null>(null);
const error = ref('');
const done = ref('');

async function run(action: () => Promise<string>): Promise<void> {
  busy.value = true;
  error.value = '';
  done.value = '';
  try {
    done.value = await action();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function download(): Promise<void> {
  return run(async () => {
    const backup = await exportSettings();
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `amw-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return 'Exported.';
  });
}

function upload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return Promise.resolve();
  return run(async () => {
    let backup: unknown;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name} is not a JSON file`);
    }
    const { imported } = await importSettings(backup);
    emit('imported');
    return `Imported: ${imported.join(', ')}.`;
  });
}
</script>

<template>
  <div class="page-actions">
    <div class="backup-actions" role="group" aria-label="Backup of the portal settings">
      <button
        type="button"
        :disabled="busy"
        title="Downloads the settings changed in this portal (sites, Stuffing, A/B tests, live settings) as a JSON file"
        @click="download"
      >
        <Download class="icon" aria-hidden="true" /> Export settings
      </button>
      <button
        type="button"
        class="secondary"
        :disabled="busy"
        title="Restores an exported file; the whole file is checked first: if one section is invalid, nothing changes"
        @click="picker?.click()"
      >
        <Upload class="icon" aria-hidden="true" /> Import settings
      </button>
      <input ref="picker" type="file" accept="application/json,.json" hidden @change="upload" />
    </div>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="done" class="muted" role="status">{{ done }}</p>
  </div>
</template>
