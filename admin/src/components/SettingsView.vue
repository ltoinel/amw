<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CircleAlert, CircleCheck, CircleMinus, PlugZap } from '@lucide/vue';
import StuffingForm from './StuffingForm.vue';
import { getSettings, safeUrl, testAmazon, UnauthorizedError, type AmazonCheckResult, type SettingEntry, type SettingsSection } from '../api';

const emit = defineEmits<{ logout: [] }>();

const sections = ref<SettingsSection[] | null>(null);
const error = ref('');
const testing = ref(false);
const test = ref<AmazonCheckResult | null>(null);
const testError = ref('');

async function runTest(): Promise<void> {
  testing.value = true;
  testError.value = '';
  try {
    test.value = await testAmazon();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    test.value = null;
    testError.value = e instanceof Error ? e.message : String(e);
  } finally {
    testing.value = false;
  }
}

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

      <StuffingForm @logout="emit('logout')" />

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

        <div v-if="section.title === 'Amazon'" class="amazon-test">
          <button type="button" class="secondary" :disabled="testing" @click="runTest">
            <PlugZap class="icon" aria-hidden="true" /> {{ testing ? 'Testing…' : 'Test the Amazon API' }}
          </button>
          <span class="muted">Runs a real product search, which uses one call of your Amazon quota.</span>

          <p v-if="testError" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ testError }}</p>
          <div v-else-if="test" class="amazon-test-result" :class="test.ok ? 'succeeded' : 'failed'" role="status">
            <p>
              <component :is="test.ok ? CircleCheck : CircleAlert" class="icon" aria-hidden="true" />
              {{ test.message }}
            </p>
            <p v-if="test.product">
              Product found:
              <a v-if="safeUrl(test.product.url)" :href="safeUrl(test.product.url)" target="_blank" rel="noopener noreferrer">{{ test.product.title }}</a>
              <span v-else>{{ test.product.title }}</span>
            </p>
            <p class="muted">
              {{ test.marketplace }} · {{ test.partnerTag }} · {{ test.durationMs }} ms
              <template v-if="test.cached"> · result of the previous test, less than 10 s ago</template>
            </p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
