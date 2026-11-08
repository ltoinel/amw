<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CircleAlert, Plus, Trash2 } from '@lucide/vue';
import { getSites, safeUrl, saveSites, UnauthorizedError, type Site, type SitesSetting } from '../api';

const emit = defineEmits<{ logout: [] }>();

// Same rules as the server
const HOST_PATTERN = '[a-z0-9\\-]+(\\.[a-z0-9\\-]+)*(:[0-9]{1,5})?';
const TAG_PATTERN = '[A-Za-z0-9][A-Za-z0-9\\-]{0,62}-[0-9]{2}';
const MAX_SITES = 50;

const setting = ref<SitesSetting | null>(null);
const sites = ref<Site[]>([]);
const saving = ref(false);
const saved = ref(false);
const error = ref('');

const hosts = computed(() => sites.value.map(site => site.host.trim()));
const repeated = computed(() => hosts.value.some((host, index) => host !== '' && hosts.value.indexOf(host) !== index));

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

function add(): void {
  saved.value = false;
  sites.value.push({ host: '', description: '', url: '', partnerTag: '' });
}

function remove(index: number): void {
  saved.value = false;
  sites.value.splice(index, 1);
}

async function save(): Promise<void> {
  saving.value = true;
  saved.value = false;
  // A row left without a host is dropped rather than refused
  const list = sites.value
    .map(site => ({ host: site.host.trim().toLowerCase(), description: site.description.trim(), url: site.url.trim(), partnerTag: site.partnerTag.trim() }))
    .filter(site => site.host !== '');
  saved.value = await run(() => saveSites(list));
  saving.value = false;
}

onMounted(() => run(getSites));
</script>

<template>
  <section v-if="setting" class="card">
    <h2>Your sites</h2>
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

    <form class="sites-form" @submit.prevent="save">
      <fieldset :disabled="!setting.editable">
        <legend class="visually-hidden">Sites</legend>
        <div v-for="(site, index) in sites" :key="index" class="site-row">
          <label>
            Host
            <input v-model="site.host" type="text" required :pattern="HOST_PATTERN" placeholder="www.example.com" spellcheck="false" autocapitalize="off" />
          </label>
          <label>
            Description
            <input v-model="site.description" type="text" maxlength="200" placeholder="My blog" />
          </label>
          <label>
            URL
            <input v-model="site.url" type="url" maxlength="2048" :placeholder="site.host ? `https://${site.host}/` : 'https://www.example.com/'" spellcheck="false" />
          </label>
          <label>
            Tracking ID
            <input v-model="site.partnerTag" type="text" :pattern="TAG_PATTERN" :placeholder="setting.defaultTag" spellcheck="false" />
          </label>
          <div class="site-actions">
            <a
              v-if="safeUrl(site.url)"
              :href="safeUrl(site.url)"
              class="muted"
              target="_blank"
              rel="noopener noreferrer"
            >Open</a>
            <button type="button" class="icon-button" :aria-label="`Remove ${site.host || 'this site'}`" title="Remove" @click="remove(index)">
              <Trash2 class="icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </fieldset>

      <p v-if="sites.length === 0" class="muted" role="status">
        No site: every site may show the widget<template v-if="setting.recommendationEnabled">, and recommendations are
        off until you list one</template>.
      </p>
      <p v-if="repeated" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> A host is listed twice.</p>

      <div class="sites-buttons">
        <button type="button" class="secondary" :disabled="!setting.editable || sites.length >= MAX_SITES" @click="add">
          <Plus class="icon" aria-hidden="true" /> Add a site
        </button>
        <button type="submit" :disabled="saving || !setting.editable || repeated">Save</button>
      </div>
    </form>

    <p v-if="!setting.editable" class="muted">Changing the sites requires Redis or <code>Admin.settingsFile</code>.</p>
    <p v-if="error" class="error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
    <p v-else-if="saved" class="muted" role="status">Saved.</p>
  </section>
  <p v-else-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
  <p v-else class="muted" role="status">Loading…</p>
</template>
