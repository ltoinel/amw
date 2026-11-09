<script setup lang="ts">
import { ref } from 'vue';
import { getToken, logout } from './api';
import LoginView from './components/LoginView.vue';
import DashboardView from './components/DashboardView.vue';
import { activeSite } from './site';

const authenticated = ref(getToken() !== null);

function signOut(): void {
  logout();
  authenticated.value = false;
}
</script>

<template>
  <LoginView v-if="!authenticated" @logged-in="authenticated = true" />
  <!-- Remounted on a change of site, so that every view reloads for it -->
  <DashboardView v-else :key="activeSite" @logout="signOut" />
</template>
