<script setup lang="ts">
import { ArrowDown } from '@lucide/vue';
import { safeUrl, type PageSort, type PageStats } from '../api';
import { downloadCsv, toCsv, usePagination } from '../tables';
import TableTools from './TableTools.vue';

const props = defineProps<{ pages: PageStats[]; sort: PageSort; days?: number }>();
const emit = defineEmits<{ sort: [sort: PageSort] }>();

const COLUMNS: { id: PageSort; label: string }[] = [
  { id: 'impressions', label: 'Views' },
  { id: 'clicks', label: 'Clicks' },
  { id: 'ctr', label: 'CTR' }
];

const { page: current, pageCount, visible, pageSize } = usePagination(() => props.pages);

function exportCsv(): void {
  downloadCsv(`amw-pages${props.days ? `-${props.days}d` : ''}.csv`, toCsv(
    ['URL', 'Views', 'Clicks', 'CTR'],
    props.pages.map(page => [page.url, page.impressions, page.clicks, page.ctr])
  ));
}
</script>

<template>
  <p v-if="pages.length === 0" class="muted">No page reported over this period.</p>
  <template v-else>
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Page</th>
          <th
            v-for="column in COLUMNS"
            :key="column.id"
            scope="col"
            class="num"
            :aria-sort="sort === column.id ? 'descending' : 'none'"
          >
            <button type="button" class="sort" :class="{ active: sort === column.id }" @click="emit('sort', column.id)">
              {{ column.label }}<ArrowDown v-if="sort === column.id" class="icon" aria-hidden="true" />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="page in visible" :key="page.url">
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
  <TableTools v-model:page="current" :total="pages.length" :page-count="pageCount" :page-size="pageSize" @export="exportCsv" />
  </template>
</template>
