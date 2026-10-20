<script setup lang="ts">
import { safeUrl, type NotFoundStats } from '../api';

defineProps<{ products: NotFoundStats[] }>();

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
</script>

<template>
  <p v-if="products.length === 0" class="muted">Nothing to replace, every requested product was found.</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">ASIN / keyword</th>
          <th scope="col" class="num">Failed lookups</th>
          <th scope="col">Last seen</th>
          <th scope="col">Pages</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="product in products" :key="product.product">
          <td><code>{{ product.type === 'keyword' ? `“${product.value}”` : product.value }}</code></td>
          <td class="num">{{ product.count.toLocaleString('en-US') }}</td>
          <td>{{ formatDate(product.lastSeen) }}</td>
          <td>
            <span v-if="product.referers.length === 0" class="muted">Unknown</span>
            <ul v-else class="referers">
              <li v-for="referer in product.referers" :key="referer.url">
                <a v-if="safeUrl(referer.url)" :href="safeUrl(referer.url)" target="_blank" rel="noopener noreferrer">{{ referer.url }}</a>
                <span v-else>{{ referer.url }}</span>
                <span class="muted"> ({{ referer.count }})</span>
              </li>
            </ul>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
