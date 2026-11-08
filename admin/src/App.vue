<script setup lang="ts">
import { ref } from 'vue';
import { getToken, logout } from './api';
import LoginView from './components/LoginView.vue';
import DashboardView from './components/DashboardView.vue';
import SitePicker from './components/SitePicker.vue';
import { activeSite, setActiveSite } from './site';

const authenticated = ref(getToken() !== null);

function signOut(): void {
  logout();
  // The next person to sign in chooses their own site
  setActiveSite('');
  authenticated.value = false;
}
</script>

<template>
  <LoginView v-if="!authenticated" @logged-in="authenticated = true" />
  <SitePicker v-else-if="!activeSite" @logout="signOut" />
  <DashboardView v-else :key="activeSite" @logout="signOut" />
</template>
