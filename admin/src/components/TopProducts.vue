<script setup lang="ts">
import { safeUrl, type ProductStats } from '../api';

defineProps<{ products: ProductStats[] }>();
</script>

<template>
  <p v-if="products.length === 0" class="muted">No product displayed over this period.</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Product</th>
          <th scope="col">ASIN / keyword</th>
          <th scope="col" class="num">Impressions</th>
          <th scope="col" class="num">Clicks</th>
          <th scope="col" class="num">CTR</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="product in products" :key="product.product">
          <td class="product">
            <img v-if="safeUrl(product.image)" :src="safeUrl(product.image)" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <a v-if="safeUrl(product.url)" :href="safeUrl(product.url)" target="_blank" rel="noopener noreferrer">
              {{ product.title || product.value }}
            </a>
            <span v-else>{{ product.title || 'Not in cache' }}</span>
          </td>
          <td><code>{{ product.type === 'keyword' ? `“${product.value}”` : product.value }}</code></td>
          <td class="num">{{ product.impressions.toLocaleString('en-US') }}</td>
          <td class="num">{{ product.clicks.toLocaleString('en-US') }}</td>
          <td class="num">{{ (product.ctr * 100).toFixed(1) }} %</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
