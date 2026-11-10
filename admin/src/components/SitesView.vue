<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { Check, CircleAlert, ExternalLink, Globe, Pencil, Plus, Tag, Trash2, X, Sparkles } from '@lucide/vue';
import { getSites, safeUrl, saveSites, UnauthorizedError, type Site, type SitesSetting } from '../api';

// changed: the hosts once saved, so that the active site follows a rename or a removal
const emit = defineEmits<{ logout: []; changed: [hosts: string[]] }>();

// Same rules as the server
const HOST_PATTERN = '[a-z0-9\\-]+(\\.[a-z0-9\\-]+)*(:[0-9]{1,5})?';
const TAG_PATTERN = '[A-Za-z0-9][A-Za-z0-9\\-]{0,62}-[0-9]{2}';
const MAX_SITES = 50;
const NEW = -1;

const setting = ref<SitesSetting | null>(null);
// The list as saved: a card only changes it once its edit is saved
const sites = ref<Site[]>([]);
// The card being edited (NEW for a site being added), and its values
const editing = ref<number | null>(null);
const draft = ref<Site>({ host: '', description: '', url: '', partnerTag: '', recommendations: true });
const removing = ref<number | null>(null);
const saving = ref(false);
const saved = ref('');
const error = ref('');

const normalized = (site: Site): Site => ({
  host: site.host.trim().toLowerCase(), description: site.description.trim(), url: site.url.trim(), partnerTag: site.partnerTag.trim(),
  recommendations: site.recommendations !== false,
});
// A site being added gets its card after the others
const cards = computed(() => [
  ...sites.value.map((site, index) => ({ site, index })),
  ...(editing.value === NEW ? [{ site: draft.value, index: NEW }] : []),
]);
const repeated = computed(() => {
  const host = draft.value.host.trim().toLowerCase();
  return host !== '' && sites.value.some((site, index) => index !== editing.value && site.host === host);
});

