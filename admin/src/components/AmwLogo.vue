<script setup lang="ts">
import { useId } from 'vue';

// Several logos can be on the page at once (activity bar and phone title bar):
// each one needs its own gradient id, or they would all point to the first.
const gradient = `amw-tile-${useId()}`;
</script>

<!-- Same artwork as docs/assets/logo.svg and the favicon, inlined because the
     admin Content-Security-Policy forbids external images. Decorative: the
     visible "AMW" brand next to it carries the name. -->
<template>
  <svg class="amw-logo" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient :id="gradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0f766e" />
        <stop offset="1" stop-color="#134e4a" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="15" :fill="`url(#${gradient})`" />
    <path fill="#99f6e4" d="M20 15h24l10 13H10z" />
    <path fill="#ecfeff" d="M26 15h12l5 13H21z" />
    <path fill="#2dd4bf" d="M10 28h44L32 54z" />
    <path fill="#ccfbf1" d="M21 28h22L32 54z" />
  </svg>
</template>
