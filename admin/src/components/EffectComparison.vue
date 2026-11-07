<script setup lang="ts">
import { computed } from 'vue';
import type { EffectStats } from '../api';
import { compareEffects, type Verdict } from '../effects';

const props = defineProps<{ rows: EffectStats[] }>();

const VERDICTS: Record<Verdict, string> = {
  control: 'Control group',
  'more-data': 'Not enough data yet',
  better: 'Better than the control',
  worse: 'Worse than the control',
  'no-difference': 'No clear difference'
};

const comparisons = computed(() => compareEffects(props.rows));

function uplift(value: number | null): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} %`;
}
</script>

<template>
  <p class="muted">
    Click-through rate per appearance effect, unique views only. Decide once the period is over rather than as soon as
    a line looks good: looking early is how false winners get chosen.
  </p>
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Effect</th>
          <th scope="col" class="num">Views</th>
          <th scope="col" class="num">Clicks</th>
          <th scope="col" class="num">CTR</th>
          <th scope="col" class="num">Against control</th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in comparisons" :key="row.effect">
          <td><code>{{ row.effect }}</code></td>
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
