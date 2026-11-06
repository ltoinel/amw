<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CircleAlert, CircleCheck, CircleMinus } from '@lucide/vue';
import { getSettings, UnauthorizedError, type SettingEntry, type SettingsSection } from '../api';

const emit = defineEmits<{ logout: [] }>();

const sections = ref<SettingsSection[] | null>(null);
const error = ref('');

function display(entry: Extract<SettingEntry, { value: unknown }>): string {
  if (Array.isArray(entry.value)) return entry.value.length > 0 ? entry.value.join(', ') : 'none';
  return entry.value === '' ? 'empty' : String(entry.value);
}

onMounted(async () => {
  try {
    sections.value = await getSettings();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    error.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <div class="settings">
    <p v-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="!sections" class="muted" role="status">Loading…</p>

    <template v-else>
      <p class="muted">
        Values in use since the server started. They are read-only here: change the configuration file or the
        environment variables, then restart the server. Secrets are never displayed.
      </p>

      <section v-for="section in sections" :key="section.title" class="card">
        <h2>{{ section.title }}</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th scope="col">Setting</th><th scope="col">Value</th></tr>
            </thead>
            <tbody>
              <tr v-for="entry in section.entries" :key="entry.key">
                <th scope="row"><code>{{ entry.key }}</code></th>
                <td v-if="entry.secret">
                  <span class="badge">
                    <component :is="entry.configured ? CircleCheck : CircleMinus" class="icon" aria-hidden="true" />
                    {{ entry.configured ? 'Configured' : 'Not set' }}
                  </span>
                </td>
                <td v-else-if="entry.value === null" class="muted">default</td>
                <td v-else><code>{{ display(entry) }}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
