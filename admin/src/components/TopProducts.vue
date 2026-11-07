<script setup lang="ts">
import { safeUrl, type ProductStats } from '../api';
import { downloadCsv, toCsv, usePagination } from '../tables';
import TableSearch from './TableSearch.vue';
import TableTools from './TableTools.vue';

const props = defineProps<{ products: ProductStats[]; days?: number }>();

const { page, pageCount, visible, pageSize, query, filtered } = usePagination(
  () => props.products,
  product => [product.title, product.value]
);

const MINUTE = 60 * 1000;

// Products are refreshed within 24 hours (Amazon rule on prices): minutes, then hours
function cachedFor(fetchedAt: string | undefined): string {
  if (!fetchedAt) return '—';
  const minutes = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / MINUTE);
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function exportCsv(): void {
  downloadCsv(`amw-products${props.days ? `-${props.days}d` : ''}.csv`, toCsv(
    ['Title', 'Type', 'ASIN or keyword', 'Impressions', 'Clicks', 'CTR', 'URL', 'Fetched from Amazon'],
    filtered.value.map(product => [product.title, product.type, product.value, product.impressions, product.clicks, product.ctr, product.url, product.fetchedAt])
  ));
}
</script>

<template>
  <p v-if="products.length === 0" class="muted">No product displayed over this period.</p>
  <template v-else>
  <TableSearch v-model="query" placeholder="Search by title, ASIN or keywords" :matches="filtered.length" :loaded="products.length" />
  <p v-if="filtered.length === 0" class="muted">No row matches this search.</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Product</th>
          <th scope="col">ASIN / keyword</th>
          <th scope="col" class="num">Impressions</th>
          <th scope="col" class="num">Clicks</th>
          <th scope="col" class="num">CTR</th>
          <th scope="col" class="num">In cache for</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="product in visible" :key="product.product">
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
          <td class="num" :title="product.fetchedAt ? `Fetched from Amazon: ${new Date(product.fetchedAt).toLocaleString()}` : 'Not in cache'">
            {{ cachedFor(product.fetchedAt) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <TableTools v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" :loaded="products.length" :page-count="pageCount" @export="exportCsv" />
  </template>
</template>
