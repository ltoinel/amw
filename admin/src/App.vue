<script setup lang="ts">
import { ref } from 'vue';
import { getToken, signOut as endSessions } from './api';
import LoginView from './components/LoginView.vue';
import DashboardView from './components/DashboardView.vue';
import { activeSite } from './site';

const authenticated = ref(getToken() !== null);

// Also reached once the server refused the token: it is already forgotten, so no request is sent
function signOut(): void {
  authenticated.value = false;
  void endSessions();
}
</script>

<template>
  <LoginView v-if="!authenticated" @logged-in="authenticated = true" />
  <!-- Remounted on a change of site, so that every view reloads for it -->
  <DashboardView v-else :key="activeSite" @logout="signOut" />
</template>
