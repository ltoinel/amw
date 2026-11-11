<script setup lang="ts">
import { computed } from 'vue';
import CtrBadge from './CtrBadge.vue';
import { averageCtr } from '../ctr';
import { periodSlug, safeUrl, type PageSort, type Period, type PageStats } from '../api';
import { downloadCsv, toCsv, usePagination } from '../tables';
import TableSearch from './TableSearch.vue';
import TableTools from './TableTools.vue';
import SortHeader from './SortHeader.vue';

const props = defineProps<{ pages: PageStats[]; sort: PageSort; days?: Period; average?: number }>();
// The click-through rate of the site over the period, the same reference in every table; the
// whole table's when the table is shown alone
const tableCtr = computed(() => props.average ?? averageCtr(props.pages));
const emit = defineEmits<{ sort: [sort: PageSort] }>();

const COLUMNS: { id: PageSort; label: string }[] = [
  { id: 'impressions', label: 'Impressions' },
  { id: 'clicks', label: 'Clicks' },
  { id: 'ctr', label: 'CTR' }
];

const { page: current, pageCount, visible, pageSize, query, filtered } = usePagination(
  () => props.pages,
  page => [page.url]
);

function exportCsv(): void {
  downloadCsv(`amw-pages${props.days ? `-${periodSlug(props.days)}` : ''}.csv`, toCsv(
    ['URL', 'Impressions', 'Clicks', 'CTR'],
    filtered.value.map(page => [page.url, page.impressions, page.clicks, page.ctr])
  ));
}
</script>

<template>
  <p v-if="pages.length === 0" class="muted">No page reported over this period.</p>
  <template v-else>
  <TableSearch v-model="query" placeholder="Search by URL" :matches="filtered.length" :loaded="pages.length" />
  <p v-if="filtered.length === 0" class="muted">No row matches this search.</p>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Page</th>
          <SortHeader
            v-for="column in COLUMNS"
            :key="column.id"
            :label="column.label"
            :active="sort === column.id"
            numeric
            @sort="emit('sort', column.id)"
          />
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
          <td class="num"><CtrBadge :ctr="page.ctr" :impressions="page.impressions" :average="tableCtr" /></td>
        </tr>
      </tbody>
    </table>
  </div>
  <TableTools v-model:page="current" v-model:page-size="pageSize" :total="filtered.length" :loaded="pages.length" :page-count="pageCount" @export="exportCsv" />
  </template>
</template>