async function run(action: () => Promise<SitesSetting>): Promise<boolean> {
  error.value = '';
  try {
    const answer = await action();
    // An older server, or an unexpected answer, has no list
    if (!Array.isArray(answer?.sites)) {
      throw new Error('The sites are not available on this server');
    }
    setting.value = answer;
    sites.value = answer.sites.map(site => ({ ...site }));
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

async function edit(index: number): Promise<void> {
  saved.value = '';
  error.value = '';
  removing.value = null;
  editing.value = index;
  draft.value = index === NEW ? { host: '', description: '', url: '', partnerTag: '', recommendations: true } : { recommendations: true, ...sites.value[index] };
  // The first field of the card, so that the keyboard can type at once
  await nextTick();
  document.querySelector<HTMLInputElement>('.site-card.editing input')?.focus();
}

function cancel(): void {
  editing.value = null;
  error.value = '';
}

async function store(list: Site[], message: string): Promise<boolean> {
  saving.value = true;
  saved.value = '';
  const ok = await run(() => saveSites(list));
  saving.value = false;
  if (ok) {
    saved.value = message;
    emit('changed', sites.value.map(site => site.host));
  }
  return ok;
}

async function submit(): Promise<void> {
  if (editing.value === null || repeated.value) return;
  const site = normalized(draft.value);
  const list = editing.value === NEW
    ? [...sites.value, site]
    : sites.value.map((existing, index) => (index === editing.value ? site : existing));
  if (await store(list, `${site.host} saved.`)) editing.value = null;
}

async function remove(index: number): Promise<void> {
  const { host } = sites.value[index];
  if (await store(sites.value.filter((_, i) => i !== index), `${host} removed.`)) removing.value = null;
}

onMounted(() => run(getSites));
</script>

<template>
  <section v-if="setting" class="card">
    <div class="sites-head">
      <h2>Your sites</h2>
      <button
        type="button"
        :disabled="!setting.editable || editing !== null || sites.length >= MAX_SITES"
        @click="edit(NEW)"
      >
        <Plus class="icon" aria-hidden="true" /> Add a site
      </button>
    </div>
    <p class="muted">
      Only these sites may show the widget and, when recommendations are on, spend Claude credits. The links of a
      site's cards carry its own Amazon tracking ID, so that Associates reports show the purchases of each site; an
      empty tracking ID keeps <code>{{ setting.defaultTag }}</code> (<code>Amazon.partnerTag</code>), and tracking IDs
      must belong to the Associates account of the API credentials. The API applies a change within a minute, pages
      within an hour, as <code>widget.js</code> is cached.
    </p>
    <p v-if="!setting.saved" class="muted">
      This list comes from <code>Server.allowedSites</code>. Once saved here, it replaces that setting.
    </p>

    <ul class="site-cards">
      <template v-for="{ site, index } in cards" :key="index === NEW ? 'new' : site.host">
        <li v-if="editing === index" class="site-card editing">
          <form class="site-edit" @submit.prevent="submit">
            <label>
              Host
              <input v-model="draft.host" type="text" required :pattern="HOST_PATTERN" placeholder="www.example.com" spellcheck="false" autocapitalize="off" />
            </label>
            <label>
              Description
              <input v-model="draft.description" type="text" maxlength="200" placeholder="My blog" />
            </label>
            <label>
              URL
              <input v-model="draft.url" type="url" maxlength="2048" :placeholder="draft.host ? `https://${draft.host}/` : 'https://www.example.com/'" spellcheck="false" />
            </label>
            <label>
              Tracking ID
              <input v-model="draft.partnerTag" type="text" :pattern="TAG_PATTERN" :placeholder="setting.defaultTag" spellcheck="false" />
            </label>
            <label v-if="setting.recommendationEnabled" class="choice site-recommendations">
              <input v-model="draft.recommendations" type="checkbox" />
              <span>AI recommendations: its pages may ask Claude for products (billed)</span>
            </label>
            <p v-if="repeated" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> This host is already listed.</p>
            <div class="site-card-buttons">
              <button type="submit" :disabled="saving || repeated"><Check class="icon" aria-hidden="true" /> {{ index === NEW ? 'Add' : 'Save' }}</button>
              <button type="button" class="secondary" :disabled="saving" @click="cancel"><X class="icon" aria-hidden="true" /> Cancel</button>
            </div>
          </form>
        </li>
        <li v-else class="site-card">
          <div class="site-card-head">
            <Globe class="icon site-card-icon" aria-hidden="true" />
            <h3><code>{{ site.host }}</code></h3>
            <span class="site-card-actions">
              <a
                v-if="safeUrl(site.url)"
                :href="safeUrl(site.url)"
                class="icon-button"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`Open ${site.host}`"
                title="Open the site"
              ><ExternalLink class="icon" aria-hidden="true" /></a>
              <button
                type="button"
                class="icon-button"
                :disabled="!setting.editable || editing !== null"
                :aria-label="`Edit ${site.host}`"
                title="Edit"
                @click="edit(index)"
              ><Pencil class="icon" aria-hidden="true" /></button>
              <button
                type="button"
                class="icon-button"
                :disabled="!setting.editable || editing !== null"
                :aria-label="`Remove ${site.host}`"
                title="Remove"
                @click="removing = index; saved = ''"
              ><Trash2 class="icon" aria-hidden="true" /></button>
            </span>
          </div>
          <p :class="site.description ? 'site-card-description' : 'site-card-description muted'">
            {{ site.description || 'No description' }}
          </p>
          <p class="site-card-meta">
            <Tag class="icon" aria-hidden="true" />
            <span v-if="site.partnerTag"><code>{{ site.partnerTag }}</code></span>
            <span v-else class="muted"><code>{{ setting.defaultTag }}</code> (default)</span>
          </p>
          <p v-if="setting.recommendationEnabled" class="site-card-meta">
            <Sparkles class="icon" aria-hidden="true" />
            <span :class="{ muted: site.recommendations === false }">AI recommendations {{ site.recommendations === false ? 'off' : 'on' }}</span>
          </p>
          <div v-if="removing === index" class="site-card-confirm" role="alert">
            <span>Remove this site? Its cards stop showing.</span>
            <button type="button" class="danger" :disabled="saving" @click="remove(index)">Remove</button>
            <button type="button" class="secondary" :disabled="saving" @click="removing = null">Cancel</button>
          </div>
        </li>
      </template>
    </ul>

    <p v-if="sites.length === 0 && editing === null" class="muted" role="status">
      No site: every site may show the widget<template v-if="setting.recommendationEnabled">, and recommendations are
      off until you list one</template>.
    </p>
    <p v-if="!setting.editable" class="muted">Changing the sites requires Redis or <code>Admin.settingsFile</code>.</p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">{{ saved }}</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
  <p v-else class="muted" role="status">Loading…</p>
</template>
