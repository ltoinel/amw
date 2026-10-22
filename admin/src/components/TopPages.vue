<script setup lang="ts">
import { safeUrl, type PageStats } from '../api';

defineProps<{ pages: PageStats[] }>();
</script>

<template>
  <p v-if="pages.length === 0" class="muted">No page reported over this period.</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Page</th>
          <th scope="col" class="num">Views</th>
          <th scope="col" class="num">Clicks</th>
          <th scope="col" class="num">CTR</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="page in pages" :key="page.url">
          <td class="page">
            <!-- The URL comes from a client-controlled Referer: only http(s) becomes a link -->
            <a v-if="safeUrl(page.url)" :href="safeUrl(page.url)" target="_blank" rel="noopener noreferrer">{{ page.url }}</a>
            <span v-else>{{ page.url }}</span>
          </td>
          <td class="num">{{ page.impressions.toLocaleString('en-US') }}</td>
          <td class="num">{{ page.clicks.toLocaleString('en-US') }}</td>
          <td class="num">{{ (page.ctr * 100).toFixed(1) }} %</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
