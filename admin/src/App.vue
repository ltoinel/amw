<script setup lang="ts">
import { ref } from 'vue';
import { getToken, logout } from './api';
import LoginView from './components/LoginView.vue';
import DashboardView from './components/DashboardView.vue';

const authenticated = ref(getToken() !== null);

function signOut(): void {
  logout();
  authenticated.value = false;
}
</script>

<template>
  <DashboardView v-if="authenticated" @logout="signOut" />
  <LoginView v-else @logged-in="authenticated = true" />
</template>
