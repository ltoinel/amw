<script setup lang="ts">
import { ref } from 'vue';
import { login } from '../api';

const emit = defineEmits<{ 'logged-in': [] }>();

const password = ref('');
const error = ref('');
const pending = ref(false);

async function submit(): Promise<void> {
  error.value = '';
  pending.value = true;
  try {
    await login(password.value);
    password.value = '';
    emit('logged-in');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <main class="login">
    <form class="card login-card" @submit.prevent="submit">
      <h1><span class="brand">AMW</span> Admin</h1>
      <p class="muted">Usage statistics of Amazon Modern Widgets.</p>
      <label for="password">Password</label>
      <input
        id="password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        autofocus
      />
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="pending || !password">
        {{ pending ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </main>
</template>
