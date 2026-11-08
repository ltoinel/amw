<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ArrowLeft, ChevronRight, CircleAlert, Globe, LogOut, Settings } from '@lucide/vue';
import { getSites, UnauthorizedError, type Site } from '../api';
import { setActiveSite } from '../site';
import AmwLogo from './AmwLogo.vue';
import SitesView from './SitesView.vue';

const emit = defineEmits<{ logout: [] }>();

const sites = ref<Site[] | null>(null);
const managing = ref(false);
const error = ref('');

async function load(): Promise<void> {
  error.value = '';
  try {
    sites.value = (await getSites()).sites;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    error.value = e instanceof Error ? e.message : String(e);
  }
}

// The list may have changed while it was managed
async function closeManager(): Promise<void> {
  managing.value = false;
  await load();
}

onMounted(load);
</script>

<template>
  <main class="site-picker">
    <div class="site-picker-panel">
      <header class="site-picker-header">
        <AmwLogo class="login-logo" />
        <div>
          <h1><span class="brand">AMW</span> Admin</h1>
          <p class="muted">Choose the site to work on. Every view but the server settings shows this site only.</p>
        </div>
        <button type="button" class="icon-button" aria-label="Sign out" title="Sign out" @click="emit('logout')">
          <LogOut class="icon" aria-hidden="true" />
        </button>
      </header>

      <p v-if="error" class="card error" role="alert"><CircleAlert class="icon" aria-hidden="true" /> {{ error }}</p>
      <p v-else-if="sites === null" class="muted" role="status">Loading…</p>

      <template v-else-if="managing || sites.length === 0">
        <p v-if="sites.length === 0 && !managing" class="muted">No site yet: add the first one.</p>
        <SitesView @logout="emit('logout')" @changed="load" />
        <button v-if="sites.length > 0" type="button" class="secondary" @click="closeManager">
          <ArrowLeft class="icon" aria-hidden="true" /> Back to the sites
        </button>
      </template>

      <template v-else>
        <div class="site-picker-head">
          <h2>Your sites</h2>
          <button type="button" class="icon-button" aria-label="Manage the sites" title="Manage the sites" @click="managing = true">
            <Settings class="icon" aria-hidden="true" />
          </button>
        </div>
        <ul class="site-picker-list">
          <li v-for="site in sites" :key="site.host">
            <button type="button" class="site-choice" @click="setActiveSite(site.host)">
              <Globe class="icon" aria-hidden="true" />
              <span>
                <strong>{{ site.host }}</strong>
                <span v-if="site.description" class="muted">{{ site.description }}</span>
              </span>
              <ChevronRight class="icon" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </template>
    </div>
  </main>
</template>
