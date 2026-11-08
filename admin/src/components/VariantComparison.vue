<script setup lang="ts">
import { computed } from 'vue';
import { compareVariants, type Verdict, type VariantStats } from '../effects';

// label: the name of the column, "Effect" or "Theme"
const props = defineProps<{ rows: VariantStats[]; control: string; label: string }>();

const VERDICTS: Record<Verdict, string> = {
  control: 'Control group',
  'more-data': 'Not enough data yet',
  better: 'Better than the control',
  worse: 'Worse than the control',
  'no-difference': 'No clear difference'
};

const comparisons = computed(() => compareVariants(props.rows, props.control));

function uplift(value: number | null): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} %`;
}
</script>

<template>
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">{{ label }}</th>
          <th scope="col" class="num">Views</th>
          <th scope="col" class="num">Clicks</th>
          <th scope="col" class="num">CTR</th>
          <th scope="col" class="num">Against control</th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in comparisons" :key="row.name">
          <td><code>{{ row.name }}</code></td>
          <td class="num">{{ row.views.toLocaleString('en-US') }}</td>
          <td class="num">{{ row.clicks.toLocaleString('en-US') }}</td>
          <td class="num">{{ (row.ctr * 100).toFixed(1) }} %</td>
          <td class="num">{{ uplift(row.uplift) }}</td>
          <td>{{ VERDICTS[row.verdict] }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
