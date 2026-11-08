<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CircleAlert } from '@lucide/vue';
import { getPartnerTags, savePartnerTags, UnauthorizedError, type PartnerTags } from '../api';

const emit = defineEmits<{ logout: [] }>();

// Same rule as the server: an Associates tracking ID such as mysite-21
const TAG_PATTERN = '[A-Za-z0-9][A-Za-z0-9\\-]{0,62}-[0-9]{2}';

const setting = ref<PartnerTags | null>(null);
// By host; an empty field keeps the default tracking ID
const tags = ref<Record<string, string>>({});
const saving = ref(false);
const saved = ref(false);
const error = ref('');

/** The sites served, and those set before they left the list, so that they can be cleared. */
const sites = computed(() => setting.value
  ? [...new Set([...setting.value.allowedSites, ...Object.keys(setting.value.sites)])]
  : []);

async function run(action: () => Promise<PartnerTags>): Promise<boolean> {
  error.value = '';
  try {
    setting.value = await action();
    tags.value = Object.fromEntries(sites.value.map(site => [site, setting.value?.sites[site] ?? '']));
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
  const set = Object.entries(tags.value).map(([site, tag]) => [site, tag.trim()]).filter(([, tag]) => tag !== '');
  saved.value = await run(() => savePartnerTags(Object.fromEntries(set)));
  saving.value = false;
}

onMounted(() => run(getPartnerTags));
</script>

<template>
  <section v-if="setting" class="card">
    <h2>Tracking ID per site</h2>
    <p class="muted">
      The links of a site's cards carry its own Amazon tracking ID, so that Associates reports show the purchases of
      each site. An empty field keeps <code>{{ setting.defaultTag }}</code> (<code>Amazon.partnerTag</code>). Tracking
      IDs must belong to the Associates account of the API credentials. A change reaches pages within an hour, as
      <code>widget.js</code> is cached.
    </p>
    <p v-if="sites.length === 0" class="muted">List your sites in <code>Server.allowedSites</code> to set their tracking IDs.</p>
    <form v-else class="stuffing-form" @submit.prevent="save">
      <fieldset class="stuffing-sites partner-tags" :disabled="!setting.editable">
        <legend>Tracking IDs</legend>
        <label v-for="site in sites" :key="site">
          <code>{{ site }}</code>
          <input v-model="tags[site]" type="text" :pattern="TAG_PATTERN" :placeholder="setting.defaultTag" spellcheck="false" />
        </label>
      </fieldset>
      <button type="submit" :disabled="saving || !setting.editable">Save</button>
    </form>
    <p v-if="!setting.editable" class="muted">Changing this setting requires Redis.</p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved.</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
</template>
