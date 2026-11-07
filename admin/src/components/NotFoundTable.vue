<script setup lang="ts">
import { safeUrl, type NotFoundStats } from '../api';
import { downloadCsv, toCsv, usePagination } from '../tables';
import TableSearch from './TableSearch.vue';
import TableTools from './TableTools.vue';

const props = defineProps<{ products: NotFoundStats[] }>();

const { page, pageCount, visible, pageSize, query, filtered } = usePagination(
  () => props.products,
  product => [product.title, product.value, ...product.referers.map(referer => referer.url)]
);

function exportCsv(): void {
  downloadCsv('amw-products-to-replace.csv', toCsv(
    ['Title', 'Type', 'ASIN or keyword', 'Failed lookups', 'First seen', 'Last seen', 'Amazon URL', 'Pages'],
    filtered.value.map(product => [
      product.title, product.type, product.value, product.count, product.firstSeen, product.lastSeen, product.url,
      product.referers.map(referer => referer.url).join(' ')
    ])
  ));
}

const HOUR = 3600 * 1000;

// Hours up to two days, then days: precise enough to tell a short outage from a removed product
function missingFor(firstSeen: string | null): string {
  if (!firstSeen) return '—';
  const hours = Math.floor((Date.now() - new Date(firstSeen).getTime()) / HOUR);
  if (hours < 1) return '< 1 h';
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

function dates(product: NotFoundStats): string {
  const format = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'unknown');
  return `First failed lookup: ${format(product.firstSeen)}\nLast failed lookup: ${format(product.lastSeen)}`;
}
</script>

<template>
  <p v-if="products.length === 0" class="muted">Nothing to replace, every requested product was found.</p>
  <template v-else>
  <TableSearch v-model="query" placeholder="Search by title, ASIN, keywords or page" :matches="filtered.length" :loaded="products.length" />
  <p v-if="filtered.length === 0" class="muted">No row matches this search.</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Product</th>
          <th scope="col">ASIN / keyword</th>
          <th scope="col" class="num">Failed lookups</th>
          <th scope="col" class="num">Missing for</th>
          <th scope="col">Pages</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="product in visible" :key="product.product">
          <td>
            <span v-if="product.title">{{ product.title }}</span>
            <span v-else class="muted">Title unknown</span>
          </td>
          <td>
            <a v-if="safeUrl(product.url)" :href="safeUrl(product.url)" target="_blank" rel="noopener noreferrer">
              <code>{{ product.type === 'keyword' ? `“${product.value}”` : product.value }}</code>
            </a>
            <code v-else>{{ product.type === 'keyword' ? `“${product.value}”` : product.value }}</code>
          </td>
          <td class="num">{{ product.count.toLocaleString('en-US') }}</td>
          <td class="num" :title="dates(product)">{{ missingFor(product.firstSeen) }}</td>
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
  <TableTools v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" :loaded="products.length" :page-count="pageCount" @export="exportCsv" />
  </template>
</template>
